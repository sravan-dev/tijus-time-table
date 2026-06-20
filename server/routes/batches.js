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
  sql += ' ORDER BY p.code, b.name';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

router.post('/', requireEditor, async (req, res) => {
  const { name, program_id, student_count = 0, home_room_id = null, exam_month = null } = req.body;
  const [r] = await pool.query(
    `INSERT INTO batches (name, program_id, student_count, home_room_id, exam_month)
     VALUES (?, ?, ?, ?, ?)`,
    [name, program_id, student_count, home_room_id, exam_month]
  );
  res.json({ id: r.insertId });
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
