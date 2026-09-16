import { useEffect, useState } from 'react';
import api from '../api/client';

// Pick the Knowledge Base sheet an empty day is built from. Generate normally
// chooses a sheet itself (weekday first) and falls back to copying an earlier
// day; when there is no earlier day to copy from, the Timetable opens this so
// the admin can say which sheet the day should come from instead.
export default function GenerateModal({ date, programId, programCode,
  sheets: initial = null, onClose, onGenerated }) {
  const [sheets, setSheets] = useState(initial);
  const [sheetId, setSheetId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Only load when the caller hasn't already been handed the list (the failed
  // Generate returns it with the error, so the picker opens filled in).
  useEffect(() => {
    if (initial) return;
    api.get(`/allocations/sheets?date=${date}&program_id=${programId}`)
      .then(({ data }) => setSheets(data.sheets))
      .catch((e) => {
        setSheets([]);
        setErr(e.response?.data?.error || 'Could not load the Knowledge Base sheets');
      });
  }, [initial, date, programId]);

  // Preselect the first sheet that actually has sessions for this program —
  // the one Generate would have used.
  useEffect(() => {
    if (sheetId != null || !sheets?.length) return;
    const usable = sheets.find((s) => s.sessions > 0) || sheets.find((s) => !s.error);
    if (usable) setSheetId(usable.id);
  }, [sheets, sheetId]);

  async function generate() {
    setBusy(true); setErr('');
    try {
      const { data } = await api.post('/allocations/generate', {
        date, program_id: programId, sheet_id: sheetId,
      });
      onGenerated(data);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not generate the timetable');
      setBusy(false);
    }
  }

  const picked = sheets?.find((s) => s.id === sheetId) || null;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Generate from the Knowledge Base</h3>
        <div className="sub" style={{ marginBottom: 10 }}>
          There is no earlier {programCode || ''} day to copy from. Pick the
          sheet this day should be built from.
        </div>

        {sheets === null && <div className="sub">Loading sheets…</div>}
        {sheets?.length === 0 && (
          <div className="sub">
            The Knowledge Base has no usable sheet yet. Upload one under
            Knowledge Base, then generate again.
          </div>
        )}

        {!!sheets?.length && (
          <div className="field">
            <label>Sheet</label>
            <div className="kb-pick">
              {sheets.map((s) => (
                <label key={s.id} className="kb-pick-row"
                  title={s.error || s.filename}>
                  <input type="radio" name="kb-sheet" value={s.id}
                    checked={sheetId === s.id}
                    disabled={!!s.error || s.sessions === 0}
                    onChange={() => setSheetId(s.id)} />
                  <span className="kb-pick-main">
                    <b>{s.title}</b>
                    <span className="sub">
                      {s.weekday_name || 'any day'}
                      {' · '}
                      {s.error
                        ? `unreadable — ${s.error}`
                        : `${s.sessions} session${s.sessions === 1 ? '' : 's'} for ${programCode || 'this program'}`}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={generate} disabled={busy || !picked}>
            {busy ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}
