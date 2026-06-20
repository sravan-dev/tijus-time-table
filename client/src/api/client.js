import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// Attach JWT from localStorage to every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('tijus_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, drop the session and bounce to login.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('tijus_token');
      localStorage.removeItem('tijus_user');
      if (location.pathname !== '/login') location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
