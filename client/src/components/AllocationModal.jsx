import { useEffect, useState } from 'react';
import api from '../api/client';

// Create or edit a single allocation. `initial` may be an existing allocation
// row (has `id`) or a blank slot stub { batch_id, time_slot_id }.
export default function AllocationModal({ initial, programId, date, onClose, onSaved }) {
  const isEdit = Boolean(initial?.id);
  const [refs, setRefs] = useState({ batches: [], activities: [], slots: [], rooms: [], faculty: [] });
  const [form, setForm] = useState({
    batch_id: initial.batch_id ?? '',
    activity_id: initial.activity_id ?? '',
    time_slot_id: initial.time_slot_id ?? '',
    classroom_id: initial.classroom_id ?? '',
    faculty_id: initial.faculty_id ?? '',
    note: initial.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const [batches, activities, slots, rooms, faculty] = await Promise.all([
        api.get(`/batches?program_id=${programId}`),
        api.get('/activities'),
        api.get(`/slots?program_id=${programId}`),
        api.get('/classrooms'),
        api.get('/faculty'),
      ]);
      setRefs({
        batches: batches.data, activities: activities.data,
        slots: slots.data, rooms: rooms.data, faculty: faculty.data,
      });
    })();
  }, [programId]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true); setErr('');
    const payload = {
      alloc_date: date, program_id: programId,
      batch_id: form.batch_id || null,
      activity_id: form.activity_id || null,
      time_slot_id: form.time_slot_id || null,
      classroom_id: form.classroom_id || null,
      faculty_id: form.faculty_id || null,
      note: form.note || null,
    };
    try {
      if (isEdit) await api.put(`/allocations/${initial.id}`, payload);
      else await api.post('/allocations', payload);
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || 'Save failed');
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this session?')) return;
    setBusy(true);
    await api.delete(`/allocations/${initial.id}`);
    onSaved();
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? 'Edit session' : 'Add session'}</h3>
        {initial.raw_text && (
          <div className="sub" style={{ marginBottom: 10 }}>Original: “{initial.raw_text}”</div>
        )}
        <div className="field">
          <label>Batch</label>
          <select value={form.batch_id} onChange={set('batch_id')}>
            <option value="">—</option>
            {refs.batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Time slot</label>
          <select value={form.time_slot_id} onChange={set('time_slot_id')}>
            <option value="">—</option>
            {refs.slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Activity</label>
            <select value={form.activity_id} onChange={set('activity_id')}>
              <option value="">—</option>
              {refs.activities.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Room</label>
            <select value={form.classroom_id} onChange={set('classroom_id')}>
              <option value="">—</option>
              {refs.rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.code}{r.capacity ? ` (cap ${r.capacity})` : ''}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Faculty</label>
          <select value={form.faculty_id} onChange={set('faculty_id')}>
            <option value="">—</option>
            {refs.faculty.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Note</label>
          <input type="text" value={form.note} onChange={set('note')} />
        </div>
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          {isEdit && <button className="btn danger" onClick={remove} disabled={busy}>Delete</button>}
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
