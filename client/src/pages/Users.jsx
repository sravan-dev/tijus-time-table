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
  const [resendFor, setResendFor] = useState(null); // resend-credentials modal
  const [editFacFor, setEditFacFor] = useState(null); // edit-faculty-details modal
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

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
      {note && (
        <div className="card" style={{ marginBottom: 10, borderColor: 'var(--accent-green)' }}>
          {note} <button className="btn sm ghost" onClick={() => setNote('')}>Dismiss</button>
        </div>
      )}

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
          “Resend details” sets a new password and emails it to them.
        </div>
        <table className="data">
          <thead><tr><th>Faculty</th><th>Username</th><th>Email</th><th>Login</th><th /></tr></thead>
          <tbody>
            {faculty.map((f) => (
              <tr key={f.faculty_id}>
                <td><b>{f.faculty_name}</b></td>
                <td>{f.username || <span className="room">—</span>}</td>
                <td>{f.email || <span className="room">—</span>}</td>
                <td>
                  {f.user_id
                    ? <RoleBadge role={f.role} />
                    : <span className="badge" style={{ background: 'var(--muted)' }}>no login</span>}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn sm ghost" onClick={() => setEditFacFor(f)}
                    title="Edit name, email, username & password">Edit</button>{' '}
                  <button className="btn sm ghost" onClick={() => setCredFor(f)}>
                    {f.user_id ? 'Reset password' : 'Create login'}
                  </button>{' '}
                  {/* only meaningful once they have a login to send */}
                  {f.user_id && (
                    <button className="btn sm ghost" onClick={() => setResendFor(f)}
                      title="Set a new password and email it to this tutor">
                      ✉ Resend details
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!faculty.length && <tr><td colSpan={5}>No faculty.</td></tr>}
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
      {resendFor && (
        <ResendCredModal faculty={resendFor} onClose={() => setResendFor(null)}
          onSent={(to) => { setResendFor(null); setNote(`Login details emailed to ${to}`); load(); }} />
      )}
      {editFacFor && (
        <FacultyEditModal faculty={editFacFor} onClose={() => setEditFacFor(null)}
          onSaved={() => { setEditFacFor(null); load(); }} />
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
    role: initial.role || 'viewer', password: '', email: '',
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
            add them under Manage → Faculty first. The address lives on that
            record, and is where session and schedule notices are sent. */}
        {!isEdit && isTutor && (
          <>
            <div className="field"><label>Email</label>
              <input type="email" value={form.email} onChange={set('email')}
                placeholder="tutor@example.com" /></div>
            <div className="sub" style={{ color: 'var(--muted)', fontSize: 12, marginTop: -4 }}>
              A faculty record for <b>{form.full_name.trim() || 'this tutor'}</b> is created
              automatically. They’re emailed here whenever a session is assigned to them.
            </div>
          </>
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

// ---- Resend login details (resets the password and emails it) ----
// The stored password is a bcrypt hash, so it cannot be read back and re-sent:
// the only way to tell a tutor their password is to set a new one.
function ResendCredModal({ faculty, onClose, onSent }) {
  const [email, setEmail] = useState(faculty.email || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hadEmail = Boolean(faculty.email);

  async function send() {
    setErr('');
    if (!email.trim()) return setErr('An email address is required');
    setBusy(true);
    try {
      // the address is saved to the faculty record server-side when it's new
      const { data } = await api.post(`/users/faculty/${faculty.faculty_id}/resend-credentials`,
        { email: email.trim() });
      onSent(data.sent_to);
    } catch (e) { setErr(e.response?.data?.error || 'Could not send the email'); setBusy(false); }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Resend login details · {faculty.faculty_name}</h3>
        <div className="field"><label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="tutor@example.com" autoFocus />
          {!hadEmail && (
            <div className="sub" style={{ color: 'var(--muted)', fontSize: 12 }}>
              No address on file — this one is saved to their faculty record.
            </div>
          )}
        </div>
        <div className="card" style={{ borderColor: 'var(--warn)', fontSize: 13 }}>
          Passwords are stored hashed and can’t be looked up, so sending the details
          <b> sets a new password</b> for <b>{faculty.username}</b> and emails it.
          Their current password will stop working.
        </div>
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={send} disabled={busy}>
            {busy ? 'Sending…' : 'Reset & send'}
          </button>
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

// ---- Edit a faculty member's details (name, email, and their login's
// username/password). Updating name/email always works; username/password apply
// to an existing login, or create one when both are given for a no-login tutor.
function FacultyEditModal({ faculty, onClose, onSaved }) {
  const hasLogin = Boolean(faculty.user_id);
  const [name, setName] = useState(faculty.faculty_name || '');
  const [email, setEmail] = useState(faculty.email || '');
  const [username, setUsername] = useState(faculty.username || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setErr('');
    if (!name.trim()) return setErr('Faculty name is required');
    if (!hasLogin && (username.trim() || password) && !(username.trim() && password))
      return setErr('To create a login, enter both a username and a password');
    setBusy(true);
    try {
      await api.put(`/users/faculty/${faculty.faculty_id}`, {
        faculty_name: name.trim(),
        email: email.trim(),
        username: username.trim(),
        password: password || undefined,
      });
      onSaved();
    } catch (e) { setErr(e.response?.data?.error || 'Save failed'); setBusy(false); }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit faculty · {faculty.faculty_name}</h3>
        <div className="field"><label>Faculty name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
        <div className="field"><label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="tutor@example.com" /></div>
        <div className="field"><label>Username</label>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
            placeholder={hasLogin ? '' : 'set a username to create a login'} /></div>
        <div className="field"><label>{hasLogin ? 'New password (leave blank to keep)' : 'Password'}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder={hasLogin ? '••••••••' : 'set a password to create a login'} /></div>
        {!hasLogin && (
          <div className="sub" style={{ color: 'var(--muted)', fontSize: 12, marginTop: -4 }}>
            No login yet — fill in both username and password to create one.
          </div>
        )}
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
