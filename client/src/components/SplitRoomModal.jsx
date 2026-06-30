import { useState } from 'react';
import api from '../api/client';

// Split a room into section sub-rooms. The admin chooses how many sections,
// their codes, and capacities. Each section becomes a normal room usable in
// the allocation editor. Defaults to Front/Back with the capacity halved.
export default function SplitRoomModal({ room, existingCodes = [], onClose, onSaved }) {
  const cap = room.capacity || 0;
  const half = Math.ceil(cap / 2);
  const [sections, setSections] = useState([
    { code: `${room.code}-Front`, capacity: half },
    { code: `${room.code}-Back`, capacity: cap - half },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const update = (i, key, val) => setSections((s) => s.map((x, j) => (j === i ? { ...x, [key]: val } : x)));
  const addSection = () => setSections((s) => [...s, { code: `${room.code}-${s.length + 1}`, capacity: 0 }]);
  const removeSection = (i) => setSections((s) => s.filter((_, j) => j !== i));

  async function create() {
    const codes = sections.map((s) => s.code.trim());
    if (codes.some((c) => !c)) { setErr('Every section needs a code.'); return; }
    if (codes.some((c, i) => codes.indexOf(c) !== i)) { setErr('Section codes must be unique.'); return; }
    const existing = new Set(existingCodes);
    const clash = codes.find((c) => existing.has(c));
    if (clash) { setErr(`A room "${clash}" already exists.`); return; }
    setBusy(true); setErr('');
    try {
      for (const s of sections)
        await api.post('/classrooms', {
          code: s.code.trim(), capacity: Number(s.capacity) || 0, notes: `Section of ${room.code}`,
        });
      onSaved(sections.length);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not create the sections.');
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Split {room.code}</h3>
        <div className="sub" style={{ marginBottom: 12 }}>
          Create section rooms from <b>{room.code}</b> (capacity {cap}). Each becomes a normal room you can allocate separately.
        </div>

        {sections.map((s, i) => (
          <div className="row" key={i} style={{ gap: 8, marginBottom: 8, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 2, marginBottom: 0 }}>
              {i === 0 && <label>Section code</label>}
              <input type="text" value={s.code} onChange={(e) => update(i, 'code', e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              {i === 0 && <label>Capacity</label>}
              <input type="number" value={s.capacity} onChange={(e) => update(i, 'capacity', e.target.value)} />
            </div>
            <button className="btn sm ghost" onClick={() => removeSection(i)}
              disabled={sections.length <= 2} style={{ marginBottom: 2 }}
              title={sections.length <= 2 ? 'At least two sections' : 'Remove section'}>✕</button>
          </div>
        ))}

        <button className="btn sm ghost" onClick={addSection} style={{ marginTop: 2 }}>+ Add section</button>

        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={create} disabled={busy}>{busy ? 'Splitting…' : 'Split'}</button>
        </div>
      </div>
    </div>
  );
}
