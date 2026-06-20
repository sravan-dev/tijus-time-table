import nodemailer from 'nodemailer';
import { getSettings } from './settings.js';

// Build a nodemailer transport from the stored SMTP settings.
async function buildTransport() {
  const s = await getSettings();
  if (s.smtp_enabled !== '1') throw new Error('Email is disabled in Settings');
  if (!s.smtp_host) throw new Error('SMTP host is not configured');
  const transport = nodemailer.createTransport({
    host: s.smtp_host,
    port: Number(s.smtp_port) || 587,
    secure: s.smtp_secure === '1',
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_password } : undefined,
  });
  const from = s.smtp_from || s.smtp_user;
  return { transport, from, settings: s };
}

export async function sendMail({ to, subject, html, text }) {
  const { transport, from } = await buildTransport();
  return transport.sendMail({ from, to, subject, html, text });
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${+d} ${MON[+m - 1]} ${y}`;
};

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
