// Read-only reference lists + simple CRUD for faculty and classrooms.
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireEditor } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/programs', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM programs ORDER BY id');
  res.json(rows);
});

// `?usage=1` adds how many sessions sit in each slot — Manage → Timings shows it
// so nobody deletes a column that still holds classes.
router.get('/slots', async (req, res) => {
  const { program_id } = req.query;
  const params = [];
  let sql = req.query.usage
    ? `SELECT ts.*, (SELECT COUNT(*) FROM allocations a WHERE a.time_slot_id = ts.id) AS usage_count
         FROM time_slots ts`
    : 'SELECT * FROM time_slots';
  if (program_id) { sql += ' WHERE program_id = ?'; params.push(program_id); }
  sql += ' ORDER BY program_id, sort_order, id';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

// Add a slot (a new column) at the end of a program's grid.
router.post('/slots', requireEditor, async (req, res) => {
  const { program_id, label, start_time = null, end_time = null } = req.body;
  if (!program_id) return res.status(400).json({ error: 'A program is required' });
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'A label is required' });
  const [[{ next }]] = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM time_slots WHERE program_id = ?', [program_id]);
  try {
    const [r] = await pool.query(
      'INSERT INTO time_slots (program_id, label, start_time, end_time, sort_order) VALUES (?, ?, ?, ?, ?)',
      [program_id, String(label).trim(), start_time || null, end_time || null, next]
    );
    res.json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Another slot in this program already uses that label' });
    throw e;
  }
});

// Persist a program's column order: { program_id, order: [slot ids] }.
// Registered before /slots/:id so "reorder" isn't read as an id.
router.put('/slots/reorder', requireEditor, async (req, res) => {
  const { program_id, order } = req.body;
  if (!program_id || !Array.isArray(order) || !order.length)
    return res.status(400).json({ error: 'program_id and order are required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < order.length; i++) {
      await conn.query('UPDATE time_slots SET sort_order = ? WHERE id = ? AND program_id = ?',
        [i, order[i], program_id]);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// Delete a slot. Refused while sessions still sit in it, so a column of
// classes can't vanish from the timetable by accident.
router.delete('/slots/:id', requireEditor, async (req, res) => {
  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM allocations WHERE time_slot_id = ?', [req.params.id]);
  if (n) return res.status(409).json({
    error: `${n} session${n > 1 ? 's are' : ' is'} in this slot — move or clear them first`,
  });
  const [r] = await pool.query('DELETE FROM time_slots WHERE id = ?', [req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Slot not found' });
  res.json({ ok: true });
});

// Edit a slot's label and start/end times (admins). Existing allocations keep
// their time_slot_id, so they simply re-display under the new label/time.
router.put('/slots/:id', requireEditor, async (req, res) => {
  const { label, start_time = null, end_time = null } = req.body;
  if (!label || !String(label).trim()) {
    return res.status(400).json({ error: 'A label is required' });
  }
  try {
    await pool.query(
      'UPDATE time_slots SET label = ?, start_time = ?, end_time = ? WHERE id = ?',
      [String(label).trim(), start_time || null, end_time || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Another slot in this program already uses that label' });
    }
    throw e;
  }
});

// `?usage=1` adds how many sessions each type is used by — Manage → Activities
// shows it so nobody renames or deletes a heavily used type without noticing.
router.get('/activities', async (req, res) => {
  const sql = req.query.usage
    ? `SELECT a.*, (SELECT COUNT(*) FROM allocations al WHERE al.activity_id = a.id) AS usage_count
         FROM activities a ORDER BY a.name`
    : 'SELECT * FROM activities ORDER BY name';
  const [rows] = await pool.query(sql);
  res.json(rows);
});

// Accept only a #rrggbb literal — these values are written straight into a
// style attribute in the grid, so nothing else may get through.
const HEX = /^#[0-9a-f]{6}$/i;
const colour = (v) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : null);

// Create an activity type, or return the existing one with the same code.
// Used by the grid's "Add activity…" modal, where an admin types a name
// ("Movie", "Mentors meeting") without caring whether it exists yet.
router.post('/activities', requireEditor, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'An activity name is required' });
  // `code` is what the grid cell prints, so it stays short and uppercase like
  // the imported types (R, GRAMMAR, YOGA).
  const code = String(req.body.code || name).trim().toUpperCase().slice(0, 20);
  const text_color = colour(req.body.text_color);
  const bg_color = colour(req.body.bg_color);

  const [[existing]] = await pool.query('SELECT * FROM activities WHERE code = ?', [code]);
  if (existing) {
    // Reuse rather than fail on the unique code, and let the colours just
    // picked become this type's default for next time.
    const t = text_color ?? existing.text_color;
    const b = bg_color ?? existing.bg_color;
    if (t !== existing.text_color || b !== existing.bg_color) {
      await pool.query('UPDATE activities SET text_color = ?, bg_color = ? WHERE id = ?',
        [t, b, existing.id]);
    }
    return res.json({ ...existing, text_color: t, bg_color: b });
  }
  const [r] = await pool.query(
    'INSERT INTO activities (code, name, text_color, bg_color) VALUES (?, ?, ?, ?)',
    [code, name.slice(0, 80), text_color, bg_color]
  );
  res.json({ id: r.insertId, code, name: name.slice(0, 80), text_color, bg_color });
});

// Edit an activity type: its code (what the grid cell prints), its full name
// ("R" -> "Reading"), and its default highlight colours. Existing sessions keep
// their activity_id, so they simply re-display under the new code and colours.
// Colours are cleared by sending an empty string, kept by omitting the field.
router.put('/activities/:id', requireEditor, async (req, res) => {
  const [[existing]] = await pool.query('SELECT * FROM activities WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Activity not found' });

  const name = String(req.body.name ?? existing.name).trim();
  if (!name) return res.status(400).json({ error: 'An activity name is required' });
  const code = String(req.body.code ?? existing.code).trim().toUpperCase().slice(0, 20);
  if (!code) return res.status(400).json({ error: 'An activity code is required' });
  const pick = (field) => (field in req.body ? colour(req.body[field]) : existing[field]);

  try {
    await pool.query(
      'UPDATE activities SET code = ?, name = ?, text_color = ?, bg_color = ? WHERE id = ?',
      [code, name.slice(0, 80), pick('text_color'), pick('bg_color'), req.params.id]
    );
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: `Another activity already uses the code ${code}` });
    throw e;
  }
  res.json({ ok: true });
});

// Delete an activity type. allocations.activity_id is ON DELETE SET NULL, so
// sessions using it survive but lose their type — the caller is told how many
// that would be (via ?usage=1 on the list) before it comes to this.
router.delete('/activities/:id', requireEditor, async (req, res) => {
  const [r] = await pool.query('DELETE FROM activities WHERE id = ?', [req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Activity not found' });
  res.json({ ok: true });
});

// ---- Faculty -------------------------------------------------------------
router.get('/faculty', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM faculty ORDER BY name');
  res.json(rows);
});
router.post('/faculty', requireEditor, async (req, res) => {
  const { name, email = null, active = 1 } = req.body;
  const [r] = await pool.query('INSERT INTO faculty (name, email, active) VALUES (?, ?, ?)', [name, email, active]);
  res.json({ id: r.insertId, name, email, active });
});
router.put('/faculty/:id', requireEditor, async (req, res) => {
  const { name, email = null, active = 1 } = req.body;
  await pool.query('UPDATE faculty SET name = ?, email = ?, active = ? WHERE id = ?',
    [name, email, active, req.params.id]);
  res.json({ ok: true });
});

// ---- Faculty capabilities (tutor x program x module) ---------------------
const MODULES = ['LISTENING', 'READING', 'SPEAKING', 'WRITING', 'GENERAL'];

router.get('/capabilities', async (req, res) => {
  const { program_id, faculty_id } = req.query;
  const where = [];
  const params = [];
  if (program_id) { where.push('fc.program_id = ?'); params.push(program_id); }
  if (faculty_id) { where.push('fc.faculty_id = ?'); params.push(faculty_id); }
  const [rows] = await pool.query(
    `SELECT fc.id, fc.faculty_id, f.name AS faculty_name,
            fc.program_id, p.code AS program_code, fc.module
       FROM faculty_capabilities fc
       JOIN faculty f  ON f.id = fc.faculty_id
       JOIN programs p ON p.id = fc.program_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.code, f.name, fc.module`,
    params
  );
  res.json(rows);
});

router.post('/capabilities', requireEditor, async (req, res) => {
  const { faculty_id, program_id, module } = req.body;
  if (!faculty_id || !program_id || !MODULES.includes(module)) {
    return res.status(400).json({ error: 'faculty_id, program_id and a valid module are required' });
  }
  await pool.query(
    'INSERT IGNORE INTO faculty_capabilities (faculty_id, program_id, module) VALUES (?, ?, ?)',
    [faculty_id, program_id, module]
  );
  res.json({ ok: true });
});

router.delete('/capabilities', requireEditor, async (req, res) => {
  const { faculty_id, program_id, module } = req.body;
  await pool.query(
    'DELETE FROM faculty_capabilities WHERE faculty_id = ? AND program_id = ? AND module = ?',
    [faculty_id, program_id, module]
  );
  res.json({ ok: true });
});

// ---- Classrooms ----------------------------------------------------------
router.get('/classrooms', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM classrooms ORDER BY code');
  res.json(rows);
});
router.post('/classrooms', requireEditor, async (req, res) => {
  const { code, capacity = 0, notes = null } = req.body;
  const [r] = await pool.query(
    'INSERT INTO classrooms (code, capacity, notes) VALUES (?, ?, ?)', [code, capacity, notes]);
  res.json({ id: r.insertId, code, capacity, notes });
});
router.put('/classrooms/:id', requireEditor, async (req, res) => {
  const { code, capacity, notes } = req.body;
  await pool.query('UPDATE classrooms SET code = ?, capacity = ?, notes = ? WHERE id = ?',
    [code, capacity, notes, req.params.id]);
  res.json({ ok: true });
});
router.delete('/classrooms/:id', requireEditor, async (req, res) => {
  // allocations.classroom_id is ON DELETE SET NULL and room_blocks cascade, but
  // batches.home_room_id is RESTRICT — so refuse if a batch still uses it.
  try {
    await pool.query('DELETE FROM classrooms WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_ROW_IS_REFERENCED_2' || e.code === 'ER_ROW_IS_REFERENCED') {
      return res.status(409).json({ error: 'This room is set as a batch home room — clear that first.' });
    }
    throw e;
  }
});

export default router;
