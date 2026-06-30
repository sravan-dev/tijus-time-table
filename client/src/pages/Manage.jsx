import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import SplitRoomModal from '../components/SplitRoomModal';

export default function Manage() {
  // Keep the active sub-tab in the URL (?tab=) so a refresh preserves it.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = ['batches', 'faculty', 'modules', 'rooms'].includes(searchParams.get('tab'))
    ? searchParams.get('tab') : 'batches';
  const setTab = (t) => setSearchParams({ tab: t }, { replace: true });
  return (
    <div className="page">
      <div className="tabs" style={{ marginBottom: 12 }}>
        {['batches', 'faculty', 'modules', 'rooms'].map((t) => (
          <div key={t} className={'tab' + (t === tab ? ' active' : '')} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </div>
        ))}
      </div>
      {tab === 'batches' && <Batches />}
      {tab === 'faculty' && <Faculty />}
      {tab === 'modules' && <Modules />}
      {tab === 'rooms' && <Rooms />}
    </div>
  );
}

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
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <b>Faculty ({rows.length})</b>
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
              <td>{f.active ? 'Yes' : 'No'}</td>
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
