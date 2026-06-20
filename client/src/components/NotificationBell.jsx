import { useEffect, useRef, useState } from 'react';
import api from '../api/client';

// Top-bar notification bell. Polls the activity feed and shows a dropdown.
export default function NotificationBell() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => Number(localStorage.getItem('tijus_notif_seen') || 0));
  const ref = useRef(null);

  const load = () => api.get('/notifications').then((r) => setItems(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // refresh every minute
    return () => clearInterval(t);
  }, []);

  // close when clicking outside
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const unread = Math.max(0, items.length - seen);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      localStorage.setItem('tijus_notif_seen', String(items.length));
      setSeen(items.length);
    }
  }

  return (
    <div className="notif-wrap" ref={ref}>
      <button className="notif-btn" onClick={toggle} aria-label="Notifications" title="Notifications">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0
          ? <span className="notif-count">{unread > 9 ? '9+' : unread}</span>
          : items.length > 0 && <span className="notif-dot" />}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            Notifications
            <span className="notif-sub">{items.length} item{items.length === 1 ? '' : 's'}</span>
          </div>
          <div className="notif-list">
            {items.map((n) => (
              <div className="notif-item" key={n.id}>
                <span className={'dot ' + (n.level === 'error' ? 'error' : n.level === 'warn' ? 'warn' : 'info')} />
                <div>
                  <div className="notif-title">{n.title}</div>
                  {n.detail && <div className="notif-detail">{n.detail}</div>}
                </div>
              </div>
            ))}
            {!items.length && <div className="notif-empty">You’re all caught up 🎉</div>}
          </div>
        </div>
      )}
    </div>
  );
}
