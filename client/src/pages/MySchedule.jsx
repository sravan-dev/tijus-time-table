import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../auth';

export default function MySchedule() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/my/schedule')
      .then((r) => setRows(r.data))
      .finally(() => setLoading(false));
  }, []);

  // group sessions by date
  const days = useMemo(() => {
    const byDate = new Map();
    for (const s of rows) {
      if (!byDate.has(s.alloc_date)) byDate.set(s.alloc_date, []);
      byDate.get(s.alloc_date).push(s);
    }
    return [...byDate.entries()];
  }, [rows]);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>My Schedule</h3>
        <span className="who" style={{ color: 'var(--muted)' }}>
          {user?.name || user?.username} · {rows.length} session{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading && <div className="card">Loading…</div>}
      {!loading && !days.length && (
        <div className="card">You have no scheduled sessions.</div>
      )}

      {days.map(([date, sessions]) => (
        <div className="card" key={date} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--brand-dark)' }}>
            {fmtDate(date)}
          </div>
          <table className="data">
            <thead>
              <tr><th>Time</th><th>Program</th><th>Batch</th><th>Activity</th><th>Room</th></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td style={{ whiteSpace: 'nowrap' }}><b>{s.slot_label}</b></td>
                  <td><span className="badge" style={{ background: 'var(--brand)' }}>{s.program_code}</span></td>
                  <td>{s.batch_name || '—'}</td>
                  <td>{s.activity_name || s.activity_code || s.raw_text || '—'}</td>
                  <td>{s.room_code || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
