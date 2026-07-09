import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireEditor } from '../middleware/auth.js';
import { conflictsForDate } from '../services/conflicts.js';
import { sendMail, scheduleEmail } from '../services/mailer.js';
import { getSettings } from '../services/settings.js';

const router = Router();
router.use(requireAuth);

const SELECT = `
  SELECT a.*, p.code AS program_code,
         b.name AS batch_name, b.student_count,
         ac.code AS activity_code, ac.name AS activity_name,
         ts.label AS slot_label, ts.sort_order AS slot_order,
         r.code AS room_code, r.capacity AS room_capacity,
         f.name AS faculty_name
    FROM allocations a
    JOIN programs p     ON p.id = a.program_id
    LEFT JOIN batches b ON b.id = a.batch_id
    LEFT JOIN activities ac ON ac.id = a.activity_id
    JOIN time_slots ts  ON ts.id = a.time_slot_id
    LEFT JOIN classrooms r ON r.id = a.classroom_id
    LEFT JOIN faculty f ON f.id = a.faculty_id`;

// GET /api/allocations?date=YYYY-MM-DD[&program_id=]
router.get('/', async (req, res) => {
  const { date, program_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });
  const params = [date];
  // Rejected requests are kept for the tutor's own history but never belong in
  // the grid; pending ones show through, badged, so admins can judge in context.
  let sql = SELECT + " WHERE a.alloc_date = ? AND a.status <> 'rejected'";
  if (program_id) { sql += ' AND a.program_id = ?'; params.push(program_id); }
  sql += ' ORDER BY p.code, a.batch_id, ts.sort_order';
  const [rows] = await pool.query(sql, params);
  const conflicts = await conflictsForDate(date);
  res.json({ allocations: rows, conflicts });
});

// distinct dates that have data (for the date picker)
router.get('/dates', async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT DISTINCT alloc_date FROM allocations WHERE status <> 'rejected' ORDER BY alloc_date"
  );
  res.json(rows.map((r) => r.alloc_date));
});

router.get('/conflicts', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });
  res.json(await conflictsForDate(date));
});

// Email each faculty (who has an address) their schedule for a date.
// Intended to be run after allocations are finalised.
router.post('/notify', requireEditor, async (req, res) => {
  const { date } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date is required' });
  const settings = await getSettings();
  if (settings.smtp_enabled !== '1')
    return res.status(400).json({ error: 'Email is disabled — enable SMTP in Settings first' });

  const [rows] = await pool.query(
    `SELECT a.faculty_id, f.name AS faculty_name, f.email,
            ac.code AS activity_code, ac.name AS activity_name,
            ts.label AS slot_label, ts.sort_order,
            p.code AS program_code, b.name AS batch_name, r.code AS room_code
       FROM allocations a
       JOIN faculty f      ON f.id = a.faculty_id
       JOIN programs p     ON p.id = a.program_id
       LEFT JOIN batches b ON b.id = a.batch_id
       LEFT JOIN activities ac ON ac.id = a.activity_id
       JOIN time_slots ts  ON ts.id = a.time_slot_id
       LEFT JOIN classrooms r ON r.id = a.classroom_id
      WHERE a.alloc_date = ? AND a.faculty_id IS NOT NULL AND f.email IS NOT NULL AND f.email <> ''
      ORDER BY a.faculty_id, ts.sort_order`,
    [date]
  );

  // group sessions per faculty
  const byFac = new Map();
  for (const r of rows) {
    if (!byFac.has(r.faculty_id))
      byFac.set(r.faculty_id, { name: r.faculty_name, email: r.email, sessions: [] });
    byFac.get(r.faculty_id).sessions.push(r);
  }

  let sent = 0;
  const failures = [];
  for (const fac of byFac.values()) {
    try {
      const { subject, html } = scheduleEmail(fac.name, date, fac.sessions, settings.app_title);
      await sendMail({ to: fac.email, subject, html });
      sent++;
    } catch (e) {
      failures.push({ faculty: fac.name, error: e.message });
    }
  }
  res.json({ sent, total: byFac.size, skipped_no_email: 0, failures });
});

// POST /api/allocations/generate { date, program_id? }
// Creates the timetable for an empty day by copying the most recent earlier
// day that has sessions — preferring the same weekday (last Monday for a
// Monday, etc.) so the weekly pattern carries over. Refuses if the target
// day already has sessions (for the program, when one is given).
router.post('/generate', requireEditor, async (req, res) => {
  const { date, program_id } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date is required' });
  const progFilter = program_id ? ' AND program_id = ?' : '';
  const progParams = program_id ? [program_id] : [];

  const [[existing]] = await pool.query(
    `SELECT COUNT(*) AS n FROM allocations WHERE alloc_date = ?${progFilter}`,
    [date, ...progParams]
  );
  if (existing.n)
    return res.status(409).json({ error: 'That day already has sessions' });

  const [cands] = await pool.query(
    `SELECT DISTINCT alloc_date FROM allocations WHERE alloc_date < ?${progFilter}
      ORDER BY alloc_date DESC`,
    [date, ...progParams]
  );
  if (!cands.length)
    return res.status(400).json({ error: 'No earlier day to copy from' });
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const sameWeekday = cands.find(
    (r) => new Date(r.alloc_date + 'T00:00:00Z').getUTCDay() === weekday
  );
  const source = (sameWeekday || cands[0]).alloc_date;

  const [r] = await pool.query(
    `INSERT INTO allocations (alloc_date, program_id, batch_id, activity_id, time_slot_id,
                              classroom_id, faculty_id, student_count, raw_text, note)
     SELECT ?, program_id, batch_id, activity_id, time_slot_id,
            classroom_id, faculty_id, student_count, raw_text, note
       FROM allocations WHERE alloc_date = ?${progFilter}`,
    [date, source, ...progParams]
  );
  res.json({ created: r.affectedRows, source_date: source });
});

const fields = ['alloc_date', 'program_id', 'batch_id', 'activity_id',
  'time_slot_id', 'classroom_id', 'faculty_id', 'student_count', 'note'];

router.post('/', requireEditor, async (req, res) => {
  const vals = fields.map((f) => req.body[f] ?? null);
  const [r] = await pool.query(
    `INSERT INTO allocations (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
    vals
  );
  res.json({ id: r.insertId });
});

router.put('/:id', requireEditor, async (req, res) => {
  const sets = fields.filter((f) => f in req.body);
  if (!sets.length) return res.json({ ok: true });
  await pool.query(
    `UPDATE allocations SET ${sets.map((f) => `${f}=?`).join(',')} WHERE id=?`,
    [...sets.map((f) => req.body[f] ?? null), req.params.id]
  );
  res.json({ ok: true });
});

// DELETE /api/allocations?date=YYYY-MM-DD[&program_id=] — clear a whole
// day's table (for one program when program_id is given).
router.delete('/', requireEditor, async (req, res) => {
  const { date, program_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });
  const params = [date];
  let sql = 'DELETE FROM allocations WHERE alloc_date = ?';
  if (program_id) { sql += ' AND program_id = ?'; params.push(program_id); }
  const [r] = await pool.query(sql, params);
  res.json({ deleted: r.affectedRows });
});

router.delete('/:id', requireEditor, async (req, res) => {
  await pool.query('DELETE FROM allocations WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

export default router;
