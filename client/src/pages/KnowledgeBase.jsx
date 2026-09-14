import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';

// The Knowledge Base is the library of reference day-sheets the generator is
// trained on: one .docx per weekday pattern. "Generate" on the Timetable builds
// an empty day from the sheet filed under that weekday, so what an admin curates
// here is what new days look like.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// docx files are a few MB; refuse anything wildly larger before uploading it.
const MAX_MB = 15;

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(String(ts).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 10);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function KnowledgeBase() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [docs, setDocs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const fileRef = useRef(null);

  function load() {
    return api.get('/knowledge').then((r) => setDocs(r.data));
  }
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/timetable" replace />;

  async function addSheets(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';                       // allow re-picking the same file
    if (!files.length) return;
    setBusy(true);
    let added = 0;
    for (const file of files) {
      if (file.size > MAX_MB * 1024 * 1024) {
        toast(`${file.name} is over ${MAX_MB} MB`, 'error');
        continue;
      }
      try {
        const content = await readAsDataUrl(file);
        await api.post('/knowledge', { filename: file.name, content });
        added++;
      } catch (err) {
        toast(err.response?.data?.error || `Could not add ${file.name}`, 'error');
      }
    }
    await load();
    setBusy(false);
    if (added) toast(`Added ${added} sheet${added === 1 ? '' : 's'}`);
  }

  async function reseed() {
    setBusy(true);
    try {
      const { data } = await api.post('/knowledge/reseed');
      await load();
      toast(data.added
        ? `Loaded ${data.added} sheet(s) from the Knowledge Base folder`
        : 'Nothing new in the Knowledge Base folder');
    } catch (e) {
      toast(e.response?.data?.error || 'Could not read the Knowledge Base folder', 'error');
    } finally { setBusy(false); }
  }

  async function patch(id, body) {
    await api.put(`/knowledge/${id}`, body);
    await load();
  }

  async function remove(doc) {
    if (!confirm(`Remove "${doc.title}" from the Knowledge Base? Days already generated from it are not affected.`)) return;
    await api.delete(`/knowledge/${doc.id}`);
    if (openId === doc.id) setOpenId(null);
    await load();
    toast('Sheet removed');
  }

  // Build a real day from one sheet, replacing whatever is there if asked.
  async function applyTo(doc) {
    const date = prompt(`Build a day from "${doc.title}" (YYYY-MM-DD):`, todayISO());
    if (!date) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('Use the format YYYY-MM-DD', 'error');
    try {
      const { data } = await api.post(`/knowledge/${doc.id}/apply`, { date });
      toast(`Created ${data.created} sessions on ${date}`);
    } catch (e) {
      const msg = e.response?.data?.error || 'Could not apply the sheet';
      if (e.response?.status === 409 &&
          confirm(`${date} already has sessions. Replace them with this sheet?`)) {
        const { data } = await api.post(`/knowledge/${doc.id}/apply`, { date, replace: true });
        return toast(`Replaced the day with ${data.created} sessions`);
      }
      toast(msg, 'error');
    }
  }

  // Which teaching days have no sheet yet. Sunday is skipped: the academy
  // doesn't run classes then, so a missing Sunday sheet isn't a gap.
  const covered = new Set((docs || []).filter((d) => d.weekday != null).map((d) => d.weekday));
  const missing = WEEKDAYS.map((n, i) => [n, i]).filter(([, i]) => i !== 0 && !covered.has(i));

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Knowledge Base</h3>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost" onClick={reseed} disabled={busy}>
            Load from folder
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Working…' : 'Add sheets'}
          </button>
          <input ref={fileRef} type="file" accept=".docx" multiple hidden onChange={addSheets} />
        </div>
      </div>

      <div className="card kb-intro">
        <p>
          These are the reference timetable sheets the generator learns from. Each sheet is filed
          under a weekday; when someone generates an empty day, the sheet for that weekday is
          re-read and its sessions are created for the new date. A sheet set to &ldquo;Not a day
          sheet&rdquo; (such as the German timetable) is used for any day whose weekday sheet has
          nothing for that program. Tutors, rooms and batches a sheet
          mentions but the system doesn&apos;t know yet are created as it runs.
        </p>
        {!!missing.length && (
          <p className="kb-warn">
            No sheet yet for {missing.map(([n]) => n).join(', ')} — those days still generate by
            copying the most recent matching day.
          </p>
        )}
      </div>

      {docs === null ? (
        <div className="card" style={{ marginTop: 12 }}>Loading…</div>
      ) : !docs.length ? (
        <div className="card notif-empty" style={{ marginTop: 12 }}>
          No sheets yet. Add the academy&apos;s day-sheet .docx files to train the generator.
        </div>
      ) : (
        <div className="card" style={{ marginTop: 12, padding: 0, overflowX: 'auto' }}>
          <table className="tt kb-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Sheet</th>
                <th>Weekday</th>
                <th>Sessions</th>
                <th>Size</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className={d.parse_error ? 'kb-bad' : ''}>
                  <td style={{ textAlign: 'left' }}>
                    <div className="kb-title">{d.title}</div>
                    <div className="kb-file">{d.filename}</div>
                    {d.parse_error && <div className="kb-warn">Could not read: {d.parse_error}</div>}
                  </td>
                  <td>
                    <select
                      value={d.weekday ?? ''}
                      onChange={(e) => patch(d.id, {
                        weekday: e.target.value === '' ? null : Number(e.target.value),
                      })}
                    >
                      <option value="">Not a day sheet</option>
                      {WEEKDAYS.map((n, i) => <option key={n} value={i}>{n}</option>)}
                    </select>
                  </td>
                  <td>{d.parse_error ? '—' : d.session_count}</td>
                  <td>{fmtSize(d.size_bytes)}</td>
                  <td>{fmtDate(d.created_at)}</td>
                  <td>
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <button className="btn ghost sm"
                        onClick={() => setOpenId(openId === d.id ? null : d.id)}>
                        {openId === d.id ? 'Hide' : 'Preview'}
                      </button>
                      <button className="btn ghost sm" onClick={() => applyTo(d)}>Apply to a day</button>
                      <button className="btn ghost sm" onClick={() => remove(d)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && <Preview id={openId} />}
    </div>
  );
}

const todayISO = () => new Date().toISOString().slice(0, 10);

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

// What the parser sees in a sheet: the tables as read out of the .docx, and the
// sessions it would create. Read-only — opening a preview writes nothing.
function Preview({ id }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('sessions');

  useEffect(() => {
    setData(null);
    api.get(`/knowledge/${id}/preview`).then((r) => setData(r.data));
  }, [id]);

  if (!data) return <div className="card" style={{ marginTop: 12 }}>Reading the sheet…</div>;
  if (data.error) {
    return <div className="card kb-warn" style={{ marginTop: 12 }}>Could not read this sheet: {data.error}</div>;
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <b>{data.document.title}</b>
        <div className="tabs">
          {[['sessions', `Sessions (${data.sessions.length})`], ['grid', `Sheet (${data.tables.length} tables)`]]
            .map(([k, label]) => (
              <div key={k} className={'tab' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>
                {label}
              </div>
            ))}
        </div>
      </div>

      {tab === 'sessions' ? (
        <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
          <table className="tt kb-table">
            <thead>
              <tr>
                <th>Program</th><th>Batch</th><th>Slot</th>
                <th>Activity</th><th>Tutor</th><th>Room</th>
                <th style={{ textAlign: 'left' }}>Sheet text</th>
              </tr>
            </thead>
            <tbody>
              {data.sessions.map((s, i) => (
                <tr key={i}>
                  <td>{s.program}</td>
                  <td>{s.batch || '—'}</td>
                  <td>{s.slot}</td>
                  <td>{s.activity || '—'}</td>
                  <td>{s.faculty || '—'}</td>
                  <td>{s.room || '—'}</td>
                  <td style={{ textAlign: 'left', color: 'var(--muted)' }}>{s.raw_text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
          {data.tables.map((rows, ti) => (
            <table className="tt kb-table" key={ti} style={{ marginBottom: 14 }}>
              <tbody>
                {rows.map((cells, ri) => (
                  <tr key={ri}>
                    {cells.map((c, ci) => (
                      <td key={ci} colSpan={c.span > 1 ? c.span : undefined}
                        style={{ textAlign: 'left', fontWeight: ri === 0 ? 700 : 400 }}>
                        {c.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}
    </div>
  );
}
