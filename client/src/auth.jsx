import { createContext, useContext, useState } from 'react';
import api from './api/client';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('tijus_user');
    return raw ? JSON.parse(raw) : null;
  });

  async function login(username, password) {
    const { data } = await api.post('/auth/login', { username, password });
    localStorage.setItem('tijus_token', data.token);
    localStorage.setItem('tijus_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem('tijus_token');
    localStorage.removeItem('tijus_user');
    setUser(null);
  }

  return (
    <AuthCtx.Provider value={{
      user, login, logout,
      role: user?.role,
      isAdmin: user?.role === 'admin',
      isManager: user?.role === 'manager',
      isFaculty: user?.role === 'faculty',
      canEdit: user?.role === 'admin' || user?.role === 'manager',
      // a manager/faculty linked to a tutor record can see their own schedule
      hasSelfSchedule: !!user?.faculty_id,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
