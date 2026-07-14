// Support assistant: any signed-in user can email an urgent bug report / request
// straight to the team. Delivered via a dedicated Gmail SMTP account (see
// sendSupportMail), with the reporter set as Reply-To when they have a real
// email so a reply reaches them directly.
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { sendSupportMail } from '../services/mailer.js';
import { getSettings } from '../services/settings.js';

const router = Router();
router.use(requireAuth);

const DEFAULT_SUPPORT_EMAIL = 'sravan@tijusacademy.com';

// A pragmatic "looks like an email" check. Logins in this deployment are often
// email-style usernames, but some (e.g. "admin") are not — those must not be
// used as Reply-To, or the mail provider rejects the whole message.
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim());

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

router.post('/', async (req, res) => {
  const subject = (req.body?.subject || '').trim();
  const message = (req.body?.message || '').trim();
  if (!subject) return res.status(400).json({ error: 'Subject is required' });
  if (!message) return res.status(400).json({ error: 'Message is required' });

  // Resolve the reporter's email: their linked faculty email if present,
  // otherwise their login username (email-style for most, but not all, accounts).
  let reporterEmail = req.user.username;
  if (req.user.faculty_id) {
    const [[f]] = await pool.query('SELECT email FROM faculty WHERE id = ?', [req.user.faculty_id]);
    if (f?.email) reporterEmail = f.email;
  }
  const reporter = req.user.name || req.user.username;
  // Only a valid address can be a Reply-To; otherwise omit it so the send still
  // succeeds (the reporter's username is still shown in the body either way).
  const replyTo = isEmail(reporterEmail) ? reporterEmail : undefined;

  const settings = await getSettings();
  const to = settings.support_email || DEFAULT_SUPPORT_EMAIL;
  const appTitle = settings.app_title || 'Tijus Academy';

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2233">
      <h2 style="color:#303070;margin:0 0 8px">${escapeHtml(appTitle)} · Support request</h2>
      <p style="margin:0 0 4px"><b>From:</b> ${escapeHtml(reporter)} &lt;${escapeHtml(reporterEmail)}&gt;</p>
      <p style="margin:0 0 12px"><b>Role:</b> ${escapeHtml(req.user.role)}</p>
      <p style="margin:0 0 4px"><b>Subject:</b> ${escapeHtml(subject)}</p>
      <div style="white-space:pre-wrap;border-left:3px solid #ececf7;padding:8px 12px;margin-top:8px">${escapeHtml(message)}</div>
    </div>`;
  const text = `From: ${reporter} <${reporterEmail}>\nRole: ${req.user.role}\nSubject: ${subject}\n\n${message}`;

  try {
    await sendSupportMail({ to, subject: `[Support] ${subject}`, html, text, replyTo });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not send support request' });
  }
});

export default router;
