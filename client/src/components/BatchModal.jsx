import { useEffect, useState } from 'react';
import api from '../api/client';

// Edit a batch's details straight from the timetable (right-click the batch
// column). PUT /batches/:id replaces every column, so the full row is loaded
// first and unedited fields (program, exam month, active) are sent back as-is.
export default function BatchModal({ batchId, programId, onClose, onSaved }) {
  const [row, setRow] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [form, setForm] = useState({ name: '', student_count: 0, home_room_id: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const [{ data: batches }, { data: rs }] = await Promise.all([
        api.get(`/batches?program_id=${programId}`),
        api.get('/classrooms'),
      ]);
      setRooms(rs);
      const b = batches.find((x) => x.id === batchId);
      if (!b) { setErr('Batch not found'); return; }
      setRow(b);
      setForm({
        name: b.name,
        student_count: b.student_count ?? 0,
        home_room_id: b.home_room_id ?? '',
      });
    })();
  }, [batchId, programId]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    if (!form.name.trim()) { setErr('Name is required'); return; }
    setBusy(true); setErr('');
    try {
      await api.put(`/batches/${batchId}`, {
        ...row,
        name: form.name.trim(),
        student_count: Number(form.student_count) || 0,
        home_room_id: form.home_room_id || null,
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
        <h3>Edit batch</h3>
        <div className="field">
          <label>Name</label>
          <input type="text" value={form.name} onChange={set('name')} disabled={!row} />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Students</label>
            <input type="number" min="0" value={form.student_count}
              onChange={set('student_count')} disabled={!row} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Home room</label>
            <select value={form.home_room_id} onChange={set('home_room_id')} disabled={!row}>
              <option value="">—</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.code}{r.capacity ? ` (cap ${r.capacity})` : ''}</option>
              ))}
            </select>
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy || !row}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
