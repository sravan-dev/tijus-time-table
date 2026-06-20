import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { sign, requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'username and password required' });
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: 'Invalid credentials' });
  res.json({
    token: sign(user),
    user: {
      id: user.id, username: user.username, role: user.role,
      name: user.full_name, faculty_id: user.faculty_id ?? null,
    },
  });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

export default router;
