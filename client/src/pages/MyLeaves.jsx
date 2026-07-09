import { useEffect, useState } from 'react';
import api from '../api/client';
import StatusBadge from '../components/StatusBadge';

export default function MyLeaves() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ leave_date: '', reason: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/my/leave').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  async function add() {
    setErr('');
    if (!form.leave_date) return setErr('Pick a date');
    setBusy(true);
    try {
      await api.post('/my/leave', form);
      setForm({ leave_date: '', reason: '' });
      await load();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not send your leave request');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!confirm('Remove this leave?')) return;
    await api.delete(`/my/leave/${id}`);
    load();
  }

  return (
    <div className="page">
      <h3 style={{ marginTop: 0 }}>My Leaves</h3>

      <div className="card" style={{ marginBottom: 14, maxWidth: 620 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Apply for leave</div>
        {/* the request lands pending; an admin approves it in Approvals */}
        <div className="row">
          <input type="date" value={form.leave_date}
            onChange={(e) => setForm({ ...form, leave_date: e.target.value })} />
          <input type="text" placeholder="reason (optional)" value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })} style={{ flex: 1 }} />
          <button className="btn" onClick={add} disabled={busy}>{busy ? 'Sending…' : 'Request leave'}</button>
        </div>
        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="sub" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
          Your request goes to an admin for approval. Once approved, the allocation
          team is alerted to clashes on days you’re on leave.
        </div>
      </div>

      <div className="card" style={{ maxWidth: 620 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Upcoming &amp; past leave</div>
        <table className="data">
          <thead><tr><th>Date</th><th>Reason</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td><b>{l.leave_date.slice(0, 10)}</b></td>
                <td>
                  {l.reason || '—'}
                  {l.status === 'rejected' && l.decision_note && (
                    <div style={{ color: 'var(--error)', fontSize: 12 }}>{l.decision_note}</div>
                  )}
                </td>
                <td><StatusBadge status={l.status} /></td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn sm danger" onClick={() => remove(l.id)}>
                    {l.status === 'pending' ? 'Withdraw' : 'Remove'}
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4}>No leave recorded.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
