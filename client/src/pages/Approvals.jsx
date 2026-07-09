import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../auth';
import StatusBadge from '../components/StatusBadge';

// Admin-only queue for tutor-submitted leave and tutor-proposed sessions.
// Nothing here affects the timetable or its conflict checks until approved.
export default function Approvals() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('leave');
  const [status, setStatus] = useState('pending');
  const [leave, setLeave] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [busy, setBusy] = useState(null);   // `${kind}-${id}` being decided
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const [l, s] = await Promise.all([
      api.get('/approvals/leave', { params: { status } }),
      api.get('/approvals/sessions', { params: { status } }),
    ]);
    setLeave(l.data);
    setSessions(s.data);
  }, [isAdmin, status]);

  useEffect(() => { load().catch(() => setErr('Could not load approvals')); }, [load]);

  if (!isAdmin) return <Navigate to="/timetable" replace />;

  async function decide(kind, id, decision) {
    const note = decision === 'reject'
      ? (prompt('Reason for rejecting (optional, shown to the tutor):') ?? undefined)
      : undefined;
    if (note === undefined && decision === 'reject') return;  // cancelled the prompt
    setErr('');
    setBusy(`${kind}-${id}`);
    try {
      await api.post(`/approvals/${kind}/${id}/${decision}`, { note });
      await load();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not save that decision');
    } finally {
      setBusy(null);
    }
  }

  const rows = tab === 'leave' ? leave : sessions;
  const pendingOnly = status === 'pending';

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Approvals</h3>
        <label className="row" style={{ gap: 6 }}>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>Show</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 12 }}>
        <button className={'btn sm' + (tab === 'leave' ? '' : ' ghost')}
          onClick={() => setTab('leave')}>
          Leave requests{leave.length ? ` (${leave.length})` : ''}
        </button>
        <button className={'btn sm' + (tab === 'sessions' ? '' : ' ghost')}
          onClick={() => setTab('sessions')}>
          Session requests{sessions.length ? ` (${sessions.length})` : ''}
        </button>
      </div>

      {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}

      <div className="card">
        {tab === 'leave' ? (
          <table className="data">
            <thead>
              <tr><th>Tutor</th><th>Date</th><th>Reason</th>
                {pendingOnly ? <th /> : <><th>Status</th><th>Note</th></>}</tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td><b>{l.faculty_name}</b></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{l.leave_date.slice(0, 10)}</td>
                  <td>{l.reason || '—'}</td>
                  {pendingOnly ? (
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Decide kind="leave" id={l.id} busy={busy} onDecide={decide} />
                    </td>
                  ) : (
                    <>
                      <td><StatusBadge status={l.status} /></td>
                      <td>{l.decision_note || '—'}</td>
                    </>
                  )}
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={pendingOnly ? 4 : 5}>No {status} leave requests.</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="data">
            <thead>
              <tr><th>Tutor</th><th>Date</th><th>Time</th><th>Program</th>
                <th>Batch</th><th>Activity</th><th>Room</th>
                {pendingOnly ? <th /> : <><th>Status</th><th>Note</th></>}</tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.faculty_name || '—'}</b></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{s.alloc_date.slice(0, 10)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{s.slot_label}</td>
                  <td><span className="badge" style={{ background: 'var(--brand)' }}>{s.program_code}</span></td>
                  <td>{s.batch_name || '—'}</td>
                  <td>{s.activity_name || s.activity_code || '—'}</td>
                  <td>{s.room_code || '—'}</td>
                  {pendingOnly ? (
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Decide kind="sessions" id={s.id} busy={busy} onDecide={decide} />
                    </td>
                  ) : (
                    <>
                      <td><StatusBadge status={s.status} /></td>
                      <td>{s.decision_note || '—'}</td>
                    </>
                  )}
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={pendingOnly ? 8 : 9}>No {status} session requests.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Decide({ kind, id, busy, onDecide }) {
  const working = busy === `${kind}-${id}`;
  return (
    <>
      <button className="btn sm" disabled={!!busy}
        onClick={() => onDecide(kind, id, 'approve')}>
        {working ? '…' : '✓ Approve'}
      </button>{' '}
      <button className="btn sm danger" disabled={!!busy}
        onClick={() => onDecide(kind, id, 'reject')}>✕ Reject</button>
    </>
  );
}
