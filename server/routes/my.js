// Self-service endpoints for a logged-in faculty member: their own schedule
// and their own leave. Scoped strictly to req.user.faculty_id.
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Ensure the caller is a faculty account linked to a tutor record.
function requireFaculty(req, res, next) {
  if (!req.user.faculty_id)
    return res.status(403).json({ error: 'This account is not linked to a faculty member' });
  next();
}

// GET /api/my/schedule — all sessions assigned to this faculty, grouped client-side.
router.get('/schedule', requireFaculty, async (req, res) => {
  const { from, to } = req.query;
  const params = [req.user.faculty_id];
  let sql = `
    SELECT a.id, a.alloc_date, a.raw_text, a.note,
           p.code AS program_code,
           b.name AS batch_name,
           ac.code AS activity_code, ac.name AS activity_name,
           ts.label AS slot_label, ts.sort_order AS slot_order,
           r.code AS room_code
      FROM allocations a
      JOIN programs p     ON p.id = a.program_id
      LEFT JOIN batches b ON b.id = a.batch_id
      LEFT JOIN activities ac ON ac.id = a.activity_id
      JOIN time_slots ts  ON ts.id = a.time_slot_id
      LEFT JOIN classrooms r ON r.id = a.classroom_id
     WHERE a.faculty_id = ?`;
  if (from) { sql += ' AND a.alloc_date >= ?'; params.push(from); }
  if (to)   { sql += ' AND a.alloc_date <= ?'; params.push(to); }
  sql += ' ORDER BY a.alloc_date, ts.sort_order';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

// ---- This faculty's own leave -------------------------------------------
router.get('/leave', requireFaculty, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, leave_date, reason FROM faculty_leave WHERE faculty_id = ? ORDER BY leave_date DESC',
    [req.user.faculty_id]
  );
  res.json(rows);
});

router.post('/leave', requireFaculty, async (req, res) => {
  const { leave_date, reason = null } = req.body || {};
  if (!leave_date) return res.status(400).json({ error: 'leave_date is required' });
  await pool.query(
    `INSERT INTO faculty_leave (faculty_id, leave_date, reason) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
    [req.user.faculty_id, leave_date, reason]
  );
  res.json({ ok: true });
});

router.delete('/leave/:id', requireFaculty, async (req, res) => {
  // only allow deleting their own leave rows
  await pool.query('DELETE FROM faculty_leave WHERE id = ? AND faculty_id = ?',
    [req.params.id, req.user.faculty_id]);
  res.json({ ok: true });
});

export default router;
