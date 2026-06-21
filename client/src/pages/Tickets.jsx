import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../auth';

const STATUS_LABEL = { open: 'Open', answered: 'Answered', closed: 'Closed' };

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(String(ts).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function Tickets() {
  const { isAdmin } = useAuth();
  // Admins default to managing all tickets; everyone else only sees their own.
  const [scope, setScope] = useState(isAdmin ? 'all' : 'mine');
  const [statusFilter, setStatusFilter] = useState('');
  const [list, setList] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const mine = scope === 'mine';

  function load() {
    const params = [];
    // "mine" forces own-tickets-only (matters for admins, whose default is all).
    if (mine) params.push('mine=1');
    // The status filter only applies to the admin "all" view.
    else if (statusFilter) params.push(`status=${statusFilter}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    api.get(`/tickets${qs}`).then((r) => setList(r.data));
  }
  useEffect(load, [scope, statusFilter]);

  const rows = list;

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{isAdmin ? 'Tickets' : 'Support tickets'}</h3>
        {isAdmin && (
          <div className="tabs">
            {['all', 'mine'].map((s) => (
              <div key={s} className={'tab' + (s === scope ? ' active' : '')}
                onClick={() => { setScope(s); setSelectedId(null); }}>
                {s === 'all' ? 'All tickets' : 'Raise a ticket'}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ticket-layout">
        <div className="ticket-list">
          {mine && <RaiseForm onCreated={(id) => { setScope('mine'); load(); setSelectedId(id); }} />}

          {!mine && (
            <div className="card" style={{ padding: 10, marginBottom: 12 }}>
              <div className="row" style={{ gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Filter</span>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  <option value="open">Open</option>
                  <option value="answered">Answered</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 0 }}>
            {rows.map((t) => (
              <button key={t.id} className={'ticket-row' + (t.id === selectedId ? ' active' : '')}
                onClick={() => setSelectedId(t.id)}>
                <div className="ticket-row-top">
                  <span className="ticket-subj">{t.subject}</span>
                  <span className={'tk-badge ' + t.status}>{STATUS_LABEL[t.status]}</span>
                </div>
                <div className="ticket-row-meta">
                  {!mine && <span>{t.user_name || t.username} · </span>}
                  <span>{t.message_count} message{t.message_count === 1 ? '' : 's'} · {fmt(t.updated_at)}</span>
                </div>
              </button>
            ))}
            {!rows.length && (
              <div className="notif-empty">
                {mine ? 'You have not raised any tickets yet.' : 'No tickets here.'}
              </div>
            )}
          </div>
        </div>

        <div className="ticket-thread">
          {selectedId
            ? <Thread id={selectedId} isAdmin={isAdmin} onChanged={load} />
            : <div className="card ticket-empty">Select a ticket to view the conversation.</div>}
        </div>
      </div>
    </div>
  );
}

function RaiseForm({ onCreated }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr('');
    if (!subject.trim()) return setErr('Add a subject');
    if (!body.trim()) return setErr('Describe your issue');
    setBusy(true);
    try {
      const { data } = await api.post('/tickets', { subject, body });
      setSubject(''); setBody('');
      onCreated?.(data.id);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not raise ticket');
    } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Raise a ticket</div>
      <div className="field">
        <label>Subject</label>
        <input type="text" value={subject} maxLength={160}
          placeholder="e.g. Cannot see my Tuesday sessions"
          onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="field">
        <label>Message</label>
        <textarea rows={4} value={body} placeholder="Describe the issue or request…"
          onChange={(e) => setBody(e.target.value)} />
      </div>
      {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}
      <button className="btn" onClick={submit} disabled={busy}>
        {busy ? 'Submitting…' : 'Submit ticket'}
      </button>
    </div>
  );
}

function Thread({ id, isAdmin, onChanged }) {
  const { user } = useAuth();
  const [ticket, setTicket] = useState(null);
  const [reply, setReply] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api.get(`/tickets/${id}`).then((r) => setTicket(r.data)).catch(() => setTicket(null));
  }
  useEffect(load, [id]);

  async function send() {
    setErr('');
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await api.post(`/tickets/${id}/messages`, { body: reply });
      setReply('');
      load();
      onChanged?.();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not send reply');
    } finally { setBusy(false); }
  }

  async function setStatus(status) {
    await api.patch(`/tickets/${id}`, { status });
    load();
    onChanged?.();
  }

  if (!ticket) return <div className="card ticket-empty">Loading…</div>;
  const closed = ticket.status === 'closed';

  return (
    <div className="card ticket-detail">
      <div className="ticket-detail-head">
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{ticket.subject}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {ticket.user_name || ticket.username} · opened {fmt(ticket.created_at)}
          </div>
        </div>
        <span className={'tk-badge ' + ticket.status}>{STATUS_LABEL[ticket.status]}</span>
      </div>

      {isAdmin && (
        <div className="row" style={{ gap: 8, margin: '4px 0 12px' }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Set status</span>
          <select value={ticket.status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Open</option>
            <option value="answered">Answered</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      )}

      <div className="ticket-messages">
        {ticket.messages.map((m) => {
          const own = m.user_id === user?.id;
          const staff = m.author_role === 'admin' || m.author_role === 'manager';
          return (
            <div key={m.id} className={'tk-msg' + (own ? ' own' : '')}>
              <div className="tk-msg-head">
                <b>{m.author_name || m.author_username}</b>
                {staff && <span className="tk-role">staff</span>}
                <span className="tk-time">{fmt(m.created_at)}</span>
              </div>
              <div className="tk-body">{m.body}</div>
            </div>
          );
        })}
      </div>

      {closed ? (
        <div className="sub" style={{ color: 'var(--muted)', fontSize: 13, marginTop: 12 }}>
          This ticket is closed.{isAdmin ? ' Reopen it above to continue the conversation.' : ''}
        </div>
      ) : (
        <div className="ticket-reply">
          <textarea rows={3} value={reply} placeholder="Write a reply…"
            onChange={(e) => setReply(e.target.value)} />
          {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn" onClick={send} disabled={busy}>
              {busy ? 'Sending…' : 'Send reply'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
