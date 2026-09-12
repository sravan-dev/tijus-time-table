import { useState } from 'react';
import api from '../api/client';

// Add or edit the short free-text note on a session. The note shows in the
// grid on the activity line, right after the code (e.g. "W  bring workbooks").
export default function NoteModal({ allocation, onClose, onSaved }) {
  const [note, setNote] = useState(allocation.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const existing = !!allocation.note;

  async function save(value) {
    setBusy(true); setErr('');
    try {
      await api.put(`/allocations/${allocation.id}`, { note: value.trim() || null });
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || 'Save failed');
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{existing ? 'Edit note' : 'Add note'}</h3>
        <div className="sub" style={{ marginBottom: 10 }}>
          {(allocation.batch_name || '—')} · {allocation.slot_label} · {allocation.activity_code || 'session'}
          {allocation.faculty_name ? <> — <b>{allocation.faculty_name}</b></> : null}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); if (!busy) save(note); }}>
          <div className="field">
            <label>Note</label>
            <input type="text" value={note} autoFocus maxLength={200}
              placeholder="e.g. bring workbooks"
              onChange={(e) => setNote(e.target.value)} />
          </div>
          {err && <div className="err">{err}</div>}
          <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
            {existing && (
              <button type="button" className="btn ghost" style={{ color: 'var(--error)' }}
                onClick={() => save('')} disabled={busy}>
                Remove note
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
