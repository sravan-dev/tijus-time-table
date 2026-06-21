import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../auth';
import AllocationModal from '../components/AllocationModal';

export default function Timetable() {
  const { canEdit } = useAuth();
  // Keep the active program tab in the URL (?program=) so a refresh preserves it.
  const [searchParams, setSearchParams] = useSearchParams();
  const [programs, setPrograms] = useState([]);
  const [programId, setProgramId] = useState(null);
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState('');
  const [data, setData] = useState({ allocations: [], conflicts: {} });
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // {batchId, slotId} or allocation

  // initial reference load
  useEffect(() => {
    (async () => {
      const [{ data: progs }, { data: ds }] = await Promise.all([
        api.get('/programs'),
        api.get('/allocations/dates'),
      ]);
      setPrograms(progs);
      const wanted = searchParams.get('program');
      const match = progs.find((p) => p.code === wanted);
      setProgramId((match || progs[0])?.id);
      const isoDates = ds.map((d) => d.slice(0, 10));
      setDates(isoDates);
      setDate(isoDates[0] || '');
    })();
  }, []);

  // slots for the chosen program
  useEffect(() => {
    if (!programId) return;
    api.get(`/slots?program_id=${programId}`).then(({ data }) => setSlots(data));
  }, [programId]);

  async function reload() {
    if (!date || !programId) return;
    setLoading(true);
    const { data } = await api.get(`/allocations?date=${date}&program_id=${programId}`);
    setData(data);
    setLoading(false);
  }
  useEffect(() => { reload(); }, [date, programId]);

  // build batch rows × slot columns matrix
  const { batches, matrix } = useMemo(() => {
    const byBatch = new Map();
    for (const a of data.allocations) {
      const key = a.batch_id ?? `nb-${a.id}`;
      if (!byBatch.has(key))
        byBatch.set(key, { id: a.batch_id, name: a.batch_name || '—', count: a.student_count, cells: {} });
      byBatch.get(key).cells[a.time_slot_id] = a;
    }
    return { batches: [...byBatch.values()], matrix: byBatch };
  }, [data]);

  const confCount = Object.keys(data.conflicts).length;

  function selectProgram(p) {
    setProgramId(p.id);
    setSearchParams({ program: p.code }, { replace: true });
  }

  return (
    <div className="page">
      <div className="row controls" style={{ marginBottom: 12 }}>
        <div className="tabs">
          {programs.map((p) => (
            <div key={p.id}
              className={'tab' + (p.id === programId ? ' active' : '')}
              onClick={() => selectProgram(p)}>
              {p.code}
            </div>
          ))}
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <label>Date&nbsp;
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.map((d) => <option key={d} value={d}>{fmt(d)}</option>)}
          </select>
        </label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn ghost" onClick={() => window.print()}>Print</button>
        {canEdit && <EmailSchedules date={date} />}
        {canEdit && (
          <button className="btn" onClick={() => setEditing({ programId, date })}>+ Add session</button>
        )}
      </div>

      {confCount > 0 && (
        <div className="card no-print" style={{ marginBottom: 12, borderColor: 'var(--error)' }}>
          <b>{confCount} session(s) with conflicts</b>
          <ConflictSummary conflicts={data.conflicts} />
        </div>
      )}

      <div className="grid-wrap">
        <table className="tt">
          <thead>
            <tr>
              <th className="batch">Batch</th>
              {slots.map((s) => <th key={s.id}>{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id ?? b.name}>
                <td className="batch">
                  {b.name}{b.count ? <span className="room"> ({b.count})</span> : null}
                </td>
                {slots.map((s) => {
                  const a = b.cells[s.id];
                  const conf = a ? data.conflicts[a.id] : null;
                  const level = conf?.some((c) => c.level === 'error') ? 'error'
                    : conf?.length ? 'warn' : null;
                  return (
                    <td key={s.id}>
                      <div
                        className={'cell' + (level ? ' conf-' + level : '')}
                        title={conf ? conf.map((c) => c.message).join('\n') : ''}
                        onClick={() => canEdit && setEditing(
                          a || { programId, date, batch_id: b.id, time_slot_id: s.id }
                        )}>
                        {a ? (
                          <>
                            <div className="act">
                              {a.activity_code || ''}{' '}
                              {level && <span className={'badge ' + level}>!</span>}
                            </div>
                            {a.faculty_name && <div className="fac">{a.faculty_name}</div>}
                            {a.room_code && <div className="room">{a.room_code}</div>}
                            {!a.activity_code && !a.faculty_name && (
                              <div className="room">{a.raw_text}</div>
                            )}
                          </>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {!batches.length && !loading && (
              <tr><td className="batch">—</td><td colSpan={slots.length}>No sessions for this day.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <AllocationModal
          initial={editing}
          programId={programId}
          date={date}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function EmailSchedules({ date }) {
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!confirm(`Email each faculty (with an address) their schedule for ${date}?`)) return;
    setBusy(true);
    try {
      const { data } = await api.post('/allocations/notify', { date });
      let msg = `Sent ${data.sent} of ${data.total} faculty emails.`;
      if (data.failures?.length) msg += `\nFailures: ${data.failures.map((f) => f.faculty).join(', ')}`;
      alert(msg);
    } catch (e) {
      alert(e.response?.data?.error || 'Could not send emails');
    } finally { setBusy(false); }
  }
  return (
    <button className="btn ghost" onClick={send} disabled={busy} title="Email faculty their schedule for this date">
      {busy ? 'Sending…' : '✉ Email schedules'}
    </button>
  );
}

function ConflictSummary({ conflicts }) {
  const items = Object.values(conflicts).flat();
  const seen = new Set();
  const unique = items.filter((c) => {
    if (seen.has(c.message)) return false;
    seen.add(c.message);
    return true;
  });
  return (
    <ul className="conf-list">
      {unique.map((c, i) => (
        <li key={i}><span className={'dot ' + c.level} />{c.message}</li>
      ))}
    </ul>
  );
}

function fmt(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
