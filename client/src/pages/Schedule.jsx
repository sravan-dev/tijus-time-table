import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../auth';

export default function Schedule() {
  const { canEdit } = useAuth();
  const [faculty, setFaculty] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [leave, setLeave] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [lf, setLf] = useState({ faculty_id: '', leave_date: '', reason: '' });
  const [rb, setRb] = useState({ classroom_id: '', block_date: '', reason: '' });

  const load = () => {
    api.get('/schedule/leave').then((r) => setLeave(r.data));
    api.get('/schedule/room-blocks').then((r) => setBlocks(r.data));
  };
  useEffect(() => {
    api.get('/faculty').then((r) => setFaculty(r.data));
    api.get('/classrooms').then((r) => setRooms(r.data));
    load();
  }, []);

  async function addLeave() {
    if (!lf.faculty_id || !lf.leave_date) return;
    await api.post('/schedule/leave', lf);
    setLf({ faculty_id: '', leave_date: '', reason: '' });
    load();
  }
  async function addBlock() {
    if (!rb.classroom_id || !rb.block_date) return;
    await api.post('/schedule/room-blocks', rb);
    setRb({ classroom_id: '', block_date: '', reason: '' });
    load();
  }

  return (
    <div className="page row" style={{ alignItems: 'flex-start' }}>
      <div className="card" style={{ flex: 1, minWidth: 320 }}>
        <b>Faculty leave</b>
        {canEdit && (
          <div className="row" style={{ margin: '10px 0' }}>
            <select value={lf.faculty_id} onChange={(e) => setLf({ ...lf, faculty_id: e.target.value })}>
              <option value="">Faculty…</option>
              {faculty.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <input type="date" value={lf.leave_date} onChange={(e) => setLf({ ...lf, leave_date: e.target.value })} />
            <input type="text" placeholder="reason" value={lf.reason}
              onChange={(e) => setLf({ ...lf, reason: e.target.value })} />
            <button className="btn sm" onClick={addLeave}>Add</button>
          </div>
        )}
        <table className="data">
          <thead><tr><th>Faculty</th><th>Date</th><th>Reason</th><th /></tr></thead>
          <tbody>
            {leave.map((l) => (
              <tr key={l.id}>
                <td>{l.faculty_name}</td><td>{l.leave_date.slice(0, 10)}</td><td>{l.reason}</td>
                <td>{canEdit && <button className="btn sm danger"
                  onClick={async () => { await api.delete(`/schedule/leave/${l.id}`); load(); }}>✕</button>}</td>
              </tr>
            ))}
            {!leave.length && <tr><td colSpan={4}>No leave recorded.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ flex: 1, minWidth: 320 }}>
        <b>Room blocks</b>
        {canEdit && (
          <div className="row" style={{ margin: '10px 0' }}>
            <select value={rb.classroom_id} onChange={(e) => setRb({ ...rb, classroom_id: e.target.value })}>
              <option value="">Room…</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
            </select>
            <input type="date" value={rb.block_date} onChange={(e) => setRb({ ...rb, block_date: e.target.value })} />
            <input type="text" placeholder="reason" value={rb.reason}
              onChange={(e) => setRb({ ...rb, reason: e.target.value })} />
            <button className="btn sm" onClick={addBlock}>Add</button>
          </div>
        )}
        <table className="data">
          <thead><tr><th>Room</th><th>Date</th><th>Reason</th><th /></tr></thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.id}>
                <td>{b.room_code}</td><td>{b.block_date.slice(0, 10)}</td><td>{b.reason}</td>
                <td>{canEdit && <button className="btn sm danger"
                  onClick={async () => { await api.delete(`/schedule/room-blocks/${b.id}`); load(); }}>✕</button>}</td>
              </tr>
            ))}
            {!blocks.length && <tr><td colSpan={4}>No blocks recorded.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
