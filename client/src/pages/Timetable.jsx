import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../auth';
import AllocationModal from '../components/AllocationModal';
import SlotModal from '../components/SlotModal';
import ReassignModal from '../components/ReassignModal';

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
  const [editingSlot, setEditingSlot] = useState(null); // time slot being re-timed
  const [menu, setMenu] = useState(null); // right-click menu { x, y, allocation }
  const [reassigning, setReassigning] = useState(null); // allocation being reassigned
  const [facultyId, setFacultyId] = useState(''); // optional faculty filter

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
  function reloadSlots() {
    if (!programId) return;
    api.get(`/slots?program_id=${programId}`).then(({ data }) => setSlots(data));
  }
  useEffect(() => { reloadSlots(); }, [programId]);

  // Guard against out-of-order responses: only the most recent request may
  // apply its result, so switching program tabs quickly (or leaving and
  // returning) can't leave a previous program's sessions on screen.
  const reqRef = useRef(0);
  async function reload() {
    if (!date || !programId) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    const { data } = await api.get(`/allocations?date=${date}&program_id=${programId}`);
    if (reqId !== reqRef.current) return; // a newer request superseded this one
    setData(data);
    setLoading(false);
  }
  // Clear the grid immediately on program/date change so stale rows never linger.
  useEffect(() => { setData({ allocations: [], conflicts: {} }); reload(); }, [date, programId]);

  // build batch rows × slot columns matrix. Only rows for the selected program
  // and the current slot grid are kept, so another program's sessions (e.g.
  // German's batch-less, per-tutor rows) can never render as blank "—" rows.
  const slotIds = useMemo(() => new Set(slots.map((s) => s.id)), [slots]);
  const { batches } = useMemo(() => {
    const byBatch = new Map();
    for (const a of data.allocations) {
      if (programId && a.program_id !== programId) continue;      // other program leaked in
      if (slotIds.size && !slotIds.has(a.time_slot_id)) continue; // slot not in this grid
      const key = a.batch_id ?? `nb-${a.id}`;
      if (!byBatch.has(key))
        byBatch.set(key, { id: a.batch_id, name: a.batch_name || '—', count: a.student_count, cells: {} });
      byBatch.get(key).cells[a.time_slot_id] = a;
    }
    return { batches: [...byBatch.values()] };
  }, [data, programId, slotIds]);

  // faculty present in the current day/program, for the filter dropdown
  const facultyOptions = useMemo(() => {
    const m = new Map();
    for (const a of data.allocations) if (a.faculty_id) m.set(a.faculty_id, a.faculty_name);
    return [...m.entries()]
      .map(([id, name]) => ({ id, name: name || `#${id}` }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }, [data]);

  // drop a stale selection when the chosen faculty isn't in the new view
  useEffect(() => {
    if (facultyId && !facultyOptions.some((f) => f.id === Number(facultyId))) setFacultyId('');
  }, [facultyOptions, facultyId]);

  // when a faculty is selected, keep only their allocated cells (and the rows
  // that still have any), so the grid shows that faculty's slots at a glance
  const visibleBatches = useMemo(() => {
    if (!facultyId) return batches;
    const fid = Number(facultyId);
    return batches
      .map((b) => {
        const cells = {};
        for (const [sid, a] of Object.entries(b.cells)) if (a.faculty_id === fid) cells[sid] = a;
        return { ...b, cells };
      })
      .filter((b) => Object.keys(b.cells).length);
  }, [batches, facultyId]);

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
        <label>Faculty&nbsp;
          <select value={facultyId} onChange={(e) => setFacultyId(e.target.value)}>
            <option value="">All faculty</option>
            {facultyOptions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
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
              {slots.map((s) => (
                <th key={s.id}
                  className={canEdit ? 'slot-edit' : undefined}
                  title={canEdit ? 'Click to edit this timing' : undefined}
                  onClick={() => canEdit && setEditingSlot(s)}>
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleBatches.map((b) => (
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
                        )}
                        onContextMenu={(e) => {
                          if (!canEdit || !a) return; // only admins, only real sessions
                          e.preventDefault();
                          setMenu({ x: e.clientX, y: e.clientY, allocation: a });
                        }}>
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
            {!visibleBatches.length && !loading && (
              <tr><td className="batch">—</td><td colSpan={slots.length}>
                {facultyId ? 'No sessions for this faculty on this day.' : 'No sessions for this day.'}
              </td></tr>
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

      {editingSlot && (
        <SlotModal
          slot={editingSlot}
          onClose={() => setEditingSlot(null)}
          onSaved={() => { setEditingSlot(null); reloadSlots(); reload(); }}
        />
      )}

      {menu && (
        <div className="ctx-backdrop"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="ctx-menu" style={{ top: menu.y, left: menu.x }} onClick={(e) => e.stopPropagation()}>
            <button className="ctx-item"
              onClick={() => { setReassigning(menu.allocation); setMenu(null); }}>
              Reassign faculty…
            </button>
          </div>
        </div>
      )}

      {reassigning && (
        <ReassignModal
          allocation={reassigning}
          programId={programId}
          dayAllocations={data.allocations}
          onClose={() => setReassigning(null)}
          onSaved={() => { setReassigning(null); reload(); }}
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
