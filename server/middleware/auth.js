import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret';

export function sign(user) {
  return jwt.sign(
    {
      id: user.id, username: user.username, role: user.role,
      name: user.full_name, faculty_id: user.faculty_id ?? null,
    },
    SECRET,
    { expiresIn: '12h' }
  );
}

// Requires a valid token; attaches req.user.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Requires the authenticated user to be an admin (Users & Settings).
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Requires edit access: admin OR manager. Used for timetable, allocations,
// batches, faculty/rooms, and leave/blocks — everything except Users & Settings.
export function requireEditor(req, res, next) {
  if (!['admin', 'manager'].includes(req.user?.role))
    return res.status(403).json({ error: 'Editor access required' });
  next();
}
