import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireEditor } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { program_id } = req.query;
  const params = [];
  let sql = `SELECT b.*, p.code AS program_code, r.code AS home_room_code
               FROM batches b
               JOIN programs p ON p.id = b.program_id
               LEFT JOIN classrooms r ON r.id = b.home_room_id`;
  if (program_id) { sql += ' WHERE b.program_id = ?'; params.push(program_id); }
  sql += ' ORDER BY p.code, b.sort_order, b.id';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

// Optional placement: { position: 'above'|'below', relative_to: <batch id> }
// inserts the new batch's row next to an existing one in the timetable grid;
// without it the batch is appended at the end of its program.
router.post('/', requireEditor, async (req, res) => {
  const { name, program_id, student_count = 0, home_room_id = null, exam_month = null,
    position = null, relative_to = null } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Batches created before the ordering feature (or by the docx import) sit
    // at the default 0 — materialise their order (= id) before shifting.
    await conn.query(
      'UPDATE batches SET sort_order = id WHERE program_id = ? AND sort_order = 0',
      [program_id]
    );
    let sort = null;
    if (position && relative_to) {
      const [[rel]] = await conn.query(
        'SELECT sort_order FROM batches WHERE id = ? AND program_id = ?',
        [relative_to, program_id]
      );
      if (rel) {
        sort = position === 'above' ? rel.sort_order : rel.sort_order + 1;
        await conn.query(
          'UPDATE batches SET sort_order = sort_order + 1 WHERE program_id = ? AND sort_order >= ?',
          [program_id, sort]
        );
      }
    }
    if (sort == null) {
      const [[m]] = await conn.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 AS s FROM batches WHERE program_id = ?',
        [program_id]
      );
      sort = m.s;
    }
    const [r] = await conn.query(
      `INSERT INTO batches (name, program_id, student_count, home_room_id, exam_month, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, program_id, student_count, home_room_id, exam_month, sort]
    );
    await conn.commit();
    res.json({ id: r.insertId });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: e.message || 'Could not create the batch' });
  } finally {
    conn.release();
  }
});

// Persist a full row order for a program's grid: { program_id, order: [batch ids] }.
// sort_order becomes the array index, so a drag-and-drop reorder on the client
// sends the whole visible order in one call. Must be registered before /:id.
router.put('/reorder', requireEditor, async (req, res) => {
  const { program_id, order } = req.body;
  if (!program_id || !Array.isArray(order) || !order.length)
    return res.status(400).json({ error: 'program_id and order are required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < order.length; i++) {
      await conn.query(
        'UPDATE batches SET sort_order = ? WHERE id = ? AND program_id = ?',
        [i + 1, order[i], program_id]
      );
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: e.message || 'Could not reorder the batches' });
  } finally {
    conn.release();
  }
});

router.put('/:id', requireEditor, async (req, res) => {
  const { name, program_id, student_count, home_room_id, exam_month, active } = req.body;
  await pool.query(
    `UPDATE batches SET name=?, program_id=?, student_count=?, home_room_id=?, exam_month=?, active=?
       WHERE id=?`,
    [name, program_id, student_count, home_room_id, exam_month, active ?? 1, req.params.id]
  );
  res.json({ ok: true });
});

// Deleting a batch also deletes its sessions on every date; the FK is
// ON DELETE SET NULL, which would otherwise leave orphaned "—" rows behind.
// The deleted batch and session rows are returned so the client can offer
// an undo (see POST /restore below).
router.delete('/:id', requireEditor, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[batch]] = await conn.query('SELECT * FROM batches WHERE id = ?', [req.params.id]);
    if (!batch) {
      await conn.rollback();
      return res.status(404).json({ error: 'Batch not found' });
    }
    const [allocations] = await conn.query(
      'SELECT * FROM allocations WHERE batch_id = ?', [req.params.id]
    );
    await conn.query('DELETE FROM allocations WHERE batch_id = ?', [req.params.id]);
    await conn.query('DELETE FROM batches WHERE id = ?', [req.params.id]);
    await conn.commit();
    res.json({ ok: true, deleted_sessions: allocations.length, batch, allocations });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: e.message || 'Could not delete the batch' });
  } finally {
    conn.release();
  }
});

// Undo a batch delete: reinsert the batch and its sessions with their
// original ids, exactly as DELETE /:id returned them.
router.post('/restore', requireEditor, async (req, res) => {
  const { batch, allocations = [] } = req.body || {};
  if (!batch?.id || !batch?.name || !batch?.program_id)
    return res.status(400).json({ error: 'batch data is required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO batches (id, name, program_id, student_count, home_room_id, exam_month, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [batch.id, batch.name, batch.program_id, batch.student_count ?? 0,
        batch.home_room_id ?? null, batch.exam_month ?? null, batch.active ?? 1,
        batch.sort_order ?? 0]
    );
    for (const a of allocations) {
      await conn.query(
        `INSERT INTO allocations (id, alloc_date, program_id, batch_id, activity_id, time_slot_id,
           classroom_id, faculty_id, student_count, raw_text, note, status,
           requested_by, decided_by, decided_at, decision_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [a.id, a.alloc_date, a.program_id, a.batch_id, a.activity_id, a.time_slot_id,
          a.classroom_id, a.faculty_id, a.student_count, a.raw_text, a.note,
          a.status ?? 'approved', a.requested_by, a.decided_by, a.decided_at, a.decision_note]
      );
    }
    await conn.commit();
    res.json({ ok: true, restored_sessions: allocations.length });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: e.message || 'Could not restore the batch' });
  } finally {
    conn.release();
  }
});

export default router;
