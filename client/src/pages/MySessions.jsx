import { useEffect, useState } from 'react';
import api from '../api/client';
import StatusBadge from '../components/StatusBadge';

// A tutor proposes sessions for themselves. Each request lands 'pending' and
// only appears in the live timetable once an admin approves it.
export default function MySessions() {
  const [rows, setRows] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [slots, setSlots] = useState([]);
  const [batches, setBatches] = useState([]);
  const [activities, setActivities] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = () => api.get('/my/sessions').then((r) => setRows(r.data));

  useEffect(() => {
    load().catch(() => setErr('Could not load your requests'));
    Promise.all([
      api.get('/programs'), api.get('/activities'), api.get('/classrooms'),
    ]).then(([p, a, c]) => {
      setPrograms(p.data); setActivities(a.data); setRooms(c.data);
    }).catch(() => {});
  }, []);

  // Slots and batches are per-program, so reload them whenever it changes.
  useEffect(() => {
    if (!form.program_id) { setSlots([]); setBatches([]); return; }
    const params = { program_id: form.program_id };
    Promise.all([
      api.get('/slots', { params }), api.get('/batches', { params }),
    ]).then(([s, b]) => { setSlots(s.data); setBatches(b.data); }).catch(() => {});
  }, [form.program_id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setErr('');
    if (!form.alloc_date || !form.program_id || !form.time_slot_id)
      return setErr('Date, program and time slot are required');
    setBusy(true);
    try {
      await api.post('/my/sessions', {
        ...form,
        batch_id: form.batch_id || null,
        activity_id: form.activity_id || null,
        classroom_id: form.classroom_id || null,
        note: form.note || null,
      });
      setForm(EMPTY);
      await load();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not send your request');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id) {
    if (!confirm('Withdraw this session request?')) return;
    setErr('');
    try { await api.delete(`/my/sessions/${id}`); await load(); }
    catch (e) { setErr(e.response?.data?.error || 'Could not withdraw the request'); }
  }

  return (
    <div className="page">
      <h3 style={{ marginTop: 0 }}>My Sessions</h3>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Request a session</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input type="date" value={form.alloc_date} onChange={set('alloc_date')} />
          <select value={form.program_id} onChange={set('program_id')}>
            <option value="">Program…</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
          <select value={form.time_slot_id} onChange={set('time_slot_id')} disabled={!slots.length}>
            <option value="">Time slot…</option>
            {slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={form.batch_id} onChange={set('batch_id')} disabled={!batches.length}>
            <option value="">Batch (optional)…</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={form.activity_id} onChange={set('activity_id')}>
            <option value="">Activity (optional)…</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.name || a.code}</option>)}
          </select>
          <select value={form.classroom_id} onChange={set('classroom_id')}>
            <option value="">Room (optional)…</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
          </select>
          <input type="text" placeholder="note (optional)" value={form.note}
            onChange={set('note')} style={{ flex: 1, minWidth: 160 }} />
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? 'Sending…' : 'Request session'}
          </button>
        </div>
        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="sub" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
          You’ll be listed as the tutor. An admin approves it before it joins the timetable.
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>My requests</div>
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Time</th><th>Program</th><th>Batch</th>
              <th>Activity</th><th>Room</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td style={{ whiteSpace: 'nowrap' }}><b>{s.alloc_date.slice(0, 10)}</b></td>
                <td style={{ whiteSpace: 'nowrap' }}>{s.slot_label}</td>
                <td><span className="badge" style={{ background: 'var(--brand)' }}>{s.program_code}</span></td>
                <td>{s.batch_name || '—'}</td>
                <td>
                  {s.activity_name || s.activity_code || '—'}
                  {s.status === 'rejected' && s.decision_note && (
                    <div style={{ color: 'var(--error)', fontSize: 12 }}>{s.decision_note}</div>
                  )}
                </td>
                <td>{s.room_code || '—'}</td>
                <td><StatusBadge status={s.status} /></td>
                <td style={{ textAlign: 'right' }}>
                  {s.status === 'pending' && (
                    <button className="btn sm danger" onClick={() => withdraw(s.id)}>Withdraw</button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8}>You haven’t requested any sessions.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const EMPTY = {
  alloc_date: '', program_id: '', time_slot_id: '',
  batch_id: '', activity_id: '', classroom_id: '', note: '',
};
