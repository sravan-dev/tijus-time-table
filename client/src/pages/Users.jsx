import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth, roleLabel } from '../auth';

export default function Users() {
  const { user, isAdmin } = useAuth();
  const [rows, setRows] = useState([]);
  const [faculty, setFaculty] = useState([]);
  const [editing, setEditing] = useState(null);   // app-user modal
  const [credFor, setCredFor] = useState(null);    // faculty-login modal
  const [err, setErr] = useState('');

  const load = () => {
    api.get('/users').then((r) => setRows(r.data)).catch(() => {});
    api.get('/users/faculty-accounts').then((r) => setFaculty(r.data)).catch(() => {});
  };
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/timetable" replace />;

  async function del(u) {
    if (!confirm(`Delete user "${u.username}"?`)) return;
    setErr('');
    try { await api.delete(`/users/${u.id}`); load(); }
    catch (e) { setErr(e.response?.data?.error || 'Delete failed'); }
  }

  // tutor-linked accounts (faculty or manager) are managed in the Faculty logins
  // section, so keep them out of the App users table to avoid duplicates.
  const appUsers = rows.filter((u) => !u.faculty_id);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Users &amp; Credentials</h3>
        <button className="btn" onClick={() => setEditing({})}>+ Add user</button>
      </div>
      {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}

      {/* ---- App users (admin / viewer) ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>App users</div>
        <table className="data">
          <thead><tr><th>Username</th><th>Full name</th><th>Role</th><th>Created</th><th /></tr></thead>
          <tbody>
            {appUsers.map((u) => (
              <tr key={u.id}>
                <td><b>{u.username}</b>{u.id === user.id && <span className="room"> (you)</span>}</td>
                <td>{u.full_name || '—'}</td>
                <td><RoleBadge role={u.role} /></td>
                <td>{u.created_at ? u.created_at.slice(0, 10) : '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn sm ghost" onClick={() => setEditing(u)}>Edit</button>{' '}
                  <button className="btn sm danger" onClick={() => del(u)} disabled={u.id === user.id}>Delete</button>
                </td>
              </tr>
            ))}
            {!appUsers.length && <tr><td colSpan={5}>No app users.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ---- Faculty logins ---- */}
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Faculty logins</div>
        <div className="sub" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>
          Give a tutor a login so they can see their schedule and apply for leave.
        </div>
        <table className="data">
          <thead><tr><th>Faculty</th><th>Username</th><th>Login</th><th /></tr></thead>
          <tbody>
            {faculty.map((f) => (
              <tr key={f.faculty_id}>
                <td><b>{f.faculty_name}</b></td>
                <td>{f.username || <span className="room">—</span>}</td>
                <td>
                  {f.user_id
                    ? <RoleBadge role={f.role} />
                    : <span className="badge" style={{ background: 'var(--muted)' }}>no login</span>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn sm ghost" onClick={() => setCredFor(f)}>
                    {f.user_id ? 'Reset password' : 'Create login'}
                  </button>
                </td>
              </tr>
            ))}
            {!faculty.length && <tr><td colSpan={4}>No faculty.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <UserModal initial={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
      {credFor && (
        <FacultyCredModal faculty={credFor} onClose={() => setCredFor(null)}
          onSaved={() => { setCredFor(null); load(); }} />
      )}
    </div>
  );
}

function RoleBadge({ role }) {
  const bg =
    role === 'admin' ? 'var(--brand)' :
    role === 'manager' ? 'var(--accent-green)' :
    role === 'faculty' ? 'var(--accent-blue)' : 'var(--muted)';
  return <span className="badge" style={{ background: bg }}>{roleLabel(role)}</span>;
}

// ---- App user create/edit ----
function UserModal({ initial, onClose, onSaved }) {
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState({
    username: initial.username || '', full_name: initial.full_name || '',
    role: initial.role || 'viewer', password: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isTutor = form.role === 'faculty';

  async function save() {
    setErr('');
    if (!form.username) return setErr('Username is required');
    if (!isEdit && !form.password) return setErr('Password is required');
    // the server names the tutor's new faculty record after their full name
    if (!isEdit && isTutor && !form.full_name.trim())
      return setErr('A full name is required for a tutor');
    setBusy(true);
    try {
      if (isEdit) {
        const payload = { username: form.username, full_name: form.full_name, role: form.role };
        if (form.password) payload.password = form.password;
        await api.put(`/users/${initial.id}`, payload);
      } else {
        await api.post('/users', form);
      }
      onSaved();
    } catch (e) { setErr(e.response?.data?.error || 'Save failed'); setBusy(false); }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? `Edit user · ${initial.username}` : 'Add user'}</h3>
        <div className="field"><label>Username</label>
          <input type="text" value={form.username} onChange={set('username')} autoFocus /></div>
        <div className="field"><label>Full name</label>
          <input type="text" value={form.full_name} onChange={set('full_name')} /></div>
        <div className="field"><label>Role</label>
          <select value={form.role} onChange={set('role')}>
            <option value="admin">admin — full access</option>
            <option value="manager">manager — all except Users &amp; Settings</option>
            <option value="faculty">tutor — own schedule, sessions &amp; leave (needs approval)</option>
            <option value="viewer">viewer — read only</option>
          </select></div>
        {/* The tutor's faculty record is created from the full name — no need to
            add them under Manage → Faculty first. */}
        {!isEdit && isTutor && (
          <div className="sub" style={{ color: 'var(--muted)', fontSize: 12, marginTop: -4 }}>
            A faculty record for <b>{form.full_name.trim() || 'this tutor'}</b> is created
            automatically, so they can be allocated sessions right away.
          </div>
        )}
        <div className="field"><label>{isEdit ? 'New password (leave blank to keep)' : 'Password'}</label>
          <input type="password" value={form.password} onChange={set('password')}
            placeholder={isEdit ? '••••••••' : ''} /></div>
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Faculty login set/reset ----
function FacultyCredModal({ faculty, onClose, onSaved }) {
  const isReset = Boolean(faculty.user_id);
  const suggested = faculty.username || faculty.faculty_name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const [username, setUsername] = useState(suggested);
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(faculty.role === 'manager' ? 'manager' : 'faculty');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setErr('');
    if (!username || !password) return setErr('Username and password are required');
    setBusy(true);
    try {
      await api.post(`/users/faculty/${faculty.faculty_id}/credentials`, { username, password, role });
      onSaved();
    } catch (e) { setErr(e.response?.data?.error || 'Save failed'); setBusy(false); }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isReset ? 'Reset login' : 'Create login'} · {faculty.faculty_name}</h3>
        <div className="field"><label>Username</label>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></div>
        <div className="field"><label>Access</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="faculty">Faculty — own schedule &amp; leave only</option>
            <option value="manager">Manager — can manage (all except Users &amp; Settings) + own schedule</option>
          </select></div>
        <div className="field"><label>{isReset ? 'New password' : 'Password'}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
