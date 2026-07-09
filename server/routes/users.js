// User & credential management. Admin-only; passwords are bcrypt-hashed and
// never returned to the client.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { sendMail, credentialsEmail } from '../services/mailer.js';
import { getSettings } from '../services/settings.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const ROLES = ['admin', 'manager', 'viewer', 'faculty'];

// A readable temporary password: no 0/O/1/l/I to survive being retyped by hand.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function generatePassword(len = 12) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

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
    `SELECT f.id AS faculty_id, f.name AS faculty_name, f.email,
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

// Resolves the faculty record a new tutor login attaches to, creating one when
// needed. A tutor is always scoped to exactly one faculty record (otherwise
// /api/my/* could not tell whose schedule to serve), but the admin shouldn't
// have to create that record separately — adding the user is enough.
//
// Given an explicit faculty_id we use it; otherwise we match on name, reusing an
// existing record when it has no login yet and creating one when there is none.
// Runs on `conn` so it rolls back with the user insert.
// The email lives on the faculty record (users has no email column) — it is what
// schedule and session-assignment notices are sent to.
async function resolveTutorFaculty(conn, { faculty_id, full_name, email }) {
  if (faculty_id) {
    const [[fac]] = await conn.query('SELECT id FROM faculty WHERE id = ?', [faculty_id]);
    if (!fac) return { error: 404, message: 'Faculty not found' };
  }
  // The record is named after the tutor, so a real name is required — falling
  // back to the username would create faculty called things like "jsmith92".
  const name = (full_name || '').trim();
  const addr = (email || '').trim() || null;
  if (!faculty_id && !name)
    return { error: 400, message: 'A full name is required to create a tutor' };

  let id = faculty_id;
  if (!id) {
    // faculty.name is UNIQUE, so an existing record with this name is *the*
    // record for this person — reuse it rather than failing on the constraint.
    const [[existing]] = await conn.query('SELECT id FROM faculty WHERE name = ?', [name]);
    if (existing) {
      id = existing.id;
    } else {
      const [ins] = await conn.query(
        'INSERT INTO faculty (name, email, active) VALUES (?, ?, 1)', [name, addr]);
      return { id: ins.insertId, created: true };
    }
  }

  // Each faculty record gets at most one login.
  const [[taken]] = await conn.query(
    "SELECT id FROM users WHERE faculty_id = ? AND role IN ('faculty','manager')", [id]);
  if (taken) return { error: 409, message: 'That faculty member already has a login' };

  // Reusing an existing record: fill in the address the admin just typed. Only
  // when one was given, so leaving the field blank never wipes a stored address.
  if (addr) await conn.query('UPDATE faculty SET email = ? WHERE id = ?', [addr, id]);
  return { id, created: false };
}

// Email a tutor their login details, resetting the password to a fresh one.
// The stored password is a bcrypt hash and cannot be read back, so "resend"
// necessarily means "reset and send" — the mail is the only copy that exists.
//
// An `email` in the body is saved to the faculty record first, so an admin can
// fill in a missing address at the moment of sending.
router.post('/faculty/:facultyId/resend-credentials', async (req, res) => {
  const facultyId = Number(req.params.facultyId);
  const typed = (req.body?.email || '').trim();

  const [[fac]] = await pool.query('SELECT id, name, email FROM faculty WHERE id = ?', [facultyId]);
  if (!fac) return res.status(404).json({ error: 'Faculty not found' });

  const [[user]] = await pool.query(
    "SELECT id, username FROM users WHERE faculty_id = ? AND role IN ('faculty','manager')", [facultyId]);
  if (!user)
    return res.status(400).json({ error: 'That faculty member has no login yet — create one first' });

  const settings = await getSettings();
  if (settings.smtp_enabled !== '1')
    return res.status(400).json({ error: 'Email is disabled — enable it in Settings first' });

  const to = typed || fac.email;
  if (!to) return res.status(400).json({ error: 'No email address on file for this tutor' });
  if (typed && typed !== fac.email)
    await pool.query('UPDATE faculty SET email = ? WHERE id = ?', [typed, facultyId]);

  const password = generatePassword();
  const { subject, html, text } = credentialsEmail(
    fac.name, { username: user.username, password, url: req.headers.origin || null },
    settings.app_title
  );

  // Send BEFORE storing the new hash. If the mail fails, the tutor keeps their
  // existing password rather than being locked out of an account whose new
  // password nobody ever received.
  try {
    await sendMail({ to, subject, html, text });
  } catch (e) {
    return res.status(502).json({ error: `Could not send the email: ${e.message}` });
  }
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?',
    [await bcrypt.hash(password, 10), user.id]);

  res.json({ ok: true, sent_to: to });
});

router.post('/', async (req, res) => {
  const { username, password, full_name = null, role = 'viewer',
    faculty_id = null, email = null } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'username and password are required' });
  if (!ROLES.includes(role))
    return res.status(400).json({ error: 'invalid role' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let facultyId = null;
    if (role === 'faculty') {
      const r = await resolveTutorFaculty(conn, { faculty_id, full_name, email });
      if (r.error) {
        await conn.rollback();
        return res.status(r.error).json({ error: r.message });
      }
      facultyId = r.id;
    }

    const hash = await bcrypt.hash(password, 10);
    const [r] = await conn.query(
      'INSERT INTO users (username, password_hash, full_name, role, faculty_id) VALUES (?, ?, ?, ?, ?)',
      [username, hash, full_name, role, facultyId]
    );
    await conn.commit();
    res.json({ id: r.insertId, faculty_id: facultyId });
  } catch (e) {
    await conn.rollback();   // a duplicate username must not leave a stray faculty row
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Username already exists' });
    throw e;
  } finally {
    conn.release();
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
