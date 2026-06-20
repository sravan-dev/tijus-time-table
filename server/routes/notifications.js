// Activity feed for the notification bell. Returns role-appropriate items:
//  - admin/viewer: schedule conflicts per day + recent faculty leave applications
//  - faculty: their upcoming sessions, leave records, and leave/schedule clashes
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { conflictsForDate } from '../services/conflicts.js';

const router = Router();
router.use(requireAuth);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${+d} ${MON[+m - 1]} ${y}`;
};

router.get('/', async (req, res) => {
  const { role, faculty_id } = req.user;
  const items = [];

  if (role === 'faculty' && faculty_id) {
    // sessions per scheduled day
    const [days] = await pool.query(
      `SELECT alloc_date, COUNT(*) AS n FROM allocations
        WHERE faculty_id = ? GROUP BY alloc_date ORDER BY alloc_date`, [faculty_id]);
    for (const d of days)
      items.push({
        id: `fs-${d.alloc_date}`, level: 'info', type: 'schedule',
        title: `${d.n} session${d.n > 1 ? 's' : ''} scheduled`,
        detail: fmt(d.alloc_date), date: d.alloc_date,
      });

    // scheduled on a day you're marked on leave
    const [clash] = await pool.query(
      `SELECT a.alloc_date, COUNT(*) AS n
         FROM allocations a
         JOIN faculty_leave fl ON fl.faculty_id = a.faculty_id AND fl.leave_date = a.alloc_date
        WHERE a.faculty_id = ? GROUP BY a.alloc_date`, [faculty_id]);
    for (const c of clash)
      items.push({
        id: `fc-${c.alloc_date}`, level: 'warn', type: 'leave_clash',
        title: `Scheduled on a leave day`,
        detail: `${c.n} session(s) on ${fmt(c.alloc_date)} clash with your leave`, date: c.alloc_date,
      });

    // recent leave records
    const [leaves] = await pool.query(
      `SELECT leave_date, reason FROM faculty_leave WHERE faculty_id = ?
        ORDER BY leave_date DESC LIMIT 5`, [faculty_id]);
    for (const l of leaves)
      items.push({
        id: `lv-${l.leave_date}`, level: 'info', type: 'leave',
        title: `Leave recorded`, detail: `${fmt(l.leave_date)}${l.reason ? ' · ' + l.reason : ''}`, date: l.leave_date,
      });
  } else {
    // admin / viewer: conflicts per day
    const [dates] = await pool.query('SELECT DISTINCT alloc_date FROM allocations ORDER BY alloc_date');
    for (const d of dates) {
      const conf = await conflictsForDate(d.alloc_date);
      const n = Object.keys(conf).length;
      if (n)
        items.push({
          id: `cf-${d.alloc_date}`, level: 'error', type: 'conflict',
          title: `${n} session${n > 1 ? 's' : ''} with conflicts`,
          detail: fmt(d.alloc_date), date: d.alloc_date,
        });
    }
    // recent faculty leave applications
    const [leaves] = await pool.query(
      `SELECT fl.id, fl.leave_date, fl.reason, f.name
         FROM faculty_leave fl JOIN faculty f ON f.id = fl.faculty_id
        ORDER BY fl.id DESC LIMIT 10`);
    for (const l of leaves)
      items.push({
        id: `al-${l.id}`, level: 'info', type: 'leave',
        title: `${l.name} applied for leave`,
        detail: `${fmt(l.leave_date)}${l.reason ? ' · ' + l.reason : ''}`, date: l.leave_date,
      });
  }

  res.json(items);
});

export default router;
