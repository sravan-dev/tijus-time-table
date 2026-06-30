import { useState } from 'react';
import api from '../api/client';

// Edit a single time slot's label and start/end times (admin only). The slot
// is shared by every batch in the program's grid, so a change re-times the
// whole column. Existing sessions keep their slot link.
export default function SlotModal({ slot, onClose, onSaved }) {
  const [form, setForm] = useState({
    label: slot.label ?? '',
    start_time: (slot.start_time || '').slice(0, 5),
    end_time: (slot.end_time || '').slice(0, 5),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    if (!form.label.trim()) { setErr('A label is required'); return; }
    setBusy(true); setErr('');
    try {
      await api.put(`/slots/${slot.id}`, {
        label: form.label.trim(),
        start_time: form.start_time || null,
        end_time: form.end_time || null,
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
        <h3>Edit timing</h3>
        <div className="sub" style={{ marginBottom: 10 }}>
          Re-times this column for every batch in this program.
        </div>
        <div className="field">
          <label>Label</label>
          <input type="text" value={form.label} onChange={set('label')} placeholder="e.g. 9.00-10.00" />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Start</label>
            <input type="time" value={form.start_time} onChange={set('start_time')} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>End</label>
            <input type="time" value={form.end_time} onChange={set('end_time')} />
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
