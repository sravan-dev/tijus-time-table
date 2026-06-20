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
