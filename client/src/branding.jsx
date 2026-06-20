import { createContext, useContext, useEffect, useState } from 'react';
import api from './api/client';

const BrandingCtx = createContext({ app_title: 'Tijus Academy', app_logo: '', timezone: 'Asia/Kolkata' });

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState({
    app_title: 'Tijus Academy', app_logo: '', timezone: 'Asia/Kolkata',
  });

  const load = () =>
    api.get('/settings/public')
      .then((r) => setBranding(r.data))
      .catch(() => {});

  useEffect(() => { load(); }, []);

  // keep the browser tab title in sync
  useEffect(() => {
    if (branding.app_title) document.title = `${branding.app_title} · Timetable`;
  }, [branding.app_title]);

  return (
    <BrandingCtx.Provider value={{ ...branding, reloadBranding: load }}>
      {children}
    </BrandingCtx.Provider>
  );
}

export const useBranding = () => useContext(BrandingCtx);
