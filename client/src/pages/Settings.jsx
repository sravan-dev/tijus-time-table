import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../auth';
import { useBranding } from '../branding';

// A few common zones; admin can also type any IANA name.
const TIMEZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London',
  'America/New_York', 'America/Los_Angeles', 'UTC',
];

export default function Settings() {
  const { isAdmin } = useAuth();
  const { reloadBranding } = useBranding();
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dbBusy, setDbBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (isAdmin) api.get('/settings').then((r) => setS(r.data));
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/timetable" replace />;
  if (!s) return <div className="page"><div className="card">Loading…</div></div>;

  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const toggle = (k) => (e) => setS({ ...s, [k]: e.target.checked ? '1' : '0' });

  function pickLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setErr('Logo must be under 2 MB');
    const reader = new FileReader();
    reader.onload = () => setS((prev) => ({ ...prev, app_logo: reader.result }));
    reader.readAsDataURL(file); // store as data URL
  }

  async function save() {
    setBusy(true); setErr(''); setSaved('');
    try {
      const payload = { ...s };
      delete payload.smtp_has_password;
      delete payload.resend_has_key;
      if (!payload.smtp_password) delete payload.smtp_password;     // keep existing
      if (!payload.resend_api_key) delete payload.resend_api_key;   // keep existing
      await api.put('/settings', payload);
      await reloadBranding();
      setSaved('Settings saved.');
    } catch (e) {
      setErr(e.response?.data?.error || 'Save failed');
    } finally { setBusy(false); }
  }

  async function testEmail() {
    const to = prompt('Send a test email to:');
    if (!to) return;
    setErr(''); setSaved('');
    try {
      await api.post('/settings/test-email', { to });
      setSaved('Test email sent.');
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not send test email');
    }
  }

  async function exportDb() {
    setErr(''); setSaved(''); setDbBusy(true);
    try {
      const res = await api.get('/settings/db/export', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tijus-timetable-${new Date().toISOString().slice(0, 10)}.sql`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSaved('Database exported.');
    } catch (e) {
      setErr('Export failed');
    } finally { setDbBusy(false); }
  }

  async function clearDb() {
    const typed = prompt(
      'This permanently deletes ALL timetable and reference data — sessions, batches, ' +
      'faculty, rooms, leave and room blocks. User accounts and settings are kept. ' +
      'This CANNOT be undone (export a backup first).\n\nType CLEAR to confirm:');
    if (typed !== 'CLEAR') return;
    setErr(''); setSaved(''); setDbBusy(true);
    try {
      await api.post('/settings/db/clear', { confirm: 'CLEAR' });
      setSaved('All timetable and reference data cleared. Users and settings were kept.');
    } catch (e) {
      setErr(e.response?.data?.error || 'Clear failed');
    } finally { setDbBusy(false); }
  }

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h3 style={{ marginTop: 0 }}>Settings</h3>
      {saved && <div className="card" style={{ borderColor: 'var(--accent-green)', marginBottom: 12 }}>{saved}</div>}
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      {/* Branding */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Branding</div>
        <div className="field">
          <label>App title</label>
          <input type="text" value={s.app_title || ''} onChange={set('app_title')} />
        </div>
        <div className="field">
          <label>Logo</label>
          <div className="row">
            <div style={{ background: 'var(--brand)', padding: 8, borderRadius: 8 }}>
              <img src={s.app_logo || '/logo.png'} alt="logo" style={{ height: 44, display: 'block' }} />
            </div>
            <button className="btn ghost" onClick={() => fileRef.current?.click()}>Choose image…</button>
            {s.app_logo && <button className="btn ghost" onClick={() => setS({ ...s, app_logo: '' })}>Reset to default</button>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickLogo} />
          </div>
        </div>
      </div>

      {/* Locale */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Locale</div>
        <div className="field">
          <label>Time zone</label>
          <input list="tzlist" value={s.timezone || ''} onChange={set('timezone')} />
          <datalist id="tzlist">
            {TIMEZONES.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
      </div>

      {/* Email / SMTP */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontWeight: 700 }}>Email (SMTP)</span>
          <label className="row" style={{ gap: 6, fontSize: 14 }}>
            <input type="checkbox" checked={s.smtp_enabled === '1'} onChange={toggle('smtp_enabled')} />
            Enable sending
          </label>
        </div>
        <div className="sub" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>
          Used to email faculty their schedule after allocations.
        </div>

        <div className="field">
          <label>Email provider</label>
          <select value={s.mail_provider || 'smtp'} onChange={set('mail_provider')}>
            <option value="smtp">SMTP server</option>
            <option value="resend">Resend API</option>
          </select>
        </div>

        <div className="field">
          <label>From address</label>
          <input type="text" value={s.smtp_from || ''} onChange={set('smtp_from')} placeholder="Tijus Academy <noreply@tijus.com>" />
        </div>

        {(s.mail_provider || 'smtp') === 'resend' ? (
          <>
            <div className="field">
              <label>Resend API key {s.resend_has_key === '1' && <span className="room">(set — leave blank to keep)</span>}</label>
              <input type="password" value={s.resend_api_key || ''} onChange={set('resend_api_key')}
                placeholder={s.resend_has_key === '1' ? '••••••••' : 're_...'} />
            </div>
            <div className="sub" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>
              The From address must use a domain verified in your Resend account.
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <div className="field" style={{ flex: 2 }}>
                <label>SMTP host</label>
                <input type="text" value={s.smtp_host || ''} onChange={set('smtp_host')} placeholder="smtp.gmail.com" />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Port</label>
                <input type="text" value={s.smtp_port || ''} onChange={set('smtp_port')} placeholder="587" />
              </div>
              <div className="field" style={{ width: 120 }}>
                <label>SSL (465)</label>
                <select value={s.smtp_secure || '0'} onChange={set('smtp_secure')}>
                  <option value="0">No (TLS)</option>
                  <option value="1">Yes</option>
                </select>
              </div>
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Username</label>
                <input type="text" value={s.smtp_user || ''} onChange={set('smtp_user')} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Password {s.smtp_has_password === '1' && <span className="room">(set — leave blank to keep)</span>}</label>
                <input type="password" value={s.smtp_password || ''} onChange={set('smtp_password')}
                  placeholder={s.smtp_has_password === '1' ? '••••••••' : ''} />
              </div>
            </div>
          </>
        )}
        <button className="btn ghost" onClick={testEmail}>Send test email…</button>
      </div>

      {/* Database management */}
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Database Management</div>

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 600 }}>Export database</div>
            <div className="sub" style={{ color: 'var(--muted)', fontSize: 13 }}>
              Download a full MySQL <code>.sql</code> backup you can re-import.
            </div>
          </div>
          <button className="btn ghost" onClick={exportDb} disabled={dbBusy}>
            {dbBusy ? 'Working…' : 'Export .sql'}
          </button>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '14px 0' }} />

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 600, color: 'var(--error)' }}>Clear all data</div>
            <div className="sub" style={{ color: 'var(--muted)', fontSize: 13 }}>
              Permanently deletes all timetable and reference data (sessions, batches,
              faculty, rooms, leave, blocks). User accounts and settings are kept.
              This cannot be undone — export a backup first.
            </div>
          </div>
          <button className="btn danger" onClick={clearDb} disabled={dbBusy}>
            {dbBusy ? 'Working…' : 'Clear all data'}
          </button>
        </div>
      </div>

      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </div>
    </div>
  );
}
