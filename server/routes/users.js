// User & credential management. Admin-only; passwords are bcrypt-hashed and
// never returned to the client.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const ROLES = ['admin', 'manager', 'viewer', 'faculty'];

router.get('/', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.full_name, u.role, u.faculty_id, u.created_at,
            f.name AS faculty_name
       FROM users u LEFT JOIN faculty f ON f.id = u.faculty_id
      ORDER BY u.role, u.username`
  );
  res.json(rows);
});

// All faculty with whether they already have a login — drives the
// "Faculty logins" section on the Users page.
router.get('/faculty-accounts', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT f.id AS faculty_id, f.name AS faculty_name,
            u.id AS user_id, u.username, u.role
       FROM faculty f
       LEFT JOIN users u ON u.faculty_id = f.id AND u.role IN ('faculty','manager')
      WHERE f.active = 1
      ORDER BY f.name`
  );
  res.json(rows);
});

// Create or update the login for a specific faculty member (set/reset password).
// A faculty can be given a plain 'faculty' login or a 'manager' login (a tutor
// who also manages); either way the account stays linked to their faculty record.
router.post('/faculty/:facultyId/credentials', async (req, res) => {
  const facultyId = Number(req.params.facultyId);
  const { username, password, role = 'faculty' } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'username and password are required' });
  if (!['faculty', 'manager'].includes(role))
    return res.status(400).json({ error: 'role must be faculty or manager' });
  const [[fac]] = await pool.query('SELECT id, name FROM faculty WHERE id = ?', [facultyId]);
  if (!fac) return res.status(404).json({ error: 'Faculty not found' });

  const hash = await bcrypt.hash(password, 10);
  const [[existing]] = await pool.query(
    "SELECT id FROM users WHERE faculty_id = ? AND role IN ('faculty','manager')", [facultyId]
  );
  try {
    if (existing) {
      await pool.query(
        'UPDATE users SET username = ?, password_hash = ?, full_name = ?, role = ? WHERE id = ?',
        [username, hash, fac.name, role, existing.id]
      );
      res.json({ id: existing.id, updated: true });
    } else {
      const [r] = await pool.query(
        `INSERT INTO users (username, password_hash, full_name, role, faculty_id)
         VALUES (?, ?, ?, ?, ?)`,
        [username, hash, fac.name, role, facultyId]
      );
      res.json({ id: r.insertId, created: true });
    }
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Username already exists' });
    throw e;
  }
});

router.post('/', async (req, res) => {
  const { username, password, full_name = null, role = 'viewer', faculty_id = null } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'username and password are required' });
  if (!ROLES.includes(role))
    return res.status(400).json({ error: 'invalid role' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query(
      'INSERT INTO users (username, password_hash, full_name, role, faculty_id) VALUES (?, ?, ?, ?, ?)',
      [username, hash, full_name, role, role === 'faculty' ? faculty_id : null]
    );
    res.json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Username already exists' });
    throw e;
  }
});

router.put('/:id', async (req, res) => {
  const { username, full_name, role, password } = req.body || {};
  if (role && !ROLES.includes(role))
    return res.status(400).json({ error: 'invalid role' });

  const sets = [];
  const vals = [];
  if (username !== undefined) { sets.push('username = ?'); vals.push(username); }
  if (full_name !== undefined) { sets.push('full_name = ?'); vals.push(full_name); }
  if (role !== undefined) { sets.push('role = ?'); vals.push(role); }
  if (password) { sets.push('password_hash = ?'); vals.push(await bcrypt.hash(password, 10)); }
  if (!sets.length) return res.json({ ok: true });

  // Guard against removing the last admin.
  if (role === 'viewer') {
    const [[me]] = await pool.query('SELECT role FROM users WHERE id = ?', [req.params.id]);
    if (me?.role === 'admin') {
      const [[{ admins }]] = await pool.query(
        "SELECT COUNT(*) AS admins FROM users WHERE role = 'admin'");
      if (admins <= 1)
        return res.status(400).json({ error: 'Cannot demote the last remaining admin' });
    }
  }

  try {
    vals.push(req.params.id);
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Username already exists' });
    throw e;
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id)
    return res.status(400).json({ error: 'You cannot delete your own account' });
  const [[me]] = await pool.query('SELECT role FROM users WHERE id = ?', [id]);
  if (me?.role === 'admin') {
    const [[{ admins }]] = await pool.query(
      "SELECT COUNT(*) AS admins FROM users WHERE role = 'admin'");
    if (admins <= 1)
      return res.status(400).json({ error: 'Cannot delete the last remaining admin' });
  }
  await pool.query('DELETE FROM users WHERE id = ?', [id]);
  res.json({ ok: true });
});

export default router;
