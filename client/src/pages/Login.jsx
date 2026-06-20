import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useBranding } from '../branding';

export default function Login() {
  const { login } = useAuth();
  const { app_title, app_logo } = useBranding();
  const nav = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(username, password);
      nav('/timetable');
    } catch (e) {
      setErr(e.response?.data?.error || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <img src={app_logo || '/logo.png'} alt={app_title}
          style={{ height: 56, display: 'block', margin: '0 auto 12px' }} />
        <h2 style={{ textAlign: 'center' }}>{app_title}</h2>
        <div className="sub" style={{ textAlign: 'center' }}>Timetable &amp; Allocation</div>
        <div className="field">
          <label>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="sub" style={{ marginTop: 14 }}>
          Demo: <b>admin / admin123</b> or <b>viewer / viewer123</b>
        </div>
      </form>
    </div>
  );
}
