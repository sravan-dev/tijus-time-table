import { useState } from 'react';
import api from '../api/client';
import ColourPicker from './ColourPicker';

// Split one cell of the grid into another area: a session of its own in the
// same batch and time slot, carrying only a colour (and an optional label).
// The activity itself is added afterwards by clicking the new area, which is
// how staff work — the areas are marked out first, then filled in.
export default function SplitCellModal({ cell, programId, date, onClose, onSaved }) {
  const [text, setText] = useState('#166534');
  const [bg, setBg] = useState('#dcfce7');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function split() {
    setBusy(true); setErr('');
    try {
      await api.post('/allocations', {
        alloc_date: date,
        program_id: programId,
        batch_id: cell.batch_id || null,
        time_slot_id: cell.time_slot_id,
        text_color: text,
        bg_color: bg,
        note: label.trim() || null,
      });
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not split the cell');
      setBusy(false);
    }
  }

  const where = [cell?.batch_name, cell?.slot_label].filter(Boolean).join(' · ');

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Split cell</h3>
        {where && (
          <div className="sub" style={{ marginBottom: 10 }}>
            Adds an area under <b>{where}</b>. Click the new area afterwards to
            put an activity in it.
          </div>
        )}

        <div className="field">
          <label>Area colours</label>
          <ColourPicker text={text} bg={bg}
            onChange={({ text: t, bg: b }) => { setText(t); setBg(b); }} />
        </div>

        <div className="field">
          <label>Label <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <input type="text" value={label} maxLength={60}
            placeholder="Leave empty to fill the area in later"
            onChange={(e) => setLabel(e.target.value)} />
        </div>

        <div className="field">
          <label>Preview</label>
          <div className="act-preview" style={{ color: text, background: bg }}>
            {label.trim() || 'empty area'}
          </div>
        </div>

        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={split} disabled={busy}>
            {busy ? 'Splitting…' : 'Split cell'}
          </button>
        </div>
      </div>
    </div>
  );
}
