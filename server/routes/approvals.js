// Admin approval queues for tutor-submitted leave and tutor-proposed sessions.
// A tutor's request lands 'pending'; nothing here takes effect in the timetable
// or the rules engine until an admin approves it (see services/conflicts.js).
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const OUTCOME = { approve: 'approved', reject: 'rejected' };

// Records the decision on one pending row of `table`. Returns false when the id
// does not exist or has already been decided, so a double-click can't re-decide.
async function decide(table, id, status, req) {
  const [r] = await pool.query(
    `UPDATE ${table}
        SET status = ?, decided_by = ?, decided_at = NOW(), decision_note = ?
      WHERE id = ? AND status = 'pending'`,
    [status, req.user.id, (req.body?.note || '').trim() || null, id]
  );
  return r.affectedRows > 0;
}

// Badge counts for the nav item.
router.get('/counts', async (_req, res) => {
  const [[leave]] = await pool.query(
    "SELECT COUNT(*) AS n FROM faculty_leave WHERE status = 'pending'");
  const [[sessions]] = await pool.query(
    "SELECT COUNT(*) AS n FROM allocations WHERE status = 'pending'");
  res.json({ leave: leave.n, sessions: sessions.n, total: leave.n + sessions.n });
});

// ---- Leave requests ------------------------------------------------------
router.get('/leave', async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
    ? req.query.status : 'pending';
  const [rows] = await pool.query(
    `SELECT fl.id, fl.leave_date, fl.reason, fl.status, fl.decided_at, fl.decision_note,
            f.name AS faculty_name,
            u.full_name AS requested_by_name, u.username AS requested_by_username
       FROM faculty_leave fl
       JOIN faculty f      ON f.id = fl.faculty_id
       LEFT JOIN users u   ON u.id = fl.requested_by
      WHERE fl.status = ?
      ORDER BY fl.leave_date, f.name`,
    [status]
  );
  res.json(rows);
});

router.post('/leave/:id/:decision', async (req, res) => {
  const status = OUTCOME[req.params.decision];
  if (!status) return res.status(400).json({ error: 'decision must be approve or reject' });
  const ok = await decide('faculty_leave', req.params.id, status, req);
  if (!ok) return res.status(404).json({ error: 'No pending leave request with that id' });
  res.json({ ok: true, status });
});

// ---- Proposed sessions ---------------------------------------------------
router.get('/sessions', async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
    ? req.query.status : 'pending';
  const [rows] = await pool.query(
    `SELECT a.id, a.alloc_date, a.note, a.status, a.decided_at, a.decision_note,
            p.code AS program_code,
            b.name AS batch_name,
            ac.code AS activity_code, ac.name AS activity_name,
            ts.label AS slot_label, ts.sort_order AS slot_order,
            r.code AS room_code,
            f.name AS faculty_name,
            u.full_name AS requested_by_name, u.username AS requested_by_username
       FROM allocations a
       JOIN programs p         ON p.id = a.program_id
       LEFT JOIN batches b     ON b.id = a.batch_id
       LEFT JOIN activities ac ON ac.id = a.activity_id
       JOIN time_slots ts      ON ts.id = a.time_slot_id
       LEFT JOIN classrooms r  ON r.id = a.classroom_id
       LEFT JOIN faculty f     ON f.id = a.faculty_id
       LEFT JOIN users u       ON u.id = a.requested_by
      WHERE a.status = ?
      ORDER BY a.alloc_date, ts.sort_order`,
    [status]
  );
  res.json(rows);
});

router.post('/sessions/:id/:decision', async (req, res) => {
  const status = OUTCOME[req.params.decision];
  if (!status) return res.status(400).json({ error: 'decision must be approve or reject' });
  const ok = await decide('allocations', req.params.id, status, req);
  if (!ok) return res.status(404).json({ error: 'No pending session request with that id' });
  res.json({ ok: true, status });
});

export default router;
