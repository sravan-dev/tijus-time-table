import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getSettings, setSettings } from '../services/settings.js';
import { sendMail } from '../services/mailer.js';
import { dumpDatabase, clearTimetableData } from '../db/maintenance.js';

const router = Router();

// Public branding (title, logo, timezone) — used app-wide incl. the login page.
router.get('/public', async (_req, res) => {
  const s = await getSettings();
  res.json({
    app_title: s.app_title || 'Tijus Academy',
    app_logo: s.app_logo || '',
    timezone: s.timezone || 'Asia/Kolkata',
  });
});

router.use(requireAuth, requireAdmin);

// Full settings for the admin Settings page. Never return secrets (SMTP
// password, Resend API key); expose only whether each is set.
router.get('/', async (_req, res) => {
  const s = await getSettings();
  const { smtp_password, resend_api_key, ...rest } = s;
  res.json({
    ...rest,
    smtp_has_password: smtp_password ? '1' : '0',
    resend_has_key: resend_api_key ? '1' : '0',
  });
});

router.put('/', async (req, res) => {
  const allowed = [
    'app_title', 'app_logo', 'timezone',
    'mail_provider',
    'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from', 'smtp_enabled',
  ];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
  // secrets only updated when a non-empty value is supplied (blank = keep existing)
  if (req.body.smtp_password) patch.smtp_password = req.body.smtp_password;
  if (req.body.resend_api_key) patch.resend_api_key = req.body.resend_api_key;
  await setSettings(patch);
  res.json({ ok: true });
});

router.post('/test-email', async (req, res) => {
  const { to } = req.body || {};
  if (!to) return res.status(400).json({ error: 'Recipient address is required' });
  try {
    const s = await getSettings();
    await sendMail({
      to,
      subject: `${s.app_title || 'Tijus Academy'} · SMTP test`,
      html: `<p>This is a test email from <b>${s.app_title || 'Tijus Academy'}</b>. SMTP is working ✅</p>`,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Database management (admin) ----------------------------------------

// Download a full MySQL .sql backup of the database.
router.get('/db/export', async (_req, res) => {
  try {
    const sql = await dumpDatabase();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tijus-timetable-${stamp}.sql"`);
    res.send(sql);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Export failed' });
  }
});

// Wipe all timetable + reference data (keeps users and settings). Guarded by a
// confirmation token so the destructive call can't fire by accident.
router.post('/db/clear', async (req, res) => {
  if (req.body?.confirm !== 'CLEAR')
    return res.status(400).json({ error: 'Confirmation token required' });
  try {
    await clearTimetableData();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Clear failed' });
  }
});

export default router;
