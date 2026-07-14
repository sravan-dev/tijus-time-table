import nodemailer from 'nodemailer';
import { getSettings } from './settings.js';

// Send via an SMTP server using nodemailer.
async function sendViaSmtp(s, { from, to, subject, html, text, replyTo }) {
  if (!s.smtp_host) throw new Error('SMTP host is not configured');
  const transport = nodemailer.createTransport({
    host: s.smtp_host,
    port: Number(s.smtp_port) || 587,
    secure: s.smtp_secure === '1',
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_password } : undefined,
  });
  return transport.sendMail({ from: from || s.smtp_user, to, subject, html, text, replyTo });
}

// Send via the Resend HTTP API (https://resend.com). The "from" must use a
// domain verified in the Resend dashboard.
async function sendViaResend(s, { from, to, subject, html, text, replyTo }) {
  if (!s.resend_api_key) throw new Error('Resend API key is not configured');
  if (!from) throw new Error('A From address is required for Resend');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${s.resend_api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html, text, reply_to: replyTo || undefined }),
  });
  if (!res.ok) {
    let msg = `Resend error ${res.status}`;
    try { const j = await res.json(); msg = j.message || j.error?.message || j.name || msg; } catch { /* non-JSON */ }
    throw new Error(msg);
  }
  return res.json();
}

export async function sendMail({ to, subject, html, text, replyTo }) {
  const s = await getSettings();
  if (s.smtp_enabled !== '1') throw new Error('Email is disabled in Settings');
  const from = s.smtp_from || s.smtp_user;
  const provider = s.mail_provider === 'resend' ? 'resend' : 'smtp';
  return provider === 'resend'
    ? sendViaResend(s, { from, to, subject, html, text, replyTo })
    : sendViaSmtp(s, { from, to, subject, html, text, replyTo });
}

// Support-form mail goes through a dedicated Gmail SMTP account, independent of
// the app-wide provider (Resend) in Settings. That keeps support reachable even
// if the main provider is misconfigured, and lets it come from a mailbox the
// team monitors. Credentials live in server/.env (SUPPORT_SMTP_*), never in the
// database or the repo.
export async function sendSupportMail({ to, subject, html, text, replyTo }) {
  const user = process.env.SUPPORT_SMTP_USER;
  // App passwords are shown grouped ("cufp fkuv qnpd qzzl"); the spaces aren't
  // part of the secret, so strip any whitespace before authenticating.
  const pass = (process.env.SUPPORT_SMTP_PASS || '').replace(/\s+/g, '');
  if (!user || !pass)
    throw new Error('Support email is not configured (SUPPORT_SMTP_USER / SUPPORT_SMTP_PASS)');

  const recipient = to || process.env.SUPPORT_EMAIL_TO || 'sravan@tijusacademy.com';
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  // Gmail forces From to the authenticated mailbox, so send as that account with
  // a friendly name; the reporter (when known) goes in Reply-To.
  return transport.sendMail({
    from: `Tijus Timetable Support <${user}>`,
    to: recipient,
    subject,
    html,
    text,
    replyTo: replyTo || undefined,
  });
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${+d} ${MON[+m - 1]} ${y}`;
};

// Compose the login details sent to a tutor. The password is included in the
// clear because it was just generated and has never been stored in readable
// form — this mail is the only copy, so it tells them to change it.
export function credentialsEmail(facultyName, { username, password, url }, appTitle) {
  const app = appTitle || 'Tijus Academy';
  const cell = 'padding:6px 10px;border:1px solid #e6e6f0';
  const row = (k, v) => `<tr>
      <td style="${cell};background:#ececf7;text-align:left"><b>${k}</b></td>
      <td style="${cell};font-family:Consolas,monospace">${v}</td>
    </tr>`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2233">
      <h2 style="color:#303070;margin:0 0 4px">${app}</h2>
      <p>Hi ${facultyName}, here are your login details:</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${row('Username', username)}
        ${row('Password', password)}
      </table>
      ${url ? `<p style="margin-top:14px">Sign in at <a href="${url}">${url}</a></p>` : ''}
      <p style="color:#b42318;font-size:13px;margin-top:14px">
        This password was just reset, so any previous one no longer works.
        Please change it after signing in.
      </p>
      <p style="color:#6b7090;font-size:12px;margin-top:16px">Sent by ${app}. If you didn’t expect this, contact the office.</p>
    </div>`;
  const text = `Hi ${facultyName}, here are your login details.\n`
    + `Username: ${username}\nPassword: ${password}\n`
    + (url ? `Sign in at ${url}\n` : '')
    + 'This password was just reset; any previous one no longer works.';
  return { subject: `Your ${app} login details`, html, text };
}

// Compose the note a tutor gets when a single session is assigned to them.
export function sessionAssignedEmail(facultyName, s, appTitle) {
  const app = appTitle || 'Tijus Academy';
  const cell = 'padding:6px 10px;border:1px solid #e6e6f0';
  const row = (k, v) => `<tr>
      <td style="${cell};background:#ececf7;text-align:left"><b>${k}</b></td>
      <td style="${cell}">${v || '—'}</td>
    </tr>`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2233">
      <h2 style="color:#303070;margin:0 0 4px">${app}</h2>
      <p>Hi ${facultyName}, a session has been assigned to you:</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${row('Date', fmtDate(s.alloc_date))}
        ${row('Time', s.slot_label)}
        ${row('Program', s.program_code)}
        ${row('Batch', s.batch_name)}
        ${row('Activity', s.activity_name || s.activity_code)}
        ${row('Room', s.room_code)}
        ${s.note ? row('Note', s.note) : ''}
      </table>
      <p style="color:#6b7090;font-size:12px;margin-top:16px">Sent automatically by ${app} when the session was allocated.</p>
    </div>`;
  const text = `Hi ${facultyName}, a session has been assigned to you.\n`
    + `${fmtDate(s.alloc_date)} · ${s.slot_label} · ${s.program_code}`
    + `${s.batch_name ? ' · ' + s.batch_name : ''}`
    + `${s.room_code ? ' · Room ' + s.room_code : ''}`;
  return { subject: `New session assigned · ${fmtDate(s.alloc_date)}`, html, text };
}

// Compose a faculty schedule email for a given date from their sessions.
export function scheduleEmail(facultyName, date, sessions, appTitle) {
  const rows = sessions
    .map(
      (s) => `<tr>
        <td style="padding:6px 10px;border:1px solid #e6e6f0"><b>${s.slot_label}</b></td>
        <td style="padding:6px 10px;border:1px solid #e6e6f0">${s.program_code}</td>
        <td style="padding:6px 10px;border:1px solid #e6e6f0">${s.batch_name || '—'}</td>
        <td style="padding:6px 10px;border:1px solid #e6e6f0">${s.activity_name || s.activity_code || '—'}</td>
        <td style="padding:6px 10px;border:1px solid #e6e6f0">${s.room_code || '—'}</td>
      </tr>`
    )
    .join('');
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2233">
      <h2 style="color:#303070;margin:0 0 4px">${appTitle || 'Tijus Academy'}</h2>
      <p>Hi ${facultyName}, here is your schedule for <b>${fmtDate(date)}</b>:</p>
      <table style="border-collapse:collapse;font-size:14px">
        <thead><tr style="background:#ececf7">
          <th style="padding:6px 10px;border:1px solid #e6e6f0;text-align:left">Time</th>
          <th style="padding:6px 10px;border:1px solid #e6e6f0;text-align:left">Program</th>
          <th style="padding:6px 10px;border:1px solid #e6e6f0;text-align:left">Batch</th>
          <th style="padding:6px 10px;border:1px solid #e6e6f0;text-align:left">Activity</th>
          <th style="padding:6px 10px;border:1px solid #e6e6f0;text-align:left">Room</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#6b7090;font-size:12px;margin-top:16px">Sent automatically by ${appTitle || 'Tijus Academy'} after allocation.</p>
    </div>`;
  return { subject: `Your schedule · ${fmtDate(date)}`, html };
}
