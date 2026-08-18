import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import ColourPicker from './ColourPicker';

// The activity types this modal offers up front. Their colours match the seeds
// in server/db/migrate-activity-colors.js, and the server reuses an existing
// type with the same code, so picking one never creates a duplicate.
const PRESETS = [
  { name: 'OET Grammar', text: '#5b21b6', bg: '#ede9fe' },
  { name: 'Grammar', text: '#075985', bg: '#e0f2fe' },
  { name: 'Assessment', text: '#991b1b', bg: '#fee2e2' },
  { name: 'Movie', text: '#92400e', bg: '#fef3c7' },
  { name: 'Skill Development', text: '#166534', bg: '#dcfce7' },
  { name: 'Activity', text: '#9d174d', bg: '#fce7f3' },
  { name: 'Mentors Meeting', text: '#334155', bg: '#e2e8f0' },
];

const norm = (s) => String(s || '').trim().toLowerCase();
const codeOf = (s) => String(s || '').trim().toUpperCase().slice(0, 20);

// Add a highlighted activity (Movie, Assessment, Mentors Meeting, …) to one
// cell of the grid. `target` is { batch_id, batch_name, time_slot_id,
// slot_label, occupied } for a new entry, or an existing allocation when an
// activity cell is being edited.
export default function ActivityModal({ target, programId, date, onClose, onSaved }) {
  const isEdit = Boolean(target?.id);
  const [activities, setActivities] = useState([]);
  // The code, not the name: it is what the cell prints and what the server
  // matches on, so re-saving an existing session round-trips to the same
  // activity instead of coining a new type from its long name.
  const [name, setName] = useState(
    isEdit ? (target.activity_code || target.activity_name || '') : ''
  );
  const [text, setText] = useState(
    isEdit ? (target.text_color || target.activity_text_color || '#334155') : '#334155'
  );
  const [bg, setBg] = useState(
    isEdit ? (target.bg_color || target.activity_bg_color || '#e2e8f0') : '#e2e8f0'
  );
  // Once the colours are picked by hand, naming a known activity no longer
  // overwrites them.
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/activities').then(({ data }) => setActivities(data)).catch(() => {});
  }, []);

  // The activity this name already refers to, if any.
  const known = useMemo(
    () => activities.find((a) => norm(a.name) === norm(name) || norm(a.code) === norm(name)),
    [activities, name]
  );

  // Adopt a known activity's saved colours as its name is typed or picked.
  useEffect(() => {
    if (touched || !known) return;
    if (known.text_color) setText(known.text_color);
    if (known.bg_color) setBg(known.bg_color);
  }, [known, touched]);

  function pickPreset(p) {
    setName(p.name);
    // A type that already exists keeps whatever colours it was last given.
    const saved = activities.find(
      (a) => norm(a.name) === norm(p.name) || norm(a.code) === norm(p.name)
    );
    setText(saved?.text_color || p.text);
    setBg(saved?.bg_color || p.bg);
    setTouched(false);
  }

  async function save() {
    if (!name.trim()) { setErr('Pick or type an activity name'); return; }
    setBusy(true); setErr('');
    try {
      // Get-or-create the type, then pin the chosen colours onto this cell —
      // recolouring the type later must not repaint days already published.
      const { data: act } = await api.post('/activities', {
        name: name.trim(), text_color: text, bg_color: bg,
      });
      const payload = { activity_id: act.id, text_color: text, bg_color: bg };
      if (isEdit) {
        await api.put(`/allocations/${target.id}`, payload);
      } else {
        await api.post('/allocations', {
          ...payload,
          alloc_date: date,
          program_id: programId,
          batch_id: target.batch_id || null,
          time_slot_id: target.time_slot_id,
        });
      }
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not save the activity');
      setBusy(false);
    }
  }

  // Take the activity back out of the cell entirely (the row is a session like
  // any other, so this is the same delete as "Clear session").
  async function remove() {
    if (!confirm('Remove this activity from the timetable?')) return;
    setBusy(true); setErr('');
    try {
      await api.delete(`/allocations/${target.id}`);
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not remove the activity');
      setBusy(false);
    }
  }

  const where = [target?.batch_name, target?.slot_label].filter(Boolean).join(' · ');
  const preview = known?.code || codeOf(name) || 'ACTIVITY';

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? 'Edit activity' : 'Add activity'}</h3>
        {where && (
          <div className="sub" style={{ marginBottom: 10 }}>
            {isEdit ? 'This session' : (target?.occupied ? 'Added to' : 'Placed in')}
            {' '}<b>{where}</b>
          </div>
        )}

        <div className="field">
          <label>Activity</label>
          <div className="chip-row">
            {PRESETS.map((p) => (
              <button key={p.name} type="button"
                className={'chip' + (norm(p.name) === norm(name) ? ' on' : '')}
                style={{ color: p.text, background: p.bg, borderColor: p.text }}
                onClick={() => pickPreset(p)}>
                {p.name}
              </button>
            ))}
          </div>
          <input type="text" list="activity-names" value={name}
            placeholder="…or type another activity"
            onChange={(e) => setName(e.target.value)} />
          <datalist id="activity-names">
            {activities.map((a) => <option key={a.id} value={a.name || a.code} />)}
          </datalist>
          <div className="sub" style={{ fontSize: 12 }}>
            {known
              ? `Uses the existing "${known.code}" type — that is what the cell prints.`
              : (name.trim()
                ? `New type "${codeOf(name)}" — that is what the cell prints.`
                : ' ')}
          </div>
        </div>

        <div className="field">
          <label>Highlight</label>
          <ColourPicker text={text} bg={bg}
            onChange={({ text: t, bg: b }) => { setText(t); setBg(b); setTouched(true); }} />
        </div>

        <div className="field">
          <label>Preview</label>
          <div className="act-preview" style={{ color: text, background: bg }}>{preview}</div>
        </div>

        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          {isEdit && (
            <button className="btn danger" onClick={remove} disabled={busy}>Remove activity</button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : (isEdit ? 'Save' : 'Add activity')}
          </button>
        </div>
      </div>
    </div>
  );
}
