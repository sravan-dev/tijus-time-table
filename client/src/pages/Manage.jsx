import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import SplitRoomModal from '../components/SplitRoomModal';
import ColourPicker from '../components/ColourPicker';

export default function Manage() {
  // Keep the active sub-tab in the URL (?tab=) so a refresh preserves it.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'batches';
  const setTab = (t) => setSearchParams({ tab: t }, { replace: true });
  return (
    <div className="page">
      <div className="tabs" style={{ marginBottom: 12 }}>
        {TABS.map((t) => (
          <div key={t} className={'tab' + (t === tab ? ' active' : '')} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </div>
        ))}
      </div>
      {tab === 'batches' && <Batches />}
      {tab === 'faculty' && <Faculty />}
      {tab === 'modules' && <Modules />}
      {tab === 'rooms' && <Rooms />}
      {tab === 'activities' && <Activities />}
      {tab === 'timings' && <Timings />}
    </div>
  );
}

// "Modules" here is tutor capability (who can teach Listening/Reading/…);
// "Activities" is the session-type list the grid prints as R, W, W.C and so on.
const TABS = ['batches', 'faculty', 'modules', 'rooms', 'activities', 'timings'];

function Batches() {
  const { canEdit } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [rooms, setRooms] = useState([]);
  const load = () => api.get('/batches').then((r) => setRows(r.data));
  useEffect(() => {
    load();
    api.get('/programs').then((r) => setPrograms(r.data));
    api.get('/classrooms').then((r) => setRooms(r.data));
  }, []);

  async function add() {
    const name = prompt('Batch name?');
    if (!name) return;
    await api.post('/batches', { name, program_id: programs[0]?.id, student_count: 0 });
    load();
  }
  async function save(b, msg) {
    try {
      await api.put(`/batches/${b.id}`, b);
      load();
      if (msg) toast(msg);
    } catch (e) {
      toast(e.response?.data?.error || 'Update failed', 'error');
    }
  }
  async function del(id) {
    if (!confirm('Delete batch?')) return;
    await api.delete(`/batches/${id}`);
    load();
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <b>Batches ({rows.length})</b>
        {canEdit && <button className="btn sm" onClick={add}>+ Add</button>}
      </div>
      <table className="data">
        <thead><tr><th>Name</th><th>Program</th><th>Students</th><th>Home room</th><th>Exam</th><th /></tr></thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td>{b.name}</td>
              <td>{b.program_code}</td>
              <td>
                {canEdit ? (
                  <input type="number" style={{ width: 60 }} defaultValue={b.student_count}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== b.student_count) save({ ...b, student_count: v }, 'Students updated');
                    }} />
                ) : b.student_count}
              </td>
              <td>
                {canEdit ? (
                  <select defaultValue={b.home_room_id || ''}
                    onChange={(e) => save({ ...b, home_room_id: e.target.value || null }, 'Home room updated')}>
                    <option value="">—</option>
                    {rooms.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
                  </select>
                ) : (b.home_room_code || '—')}
              </td>
              <td>{b.exam_month || '—'}</td>
              <td>{canEdit && <button className="btn sm danger" onClick={() => del(b.id)}>✕</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Faculty() {
  const { canEdit } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const load = () => api.get('/faculty').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);
  async function add() {
    const name = prompt('Faculty name?');
    if (name) { await api.post('/faculty', { name }); load(); }
  }
  async function saveEmail(f, email) {
    if (email === (f.email || '')) return;
    try {
      await api.put(`/faculty/${f.id}`, { ...f, email: email || null });
      load();
      toast('Email updated');
    } catch (e) {
      toast(e.response?.data?.error || 'Update failed', 'error');
    }
  }
  async function toggleActive(f) {
    try {
      await api.put(`/faculty/${f.id}`, { ...f, active: f.active ? 0 : 1 });
      load();
      toast(f.active ? `${f.name} marked inactive` : `${f.name} marked active`);
    } catch (e) {
      toast(e.response?.data?.error || 'Update failed', 'error');
    }
  }
  const activeCount = rows.filter((f) => f.active).length;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <b>Faculty ({activeCount} active{rows.length > activeCount ? `, ${rows.length - activeCount} inactive` : ''})</b>
        {canEdit && <button className="btn sm" onClick={add}>+ Add</button>}
      </div>
      <div className="sub" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>
        Add an email to send a tutor their schedule after allocations.
      </div>
      <table className="data">
        <thead><tr><th>Name</th><th>Email</th><th>Active</th></tr></thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>
                {canEdit ? (
                  <input type="email" defaultValue={f.email || ''} placeholder="—" style={{ width: 240 }}
                    onBlur={(e) => saveEmail(f, e.target.value.trim())} />
                ) : (f.email || '—')}
              </td>
              <td>
                {canEdit ? (
                  <input type="checkbox" checked={!!f.active} onChange={() => toggleActive(f)} />
                ) : (f.active ? 'Yes' : 'No')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Which modules each tutor can teach, per program (from the TUTORS & MODULE
// sheet). Fluency has no module split, so it uses a single "Assigned" column.
const MODULE_COLS = [
  { code: 'LISTENING', label: 'L' },
  { code: 'READING', label: 'R' },
  { code: 'SPEAKING', label: 'S' },
  { code: 'WRITING', label: 'W' },
];

function Modules() {
  const { canEdit } = useAuth();
  const toast = useToast();
  const [programs, setPrograms] = useState([]);
  const [faculty, setFaculty] = useState([]);
  const [programId, setProgramId] = useState(null);
  const [caps, setCaps] = useState([]); // capability rows for the active program

  const program = programs.find((p) => p.id === programId);
  const isFluency = program?.code === 'FLUENCY';
  const cols = isFluency ? [{ code: 'GENERAL', label: 'Assigned' }] : MODULE_COLS;
  // Fast lookup of existing capabilities: "facultyId:MODULE".
  const have = new Set(caps.map((c) => `${c.faculty_id}:${c.module}`));

  const loadCaps = (pid) => api.get('/capabilities', { params: { program_id: pid } })
    .then((r) => setCaps(r.data));

  useEffect(() => {
    api.get('/faculty').then((r) => setFaculty(r.data.filter((f) => f.active)));
    api.get('/programs').then((r) => {
      setPrograms(r.data);
      if (r.data.length) setProgramId(r.data[0].id);
    });
  }, []);
  useEffect(() => { if (programId) loadCaps(programId); }, [programId]);

  async function toggle(facultyId, module, on) {
    try {
      if (on) await api.post('/capabilities', { faculty_id: facultyId, program_id: programId, module });
      else await api.delete('/capabilities', { data: { faculty_id: facultyId, program_id: programId, module } });
      await loadCaps(programId);
    } catch (e) {
      toast(e.response?.data?.error || 'Update failed', 'error');
    }
  }

  // Show tutors that teach this program first, then the rest (so admins can
  // add a missing assignment). A tutor "teaches" it if they have any module.
  const teaching = new Set(caps.map((c) => c.faculty_id));
  const rows = [...faculty].sort((a, b) => {
    const ta = teaching.has(a.id), tb = teaching.has(b.id);
    if (ta !== tb) return ta ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <b>Modules by tutor</b>
        <select value={programId || ''} onChange={(e) => setProgramId(Number(e.target.value))}>
          {programs.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
        </select>
      </div>
      <div className="sub" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>
        Tick the modules each tutor can teach for <b>{program?.code}</b>.
        {isFluency && ' Fluency has no module split — tick to assign the tutor.'}
      </div>
      <table className="data">
        <thead>
          <tr>
            <th>Tutor</th>
            {cols.map((c) => <th key={c.code} style={{ textAlign: 'center' }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td>
              {cols.map((c) => {
                const on = have.has(`${f.id}:${c.code}`);
                return (
                  <td key={c.code} style={{ textAlign: 'center' }}>
                    {canEdit ? (
                      <input type="checkbox" checked={on}
                        onChange={(e) => toggle(f.id, c.code, e.target.checked)} />
                    ) : (on ? '✓' : '')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rooms() {
  const { canEdit } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [splitting, setSplitting] = useState(null); // room being split
  const load = () => api.get('/classrooms').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);
  async function add() {
    const code = prompt('Room code?');
    if (code) { await api.post('/classrooms', { code, capacity: 0 }); load(); }
  }
  async function setCap(r, capacity) {
    try {
      await api.put(`/classrooms/${r.id}`, { ...r, capacity: Number(capacity) });
      load();
      toast('Capacity updated');
    } catch (e) {
      toast(e.response?.data?.error || 'Update failed', 'error');
    }
  }
  async function del(r) {
    if (!confirm(`Delete room ${r.code}? Sessions using it will be left without a room.`)) return;
    try {
      await api.delete(`/classrooms/${r.id}`);
      load();
      toast(`Deleted ${r.code}`);
    } catch (e) {
      toast(e.response?.data?.error || 'Delete failed', 'error');
    }
  }
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <b>Classrooms ({rows.length})</b>
        {canEdit && <button className="btn sm" onClick={add}>+ Add</button>}
      </div>
      {canEdit && (
        <div className="sub" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>
          <b>Split</b> divides a room into <b>Front</b>/<b>Back</b> sections you can allocate separately.
        </div>
      )}
      <table className="data">
        <thead><tr><th>Code</th><th>Capacity</th>{canEdit && <th>Section</th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.code}</td>
              <td>
                {canEdit ? (
                  <input type="number" style={{ width: 70 }} defaultValue={r.capacity}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== r.capacity) setCap(r, v);
                    }} />
                ) : r.capacity}
              </td>
              {canEdit && (
                <td>
                  <button className="btn sm" onClick={() => setSplitting(r)}>Split</button>
                  <button className="btn sm danger" style={{ marginLeft: 6 }} onClick={() => del(r)}>Delete</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {splitting && (
        <SplitRoomModal
          room={splitting}
          existingCodes={rows.map((x) => x.code)}
          onClose={() => setSplitting(null)}
          onSaved={(n) => {
            const code = splitting.code;
            setSplitting(null); load();
            toast(`Split ${code} into ${n} section${n > 1 ? 's' : ''}`);
          }}
        />
      )}
    </div>
  );
}

// A program's time slots: the columns of its timetable grid, in order. Changing
// a slot re-times that column for every day (sessions keep their slot link).
function Timings() {
  const { canEdit } = useAuth();
  const toast = useToast();
  const [programs, setPrograms] = useState([]);
  const [programId, setProgramId] = useState(null);
  const [rows, setRows] = useState([]);

  const load = (pid = programId) =>
    api.get('/slots', { params: { program_id: pid, usage: 1 } }).then((r) => setRows(r.data));

  useEffect(() => {
    api.get('/programs').then((r) => {
      setPrograms(r.data);
      if (r.data.length) setProgramId(r.data[0].id);
    });
  }, []);
  useEffect(() => { if (programId) load(programId); }, [programId]);

  const hhmm = (t) => (t || '').slice(0, 5);

  async function save(s, patch) {
    const next = { ...s, ...patch };
    if (!String(next.label).trim()) { toast('A label is required', 'error'); load(); return; }
    try {
      await api.put(`/slots/${s.id}`, {
        label: String(next.label).trim(),
        start_time: hhmm(next.start_time) || null,
        end_time: hhmm(next.end_time) || null,
      });
      await load();
      toast(`Saved ${String(next.label).trim()}`);
    } catch (e) {
      toast(e.response?.data?.error || 'Save failed', 'error');
      load();
    }
  }

  async function add() {
    const label = prompt('Label shown in the grid header? (e.g. 5.00-6.00)');
    if (!label?.trim()) return;
    try {
      await api.post('/slots', { program_id: programId, label: label.trim() });
      await load();
      toast(`Added ${label.trim()} — set its start and end times`);
    } catch (e) {
      toast(e.response?.data?.error || 'Could not add the slot', 'error');
    }
  }

  async function move(i, dir) {
    const order = rows.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    try {
      await api.put('/slots/reorder', { program_id: programId, order });
      await load();
    } catch (e) {
      toast(e.response?.data?.error || 'Could not reorder', 'error');
    }
  }

  async function del(s) {
    if (!confirm(`Delete the ${s.label} slot from ${program?.code}?`)) return;
    try {
      await api.delete(`/slots/${s.id}`);
      await load();
      toast(`Deleted ${s.label}`);
    } catch (e) {
      toast(e.response?.data?.error || 'Delete failed', 'error');
    }
  }

  const program = programs.find((p) => p.id === programId);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <b>Timings ({rows.length})</b>
        <div className="row" style={{ gap: 8 }}>
          <select value={programId || ''} onChange={(e) => setProgramId(Number(e.target.value))}>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
          {canEdit && <button className="btn sm" onClick={add} disabled={!programId}>+ Add</button>}
        </div>
      </div>
      <div className="sub" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>
        The time slots of the <b>{program?.code}</b> timetable, left to right. The <b>label</b> is
        what the grid header prints; a change applies to every day. Generating from a day sheet
        fills the slots by position, so keep them in the sheet's column order.
      </div>
      <table className="data">
        <thead>
          <tr>
            <th>#</th><th>Label</th><th>Start</th><th>End</th><th>Sessions</th>
            {canEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            // keyed on the values so the inputs reset after every save/reload
            <tr key={`${s.id}|${s.label}|${s.start_time}|${s.end_time}`}>
              <td>{i + 1}</td>
              <td>
                {canEdit ? (
                  <input type="text" style={{ width: 120 }} defaultValue={s.label}
                    onBlur={(e) => { if (e.target.value.trim() !== s.label) save(s, { label: e.target.value }); }} />
                ) : <b>{s.label}</b>}
              </td>
              <td>
                {canEdit ? (
                  <input type="time" defaultValue={hhmm(s.start_time)}
                    onBlur={(e) => { if (e.target.value !== hhmm(s.start_time)) save(s, { start_time: e.target.value }); }} />
                ) : hhmm(s.start_time)}
              </td>
              <td>
                {canEdit ? (
                  <input type="time" defaultValue={hhmm(s.end_time)}
                    onBlur={(e) => { if (e.target.value !== hhmm(s.end_time)) save(s, { end_time: e.target.value }); }} />
                ) : hhmm(s.end_time)}
              </td>
              <td>{s.usage_count ?? 0}</td>
              {canEdit && (
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm ghost" onClick={() => move(i, -1)} disabled={i === 0} title="Move left">↑</button>
                  <button className="btn sm ghost" style={{ marginLeft: 4 }} onClick={() => move(i, 1)}
                    disabled={i === rows.length - 1} title="Move right">↓</button>
                  <button className="btn sm danger" style={{ marginLeft: 6 }} onClick={() => del(s)}
                    disabled={s.usage_count > 0}
                    title={s.usage_count > 0 ? 'Sessions use this slot — move or clear them first' : 'Delete'}>
                    Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && programId && (
        <div className="notif-empty">No time slots for this program yet.</div>
      )}
    </div>
  );
}

// Session types: the short codes the timetable grid prints in each cell (R, W,
// W.C) together with what they actually mean, and the colours they highlight
// with. Codes come in from the imported sheets, so most start life without a
// full name until someone fills one in here.
function Activities() {
  const { canEdit } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null); // activity being edited

  const load = () => api.get('/activities?usage=1').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  async function add() {
    const name = prompt('Activity name? (e.g. Reading)');
    if (!name?.trim()) return;
    const code = prompt('Short code shown in the grid?', name.trim().toUpperCase().slice(0, 20));
    if (!code?.trim()) return;
    try {
      await api.post('/activities', { name: name.trim(), code: code.trim() });
      await load();
      toast(`Added ${code.trim().toUpperCase()}`);
    } catch (e) {
      toast(e.response?.data?.error || 'Could not add the activity', 'error');
    }
  }

  async function del(a) {
    const used = a.usage_count
      ? `\n\n${a.usage_count} session${a.usage_count === 1 ? '' : 's'} use it and will be left without a type.`
      : '';
    if (!confirm(`Delete the activity ${a.code}?${used}`)) return;
    try {
      await api.delete(`/activities/${a.id}`);
      await load();
      toast(`Deleted ${a.code}`);
    } catch (e) {
      toast(e.response?.data?.error || 'Delete failed', 'error');
    }
  }

  const named = rows.filter((a) => a.name && a.name !== a.code).length;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <b>Activities ({rows.length})</b>
        {canEdit && <button className="btn sm" onClick={add}>+ Add</button>}
      </div>
      <div className="sub" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>
        The <b>code</b> is what each timetable cell prints; the <b>name</b> is what it stands for.
        Colours here are the default highlight for that type — a cell can still override them.
        {named < rows.length && ` ${rows.length - named} type(s) have no full name yet.`}
      </div>
      <table className="data">
        <thead>
          <tr>
            <th>Code</th><th>Name</th><th>Preview</th><th>Sessions</th>
            {canEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td><b>{a.code}</b></td>
              <td>{a.name && a.name !== a.code
                ? a.name
                : <span style={{ color: 'var(--muted)' }}>no name yet</span>}</td>
              <td>
                <span className="act-preview"
                  style={{ color: a.text_color || 'inherit', background: a.bg_color || 'transparent' }}>
                  {a.code}
                </span>
              </td>
              <td>{a.usage_count ?? 0}</td>
              {canEdit && (
                <td>
                  <button className="btn sm" onClick={() => setEditing(a)}>Edit</button>
                  <button className="btn sm danger" style={{ marginLeft: 6 }} onClick={() => del(a)}>Delete</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="notif-empty">No activity types yet.</div>
      )}

      {editing && (
        <ActivityEditor
          activity={editing}
          onClose={() => setEditing(null)}
          onSaved={(code) => { setEditing(null); load(); toast(`Saved ${code}`); }}
        />
      )}
    </div>
  );
}

// Edit one activity's code, name and default colours.
function ActivityEditor({ activity, onClose, onSaved }) {
  const [code, setCode] = useState(activity.code);
  const [name, setName] = useState(activity.name === activity.code ? '' : activity.name || '');
  const [text, setText] = useState(activity.text_color || '#334155');
  const [bg, setBg] = useState(activity.bg_color || '#e2e8f0');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(colours = true) {
    if (!code.trim()) return setErr('A code is required');
    if (!name.trim()) return setErr('A name is required');
    setBusy(true); setErr('');
    try {
      await api.put(`/activities/${activity.id}`, {
        code: code.trim(),
        name: name.trim(),
        // Empty strings clear the colours back to no highlight.
        text_color: colours ? text : '',
        bg_color: colours ? bg : '',
      });
      onSaved(code.trim().toUpperCase());
    } catch (e) {
      setErr(e.response?.data?.error || 'Save failed');
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit activity</h3>
        <div className="field">
          <label>Code shown in the grid</label>
          <input value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="field">
          <label>What it stands for</label>
          <input value={name} maxLength={80} placeholder="e.g. Reading"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Default highlight</label>
          <ColourPicker text={text} bg={bg}
            onChange={({ text: t, bg: b }) => { setText(t); setBg(b); }} />
        </div>
        {err && <div style={{ color: 'var(--error)', fontSize: 13 }}>{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn ghost" onClick={() => save(false)} disabled={busy}>
            Save without colours
          </button>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={() => save(true)} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
