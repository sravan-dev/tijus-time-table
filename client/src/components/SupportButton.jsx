import { useState } from 'react';
import api from '../api/client';
import { useAuth } from '../auth';
import { useToast } from './Toast';

// Floating help button (bottom-right) that opens a quick "Support assistant"
// form to email an urgent bug report / request to the team.
export default function SupportButton() {
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const email = user?.username || '';

  function close() {
    setOpen(false);
    setErr('');
  }

  async function send() {
    setErr('');
    if (!subject.trim()) return setErr('Add a subject');
    if (!message.trim()) return setErr('Describe the issue');
    setBusy(true);
    try {
      await api.post('/support', { subject, message });
      toast('Support request sent');
      setSubject(''); setMessage('');
      close();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not send — please try again');
    } finally { setBusy(false); }
  }

  return (
    <>
      <button className="help-fab no-print" onClick={() => setOpen(true)}
        title="Help & support" aria-label="Help & support">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>

      {open && (
        <div className="modal-bg" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Support assistant</h3>
            <p className="sub" style={{ color: 'var(--muted)', fontSize: 13, marginTop: -4, marginBottom: 14 }}>
              Report an urgent bug or send a request. It goes straight to the team.
            </p>
            <div className="field">
              <label>Your email</label>
              <input type="email" value={email} disabled title="Sent from your account" />
            </div>
            <div className="field">
              <label>Subject</label>
              <input type="text" value={subject} maxLength={160} placeholder="Brief summary"
                onChange={(e) => setSubject(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Message</label>
              <textarea rows={5} value={message}
                placeholder="What went wrong? Steps to reproduce, what you expected…"
                onChange={(e) => setMessage(e.target.value)} />
            </div>
            {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
              <button className="btn" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
