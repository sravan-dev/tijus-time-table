// Support tickets. Tutors (any logged-in user) raise tickets and reply on their
// own; admins see every ticket, reply, and manage the status. A ticket is a
// subject + a threaded conversation in ticket_messages.
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const isAdmin = (req) => req.user.role === 'admin';

// List tickets: admins see all (optional ?status=), everyone else sees their own.
// ?mine=1 forces own-tickets-only even for admins (their "Raise a ticket" view).
router.get('/', async (req, res) => {
  const { status, mine } = req.query;
  const params = [];
  const where = [];
  if (!isAdmin(req) || mine) { where.push('t.user_id = ?'); params.push(req.user.id); }
  if (['open', 'answered', 'closed'].includes(status)) { where.push('t.status = ?'); params.push(status); }
  const sql = `
    SELECT t.id, t.subject, t.status, t.created_at, t.updated_at,
           u.full_name AS user_name, u.username,
           (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
      FROM tickets t
      JOIN users u ON u.id = t.user_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.updated_at DESC, t.id DESC`;
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

// Raise a ticket: a subject plus the first message body.
router.post('/', async (req, res) => {
  const subject = (req.body?.subject || '').trim();
  const body = (req.body?.body || '').trim();
  if (!subject) return res.status(400).json({ error: 'Subject is required' });
  if (!body) return res.status(400).json({ error: 'Message is required' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      'INSERT INTO tickets (user_id, subject) VALUES (?, ?)', [req.user.id, subject]);
    await conn.query(
      'INSERT INTO ticket_messages (ticket_id, user_id, body) VALUES (?, ?, ?)',
      [r.insertId, req.user.id, body]);
    await conn.commit();
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message || 'Could not raise ticket' });
  } finally {
    conn.release();
  }
});

// One ticket with its full message thread (owner or admin only).
router.get('/:id', async (req, res) => {
  const [[t]] = await pool.query(
    `SELECT t.id, t.subject, t.status, t.user_id, t.created_at, t.updated_at,
            u.full_name AS user_name, u.username
       FROM tickets t JOIN users u ON u.id = t.user_id
      WHERE t.id = ?`, [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (!isAdmin(req) && t.user_id !== req.user.id)
    return res.status(403).json({ error: 'Not allowed' });

  const [messages] = await pool.query(
    `SELECT m.id, m.body, m.created_at, m.user_id,
            u.full_name AS author_name, u.username AS author_username, u.role AS author_role
       FROM ticket_messages m JOIN users u ON u.id = m.user_id
      WHERE m.ticket_id = ? ORDER BY m.created_at, m.id`, [req.params.id]);
  res.json({ ...t, messages });
});

// Reply to a ticket (owner or admin). Replying moves the status:
//  - admin reply -> 'answered'
//  - owner reply -> 'open' (reopens an answered ticket so it returns to the queue)
router.post('/:id/messages', async (req, res) => {
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message is required' });

  const [[t]] = await pool.query(
    'SELECT id, user_id, status FROM tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });

  const admin = isAdmin(req);
  if (!admin && t.user_id !== req.user.id)
    return res.status(403).json({ error: 'Not allowed' });
  if (t.status === 'closed')
    return res.status(409).json({ error: 'This ticket is closed' });

  await pool.query(
    'INSERT INTO ticket_messages (ticket_id, user_id, body) VALUES (?, ?, ?)',
    [t.id, req.user.id, body]);
  const status = admin ? 'answered' : 'open';
  await pool.query(
    'UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, t.id]);
  res.status(201).json({ ok: true, status });
});

// Admin: change a ticket's status (close / reopen / mark answered).
router.patch('/:id', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!['open', 'answered', 'closed'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  const [r] = await pool.query(
    'UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [status, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Ticket not found' });
  res.json({ ok: true });
});

export default router;
