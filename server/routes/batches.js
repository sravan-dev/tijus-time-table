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

router.delete('/:id', requireEditor, async (req, res) => {
  await pool.query('DELETE FROM batches WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

export default router;
