import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';

const MODULE_BY_LETTER = { R: 'READING', W: 'WRITING', L: 'LISTENING', S: 'SPEAKING' };

// Reassign the faculty on a (usually clashing) session. Shows the related
// sessions it conflicts with, and marks which faculty are free in this slot
// and capable of the activity's module (from the capability matrix).
export default function ReassignModal({ allocation, programId, dayAllocations = [], onClose, onSaved }) {
  const [faculty, setFaculty] = useState([]);
  const [caps, setCaps] = useState(null); // null = not loaded / unavailable
  const [facultyId, setFacultyId] = useState(allocation.faculty_id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Load faculty and capabilities independently: capabilities are optional
  // (the table may not exist on a DB that hasn't run db:migrate), and must
  // never block the faculty list from loading.
  useEffect(() => {
    api.get('/faculty').then(({ data }) => setFaculty(data)).catch(() => setFaculty([]));
    api.get(`/capabilities?program_id=${programId}`)
      .then(({ data }) => setCaps(data))
      .catch(() => setCaps(null));
  }, [programId]);

  const module = MODULE_BY_LETTER[(allocation.activity_code || '')[0]?.toUpperCase()] || null;

  // faculty already booked in this slot (other sessions) -> picking them clashes
  const busyIds = useMemo(() => {
    const s = new Set();
    for (const x of dayAllocations)
      if (x.time_slot_id === allocation.time_slot_id && x.faculty_id && x.id !== allocation.id)
        s.add(x.faculty_id);
    return s;
  }, [dayAllocations, allocation]);

  // faculty capable of this module (or GENERAL). null = no module or no
  // capability data available -> don't mark anyone (still list every tutor).
  const capableIds = useMemo(() => {
    if (!module || !caps) return null;
    const s = new Set();
    for (const c of caps) if (c.module === module || c.module === 'GENERAL') s.add(c.faculty_id);
    return s;
  }, [caps, module]);

  // the sessions this one currently clashes with (same slot, same faculty)
  const related = useMemo(() =>
    dayAllocations.filter((x) =>
      x.id !== allocation.id &&
      x.time_slot_id === allocation.time_slot_id &&
      x.faculty_id && x.faculty_id === allocation.faculty_id),
  [dayAllocations, allocation]);

  // order: capable & free first, then capable, then the rest (alpha within ties)
  const options = useMemo(() => {
    const score = (f) => (((!capableIds || capableIds.has(f.id)) ? 2 : 0) + (!busyIds.has(f.id) ? 1 : 0));
    return [...faculty].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  }, [faculty, busyIds, capableIds]);

  async function save() {
    setBusy(true); setErr('');
    try {
      await api.put(`/allocations/${allocation.id}`, { faculty_id: facultyId || null });
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || 'Save failed');
      setBusy(false);
    }
  }

  const picked = faculty.find((f) => f.id === Number(facultyId));
  const pickedClashes = picked && busyIds.has(picked.id);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Reassign faculty</h3>
        <div className="sub" style={{ marginBottom: 10 }}>
          {(allocation.batch_name || '—')} · {allocation.slot_label} · {allocation.activity_code || 'session'}
          {' '}— currently <b>{allocation.faculty_name || 'unassigned'}</b>
        </div>

        {related.length > 0 && (
          <div className="card" style={{ borderColor: 'var(--error)', marginBottom: 12, padding: 10 }}>
            <b>Clashes with</b>
            <ul className="conf-list" style={{ marginTop: 6 }}>
              {related.map((r) => (
                <li key={r.id}>
                  <span className="dot error" />
                  {(r.batch_name || '—')} · {r.activity_code || 'session'}{r.room_code ? ` · ${r.room_code}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="field">
          <label>New faculty{module ? ` (for ${module.toLowerCase()})` : ''}</label>
          <select value={facultyId} onChange={(e) => setFacultyId(e.target.value)}>
            <option value="">— unassigned —</option>
            {options.map((f) => {
              const free = !busyIds.has(f.id);
              const capable = capableIds && capableIds.has(f.id); // only when data is available
              const tags = [capable ? '✓ capable' : null, free ? null : '• busy this slot'].filter(Boolean);
              return (
                <option key={f.id} value={f.id}>
                  {f.name}{tags.length ? `  (${tags.join(', ')})` : ''}
                </option>
              );
            })}
          </select>
        </div>

        {pickedClashes && (
          <div className="err">Heads up: {picked.name} is already booked in this slot — this would clash too.</div>
        )}
        {err && <div className="err">{err}</div>}

        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Reassign'}</button>
        </div>
      </div>
    </div>
  );
}
