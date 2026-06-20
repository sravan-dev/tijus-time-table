// Faculty leave and room blocks (the availability inputs to the rules engine).
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireEditor } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ---- Faculty leave -------------------------------------------------------
router.get('/leave', async (req, res) => {
  const { date } = req.query;
  const params = [];
  let sql = `SELECT fl.*, f.name AS faculty_name
               FROM faculty_leave fl JOIN faculty f ON f.id = fl.faculty_id`;
  if (date) { sql += ' WHERE fl.leave_date = ?'; params.push(date); }
  sql += ' ORDER BY fl.leave_date DESC, f.name';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});
router.post('/leave', requireEditor, async (req, res) => {
  const { faculty_id, leave_date, reason = null } = req.body;
  await pool.query(
    `INSERT INTO faculty_leave (faculty_id, leave_date, reason) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
    [faculty_id, leave_date, reason]
  );
  res.json({ ok: true });
});
router.delete('/leave/:id', requireEditor, async (req, res) => {
  await pool.query('DELETE FROM faculty_leave WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ---- Room blocks ---------------------------------------------------------
router.get('/room-blocks', async (req, res) => {
  const { date } = req.query;
  const params = [];
  let sql = `SELECT rb.*, r.code AS room_code
               FROM room_blocks rb JOIN classrooms r ON r.id = rb.classroom_id`;
  if (date) { sql += ' WHERE rb.block_date = ?'; params.push(date); }
  sql += ' ORDER BY rb.block_date DESC, r.code';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});
router.post('/room-blocks', requireEditor, async (req, res) => {
  const { classroom_id, block_date, reason = null } = req.body;
  await pool.query(
    `INSERT INTO room_blocks (classroom_id, block_date, reason) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
    [classroom_id, block_date, reason]
  );
  res.json({ ok: true });
});
router.delete('/room-blocks/:id', requireEditor, async (req, res) => {
  await pool.query('DELETE FROM room_blocks WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

export default router;
