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

router.get('/slots', async (req, res) => {
  const { program_id } = req.query;
  const params = [];
  let sql = 'SELECT * FROM time_slots';
  if (program_id) { sql += ' WHERE program_id = ?'; params.push(program_id); }
  sql += ' ORDER BY program_id, sort_order';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
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

router.get('/activities', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM activities ORDER BY name');
  res.json(rows);
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

export default router;
