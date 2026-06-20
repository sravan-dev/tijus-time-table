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
  let sql = SELECT + ' WHERE a.alloc_date = ?';
  if (program_id) { sql += ' AND a.program_id = ?'; params.push(program_id); }
  sql += ' ORDER BY p.code, a.batch_id, ts.sort_order';
  const [rows] = await pool.query(sql, params);
  const conflicts = await conflictsForDate(date);
  res.json({ allocations: rows, conflicts });
});

// distinct dates that have data (for the date picker)
router.get('/dates', async (_req, res) => {
  const [rows] = await pool.query(
    'SELECT DISTINCT alloc_date FROM allocations ORDER BY alloc_date'
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

router.delete('/:id', requireEditor, async (req, res) => {
  await pool.query('DELETE FROM allocations WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

export default router;
