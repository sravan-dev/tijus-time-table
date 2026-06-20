import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getSettings, setSettings } from '../services/settings.js';
import { sendMail } from '../services/mailer.js';

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

// Full settings for the admin Settings page. Never return the SMTP password;
// expose only whether one is set.
router.get('/', async (_req, res) => {
  const s = await getSettings();
  const { smtp_password, ...rest } = s;
  res.json({ ...rest, smtp_has_password: smtp_password ? '1' : '0' });
});

router.put('/', async (req, res) => {
  const allowed = [
    'app_title', 'app_logo', 'timezone',
    'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from', 'smtp_enabled',
  ];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
  // password only updated when a non-empty value is supplied
  if (req.body.smtp_password) patch.smtp_password = req.body.smtp_password;
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

export default router;
