import { Routes, Route, Navigate, NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { useBranding } from './branding';
import NotificationBell from './components/NotificationBell';
import SupportButton from './components/SupportButton';
import Login from './pages/Login';
import Timetable from './pages/Timetable';
import Manage from './pages/Manage';
import Schedule from './pages/Schedule';
import Users from './pages/Users';
import Settings from './pages/Settings';
import MySchedule from './pages/MySchedule';
import MyLeaves from './pages/MyLeaves';
import Tickets from './pages/Tickets';

// Landing route depends on role.
const homeFor = (role) => (role === 'faculty' ? '/my-schedule' : '/timetable');

function Shell({ children }) {
  const { user, logout, isAdmin, isFaculty, hasSelfSchedule } = useAuth();
  const { app_title, app_logo } = useBranding();
  const nav = useNavigate();
  return (
    <>
      <header className="topbar no-print">
        <Link to={homeFor(user?.role)} className="brand" aria-label={`${app_title} — home`}>
          <img src={app_logo || '/logo.png'} alt={app_title} />
        </Link>
        <nav>
          {isFaculty ? (
            <>
              <NavLink to="/my-schedule">My Schedule</NavLink>
              <NavLink to="/my-leaves">My Leaves</NavLink>
              <NavLink to="/tickets">Support</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/timetable">Timetable</NavLink>
              <NavLink to="/manage">Manage</NavLink>
              <NavLink to="/schedule">Leave &amp; Blocks</NavLink>
              {isAdmin && <NavLink to="/users">Users</NavLink>}
              {isAdmin && <NavLink to="/settings">Settings</NavLink>}
              <NavLink to="/tickets">Tickets</NavLink>
              {/* a manager who is also a tutor gets their personal views too */}
              {hasSelfSchedule && <NavLink to="/my-schedule">My Schedule</NavLink>}
              {hasSelfSchedule && <NavLink to="/my-leaves">My Leaves</NavLink>}
            </>
          )}
        </nav>
        <span className="spacer" />
        <NotificationBell />
        <span className="who">
          {user?.name || user?.username} · <b>{user?.role}</b>
        </span>
        <button className="btn ghost sm" onClick={() => { logout(); nav('/login'); }}>
          Log out
        </button>
      </header>
      {children}
      <SupportButton />
    </>
  );
}

// Route guard: requires login and (optionally) one of the allowed roles.
// `selfSchedule` lets any tutor-linked account (faculty or manager) through.
function RoleRoute({ allow, selfSchedule, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const ok = (allow && allow.includes(user.role)) || (selfSchedule && user.faculty_id);
  if (!ok) return <Navigate to={homeFor(user.role)} replace />;
  return <Shell>{children}</Shell>;
}

const STAFF = ['admin', 'manager', 'viewer'];

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* staff (admin / viewer) */}
      <Route path="/timetable" element={<RoleRoute allow={STAFF}><Timetable /></RoleRoute>} />
      <Route path="/manage" element={<RoleRoute allow={STAFF}><Manage /></RoleRoute>} />
      <Route path="/schedule" element={<RoleRoute allow={STAFF}><Schedule /></RoleRoute>} />
      <Route path="/users" element={<RoleRoute allow={['admin']}><Users /></RoleRoute>} />
      <Route path="/settings" element={<RoleRoute allow={['admin']}><Settings /></RoleRoute>} />

      {/* faculty self-service */}
      <Route path="/my-schedule" element={<RoleRoute allow={['faculty']} selfSchedule><MySchedule /></RoleRoute>} />
      <Route path="/my-leaves" element={<RoleRoute allow={['faculty']} selfSchedule><MyLeaves /></RoleRoute>} />

      {/* support tickets — any signed-in role can raise; admins manage & reply */}
      <Route path="/tickets" element={<RoleRoute allow={['admin', 'manager', 'viewer', 'faculty']}><Tickets /></RoleRoute>} />

      <Route path="*" element={<Navigate to={user ? homeFor(user.role) : '/login'} replace />} />
    </Routes>
  );
}
