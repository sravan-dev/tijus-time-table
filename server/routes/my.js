// Self-service endpoints for a logged-in tutor: their own schedule, their own
// leave requests, and sessions they propose. Scoped strictly to
// req.user.faculty_id — a tutor can never read or touch another tutor's rows.
//
// Leave and proposed sessions are created 'pending' and only take effect once
// an admin approves them (see routes/approvals.js).
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Ensure the caller is an account linked to a tutor (faculty) record.
function requireFaculty(req, res, next) {
  if (!req.user.faculty_id)
    return res.status(403).json({ error: 'This account is not linked to a faculty member' });
  next();
}

// GET /api/my/schedule — approved sessions assigned to this tutor.
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
     WHERE a.faculty_id = ? AND a.status = 'approved'`;
  if (from) { sql += ' AND a.alloc_date >= ?'; params.push(from); }
  if (to)   { sql += ' AND a.alloc_date <= ?'; params.push(to); }
  sql += ' ORDER BY a.alloc_date, ts.sort_order';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

// ---- This tutor's own leave requests ------------------------------------
router.get('/leave', requireFaculty, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, leave_date, reason, status, decision_note, decided_at
       FROM faculty_leave WHERE faculty_id = ? ORDER BY leave_date DESC`,
    [req.user.faculty_id]
  );
  res.json(rows);
});

// Apply for leave. Always lands as 'pending' for an admin to decide. Re-applying
// for a date that was rejected resets it to pending with the new reason.
router.post('/leave', requireFaculty, async (req, res) => {
  const { leave_date, reason = null } = req.body || {};
  if (!leave_date) return res.status(400).json({ error: 'leave_date is required' });
  await pool.query(
    `INSERT INTO faculty_leave (faculty_id, leave_date, reason, status, requested_by)
     VALUES (?, ?, ?, 'pending', ?)
     ON DUPLICATE KEY UPDATE
       reason = VALUES(reason), status = 'pending', requested_by = VALUES(requested_by),
       decided_by = NULL, decided_at = NULL, decision_note = NULL`,
    [req.user.faculty_id, leave_date, reason, req.user.id]
  );
  res.json({ ok: true, status: 'pending' });
});

// Withdraw / cancel one of their own leave rows (pending or already approved).
router.delete('/leave/:id', requireFaculty, async (req, res) => {
  // only allow deleting their own leave rows
  await pool.query('DELETE FROM faculty_leave WHERE id = ? AND faculty_id = ?',
    [req.params.id, req.user.faculty_id]);
  res.json({ ok: true });
});

// ---- Sessions this tutor has proposed ------------------------------------
// Everything they requested, whatever its state, newest first. Approved rows
// also show up in /my/schedule; these carry the decision details.
router.get('/sessions', requireFaculty, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.id, a.alloc_date, a.note, a.status, a.decision_note, a.decided_at,
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
      WHERE a.requested_by = ? AND a.faculty_id = ?
      ORDER BY a.alloc_date DESC, ts.sort_order`,
    [req.user.id, req.user.faculty_id]
  );
  res.json(rows);
});

// Propose a session for themselves. faculty_id is forced to the caller's own
// tutor record so a tutor cannot schedule a colleague.
router.post('/sessions', requireFaculty, async (req, res) => {
  const {
    alloc_date, program_id, batch_id = null, activity_id = null,
    time_slot_id, classroom_id = null, note = null,
  } = req.body || {};
  if (!alloc_date || !program_id || !time_slot_id)
    return res.status(400).json({ error: 'alloc_date, program_id and time_slot_id are required' });

  const [r] = await pool.query(
    `INSERT INTO allocations
       (alloc_date, program_id, batch_id, activity_id, time_slot_id, classroom_id,
        faculty_id, note, status, requested_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [alloc_date, program_id, batch_id, activity_id, time_slot_id, classroom_id,
      req.user.faculty_id, note, req.user.id]
  );
  res.json({ id: r.insertId, status: 'pending' });
});

// Withdraw a session request. Only their own, and only while still pending —
// once an admin has approved it, removing it is a timetable edit.
router.delete('/sessions/:id', requireFaculty, async (req, res) => {
  const [r] = await pool.query(
    `DELETE FROM allocations
      WHERE id = ? AND requested_by = ? AND faculty_id = ? AND status = 'pending'`,
    [req.params.id, req.user.id, req.user.faculty_id]
  );
  if (!r.affectedRows)
    return res.status(404).json({ error: 'No pending request of yours with that id' });
  res.json({ ok: true });
});

export default router;
