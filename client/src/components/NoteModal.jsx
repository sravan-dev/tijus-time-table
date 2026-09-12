import { useState } from 'react';
import api from '../api/client';
import ColourPicker from './ColourPicker';

// Add or edit the short free-text note on a session. The note shows in the
// grid on the activity line, right after the code (e.g. "W  bring workbooks").
export default function NoteModal({ allocation, onClose, onSaved }) {
  const [note, setNote] = useState(allocation.note || '');
  const [text, setText] = useState(allocation.note_text_color || '#5b21b6');
  const [bg, setBg] = useState(allocation.note_bg_color || '#ede9fe');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const existing = !!allocation.note;

  async function save(value) {
    setBusy(true); setErr('');
    try {
      const v = value.trim();
      await api.put(`/allocations/${allocation.id}`, {
        note: v || null,
        note_text_color: v ? text : null,
        note_bg_color: v ? bg : null,
      });
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
          <div className="field">
            <label>Colours</label>
            <ColourPicker text={text} bg={bg}
              onChange={(c) => { setText(c.text); setBg(c.bg); }} />
          </div>
          {note.trim() && (
            <div className="field">
              <label>Preview</label>
              <div className="act-preview">
                <span className="act">{allocation.activity_code || 'W'}</span>{' '}
                <span className="note" style={{ color: text, background: bg }}>
                  {note.trim()}
                </span>
              </div>
            </div>
          )}
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
