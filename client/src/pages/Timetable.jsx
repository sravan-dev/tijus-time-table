import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import AllocationModal from '../components/AllocationModal';
import SlotModal from '../components/SlotModal';
import ReassignModal from '../components/ReassignModal';
import BatchModal from '../components/BatchModal';

export default function Timetable() {
  const { canEdit } = useAuth();
  const toast = useToast();
  // Keep the active program tab in the URL (?program=) so a refresh preserves it.
  const [searchParams, setSearchParams] = useSearchParams();
  const [programs, setPrograms] = useState([]);
  const [programId, setProgramId] = useState(null);
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState('');
  const [data, setData] = useState({ allocations: [], conflicts: {} });
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // {batchId, slotId} or allocation
  const [editingSlot, setEditingSlot] = useState(null); // time slot being re-timed
  const [menu, setMenu] = useState(null); // right-click menu { x, y, allocation } or { x, y, batch }
  const [reassigning, setReassigning] = useState(null); // allocation being reassigned
  const [addingFaculty, setAddingFaculty] = useState(null); // allocation getting a co-teacher
  const [editingBatch, setEditingBatch] = useState(null); // batch id being edited (right-click)
  const [facultyId, setFacultyId] = useState(''); // optional faculty filter
  const [generating, setGenerating] = useState(false);
  const [clearing, setClearing] = useState(false);
  const dragRef = useRef(null);           // allocation being dragged
  const [dragOver, setDragOver] = useState(null); // cellKey of the current drop target
  const [moving, setMoving] = useState(false);
  // A drop awaiting confirmation: { src, batch:{id,name}, slot:{id,label}, target }.
  // The move is only applied once the admin clicks Apply in the modal.
  const [pendingMove, setPendingMove] = useState(null);
  // Undo/redo history for drag moves. Each entry is a list of position changes:
  // { id, from:{batch_id,time_slot_id}, to:{batch_id,time_slot_id} }.
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  // initial reference load
  useEffect(() => {
    (async () => {
      const [{ data: progs }, { data: ds }] = await Promise.all([
        api.get('/programs'),
        api.get('/allocations/dates'),
      ]);
      setPrograms(progs);
      const wanted = searchParams.get('program');
      const match = progs.find((p) => p.code === wanted);
      setProgramId((match || progs[0])?.id);
      const isoDates = ds.map((d) => d.slice(0, 10));
      setDates(isoDates);
      setDate(isoDates[0] || '');
    })();
  }, []);

  // slots for the chosen program
  function reloadSlots() {
    if (!programId) return;
    api.get(`/slots?program_id=${programId}`).then(({ data }) => setSlots(data));
  }
  useEffect(() => { reloadSlots(); }, [programId]);

  // Guard against out-of-order responses: only the most recent request may
  // apply its result, so switching program tabs quickly (or leaving and
  // returning) can't leave a previous program's sessions on screen.
  const reqRef = useRef(0);
  async function reload() {
    if (!date || !programId) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    const { data } = await api.get(`/allocations?date=${date}&program_id=${programId}`);
    if (reqId !== reqRef.current) return; // a newer request superseded this one
    setData(data);
    setLoading(false);
  }
  // Clear the grid immediately on program/date change so stale rows never linger.
  useEffect(() => { setData({ allocations: [], conflicts: {} }); reload(); }, [date, programId]);

  // build batch rows × slot columns matrix. Only rows for the selected program
  // and the current slot grid are kept, so another program's sessions (e.g.
  // German's batch-less, per-tutor rows) can never render as blank "—" rows.
  const slotIds = useMemo(() => new Set(slots.map((s) => s.id)), [slots]);
  const { batches } = useMemo(() => {
    const byBatch = new Map();
    for (const a of data.allocations) {
      if (programId && a.program_id !== programId) continue;      // other program leaked in
      if (slotIds.size && !slotIds.has(a.time_slot_id)) continue; // slot not in this grid
      const key = a.batch_id ?? `nb-${a.id}`;
      if (!byBatch.has(key))
        byBatch.set(key, { id: a.batch_id, name: a.batch_name || '—', count: a.student_count, cells: {}, extra: {} });
      // One session leads each cell. An approved session always wins over a
      // tutor's pending request for the same slot — the live grid stays truthful,
      // and the request is still visible (and decidable) under Approvals. Any
      // further sessions in the same cell (e.g. an additional faculty on the
      // same class) land in `extra` and render as "+ name" lines underneath.
      const row = byBatch.get(key);
      const prev = row.cells[a.time_slot_id];
      if (!prev) row.cells[a.time_slot_id] = a;
      else if (prev.status === 'pending' && a.status !== 'pending') {
        row.cells[a.time_slot_id] = a;
        (row.extra[a.time_slot_id] ??= []).push(prev);
      } else {
        (row.extra[a.time_slot_id] ??= []).push(a);
      }
    }
    return { batches: [...byBatch.values()] };
  }, [data, programId, slotIds]);

  // faculty present in the current day/program, for the filter dropdown
  const facultyOptions = useMemo(() => {
    const m = new Map();
    for (const a of data.allocations) if (a.faculty_id) m.set(a.faculty_id, a.faculty_name);
    return [...m.entries()]
      .map(([id, name]) => ({ id, name: name || `#${id}` }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }, [data]);

  // drop a stale selection when the chosen faculty isn't in the new view
  useEffect(() => {
    if (facultyId && !facultyOptions.some((f) => f.id === Number(facultyId))) setFacultyId('');
  }, [facultyOptions, facultyId]);

  // Drag history is only meaningful for the grid currently on screen, so drop
  // it whenever the program or date changes.
  useEffect(() => { setUndoStack([]); setRedoStack([]); }, [date, programId]);

  // Keyboard shortcuts: Ctrl/Cmd+Z to undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z to
  // redo the last drag move. Ignored while typing in a field or dialog.
  useEffect(() => {
    if (!canEdit) return;
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
        || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoMove(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redoMove(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // when a faculty is selected, keep only their allocated cells (and the rows
  // that still have any), so the grid shows that faculty's slots at a glance
  const visibleBatches = useMemo(() => {
    if (!facultyId) return batches;
    const fid = Number(facultyId);
    return batches
      .map((b) => {
        const cells = {};
        const extra = {};
        for (const [sid, a] of Object.entries(b.cells)) {
          // keep the cell when the lead session or any extra matches; promote
          // a matching extra to lead when the lead itself is filtered out
          const xs = (b.extra[sid] || []).filter((x) => x.faculty_id === fid);
          if (a.faculty_id === fid) {
            cells[sid] = a;
            if (xs.length) extra[sid] = xs;
          } else if (xs.length) {
            cells[sid] = xs[0];
            if (xs.length > 1) extra[sid] = xs.slice(1);
          }
        }
        return { ...b, cells, extra };
      })
      .filter((b) => Object.keys(b.cells).length);
  }, [batches, facultyId]);

  const confCount = Object.keys(data.conflicts).length;

  // Fill an empty day for the current program by copying the most recent
  // matching day (same weekday when available) via /allocations/generate.
  async function generateDay() {
    const prog = programs.find((p) => p.id === programId);
    if (!confirm(`Generate the ${prog?.code || ''} timetable for ${fmt(date)} ` +
      'by copying the most recent matching day? You can edit the sessions afterwards.')) return;
    setGenerating(true);
    try {
      const { data: g } = await api.post('/allocations/generate', {
        date, program_id: programId,
      });
      const { data: ds } = await api.get('/allocations/dates');
      setDates(ds.map((d) => d.slice(0, 10)));
      await reload();
      toast(`Created ${g.created} sessions (copied from ${fmt(g.source_date)})`);
    } catch (e) {
      toast(e.response?.data?.error || 'Could not generate the timetable', 'error');
    } finally {
      setGenerating(false);
    }
  }

  // Delete every session of the current program on the selected day.
  async function clearDay() {
    const prog = programs.find((p) => p.id === programId);
    if (!confirm(`Delete all ${data.allocations.length} ${prog?.code || ''} session(s) on ` +
      `${fmt(date)}? This cannot be undone.`)) return;
    setClearing(true);
    try {
      const { data: r } = await api.delete(`/allocations?date=${date}&program_id=${programId}`);
      const { data: ds } = await api.get('/allocations/dates');
      setDates(ds.map((d) => d.slice(0, 10)));
      await reload();
      toast(`Deleted ${r.deleted} session(s)`);
    } catch (e) {
      toast(e.response?.data?.error || 'Could not clear the table', 'error');
    } finally {
      setClearing(false);
    }
  }

  // Delete a single session (the right-clicked cell).
  async function clearSession(a) {
    if (!confirm('Clear this session?')) return;
    try {
      await api.delete(`/allocations/${a.id}`);
      await reload();
      toast('Session cleared');
    } catch (e) {
      toast(e.response?.data?.error || 'Could not clear the session', 'error');
    }
  }

  // Apply a list of position changes ({ id, batch_id, time_slot_id }) in order.
  async function applyPositions(changes) {
    for (const c of changes) {
      await api.put(`/allocations/${c.id}`, {
        batch_id: c.batch_id, time_slot_id: c.time_slot_id,
      });
    }
  }

  // Drag a session onto another cell: move it into an empty cell, or swap the
  // two when the target already holds a session. `target` is the allocation
  // currently in the drop cell (undefined when the cell is empty).
  async function moveSession(src, targetBatchId, targetSlotId, target) {
    if (!src || moving) return;
    if (target && target.id === src.id) return;                       // dropped on itself
    if (src.batch_id === targetBatchId && src.time_slot_id === targetSlotId) return; // same cell
    const ops = [{
      id: src.id,
      from: { batch_id: src.batch_id, time_slot_id: src.time_slot_id },
      to: { batch_id: targetBatchId, time_slot_id: targetSlotId },
    }];
    if (target) {
      ops.push({
        id: target.id,
        from: { batch_id: target.batch_id, time_slot_id: target.time_slot_id },
        to: { batch_id: src.batch_id, time_slot_id: src.time_slot_id },
      });
    }
    setMoving(true);
    try {
      await applyPositions(ops.map((o) => ({ id: o.id, ...o.to })));
      await reload();
      setUndoStack((s) => [...s, ops]);
      setRedoStack([]);                          // a fresh move invalidates redo
      toast(target ? 'Sessions swapped' : 'Session moved');
    } catch (e) {
      toast(e.response?.data?.error || 'Could not move the session', 'error');
      await reload();
    } finally {
      setMoving(false);
    }
  }

  // Undo the most recent drag move (restore the "from" positions).
  async function undoMove() {
    if (moving || !undoStack.length) return;
    const ops = undoStack[undoStack.length - 1];
    setMoving(true);
    try {
      await applyPositions(ops.map((o) => ({ id: o.id, ...o.from })));
      await reload();
      setUndoStack((s) => s.slice(0, -1));
      setRedoStack((s) => [...s, ops]);
      toast('Move undone');
    } catch (e) {
      toast(e.response?.data?.error || 'Could not undo', 'error');
      await reload();
    } finally {
      setMoving(false);
    }
  }

  // Redo the last undone drag move (re-apply the "to" positions).
  async function redoMove() {
    if (moving || !redoStack.length) return;
    const ops = redoStack[redoStack.length - 1];
    setMoving(true);
    try {
      await applyPositions(ops.map((o) => ({ id: o.id, ...o.to })));
      await reload();
      setRedoStack((s) => s.slice(0, -1));
      setUndoStack((s) => [...s, ops]);
      toast('Move redone');
    } catch (e) {
      toast(e.response?.data?.error || 'Could not redo', 'error');
      await reload();
    } finally {
      setMoving(false);
    }
  }

  function selectProgram(p) {
    setProgramId(p.id);
    setSearchParams({ program: p.code }, { replace: true });
  }

  return (
    <div className="page">
      <div className="row controls" style={{ marginBottom: 12 }}>
        <div className="tabs">
          {programs.map((p) => (
            <div key={p.id}
              className={'tab' + (p.id === programId ? ' active' : '')}
              onClick={() => selectProgram(p)}>
              {p.code}
            </div>
          ))}
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <label>Faculty&nbsp;
          <select value={facultyId} onChange={(e) => setFacultyId(e.target.value)}>
            <option value="">All faculty</option>
            {facultyOptions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label>Date&nbsp;
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.map((d) => <option key={d} value={d}>{fmt(d)}</option>)}
          </select>
        </label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn ghost" onClick={() => window.print()}>Print</button>
        {canEdit && <EmailSchedules date={date} />}
        {canEdit && (undoStack.length > 0 || redoStack.length > 0) && (
          <>
            <button className="btn ghost" onClick={undoMove}
              disabled={moving || !undoStack.length}
              title="Undo the last drag move (Ctrl+Z)">↶ Undo</button>
            <button className="btn ghost" onClick={redoMove}
              disabled={moving || !redoStack.length}
              title="Redo the last undone move (Ctrl+Y)">↷ Redo</button>
          </>
        )}
        {canEdit && data.allocations.length > 0 && (
          <button className="btn danger" onClick={clearDay} disabled={clearing}
            title="Delete all sessions of this program on this day">
            {clearing ? 'Clearing…' : '🗑 Clear table'}
          </button>
        )}
        {canEdit && (
          <button className="btn" onClick={() => setEditing({ programId, date })}>+ Add session</button>
        )}
      </div>

      {confCount > 0 && (
        <div className="card no-print" style={{ marginBottom: 12, borderColor: 'var(--error)' }}>
          <b>{confCount} session(s) with conflicts</b>
          <ConflictSummary conflicts={data.conflicts} />
        </div>
      )}

      <div className="grid-wrap">
        <table className="tt">
          <thead>
            <tr>
              <th className="batch">Batch</th>
              {slots.map((s) => (
                <th key={s.id}
                  className={canEdit ? 'slot-edit' : undefined}
                  title={canEdit ? 'Click to edit this timing' : undefined}
                  onClick={() => canEdit && setEditingSlot(s)}>
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleBatches.map((b) => (
              <tr key={b.id ?? b.name}>
                <td className="batch"
                  title={canEdit && b.id ? 'Right-click to edit this batch' : undefined}
                  onContextMenu={(e) => {
                    if (!canEdit || !b.id) return; // batch-less rows have nothing to edit
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, batch: b });
                  }}>
                  {b.name}{b.count ? <span className="room"> ({b.count})</span> : null}
                </td>
                {slots.map((s) => {
                  const a = b.cells[s.id];
                  const extras = b.extra?.[s.id] || [];
                  const conf = a ? data.conflicts[a.id] : null;
                  const level = conf?.some((c) => c.level === 'error') ? 'error'
                    : conf?.length ? 'warn' : null;
                  const cellKey = (b.id ?? b.name) + ':' + s.id;
                  return (
                    <td key={s.id}>
                      <div
                        className={'cell' + (level ? ' conf-' + level : '')
                          + (dragOver === cellKey ? ' drag-over' : '')
                          + (a?.status === 'pending' ? ' pending' : '')}
                        title={a?.status === 'pending'
                          ? 'Requested by the tutor — awaiting approval'
                          : (conf ? conf.map((c) => c.message).join('\n') : '')}
                        draggable={Boolean(canEdit && a)}
                        onDragStart={(e) => {
                          if (!canEdit || !a) return;
                          dragRef.current = a;
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => { dragRef.current = null; setDragOver(null); }}
                        onDragOver={(e) => {
                          if (!canEdit || !dragRef.current) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          if (dragOver !== cellKey) setDragOver(cellKey);
                        }}
                        onDragLeave={() => setDragOver((k) => (k === cellKey ? null : k))}
                        onDrop={(e) => {
                          if (!canEdit) return;
                          e.preventDefault();
                          const src = dragRef.current;
                          dragRef.current = null;
                          setDragOver(null);
                          // Ignore a no-op drop (onto itself or its own cell);
                          // otherwise stage it for confirmation in the modal.
                          if (!src || (a && a.id === src.id)) return;
                          if (src.batch_id === b.id && src.time_slot_id === s.id) return;
                          setPendingMove({
                            src,
                            batch: { id: b.id, name: b.name },
                            slot: { id: s.id, label: s.label },
                            target: a || null,
                          });
                        }}
                        onClick={() => canEdit && !moving && setEditing(
                          a || { programId, date, batch_id: b.id, time_slot_id: s.id }
                        )}
                        onContextMenu={(e) => {
                          if (!canEdit || !a) return; // only admins, only real sessions
                          e.preventDefault();
                          setMenu({ x: e.clientX, y: e.clientY, allocation: a });
                        }}>
                        {a ? (
                          <>
                            <div className="act">
                              {a.activity_code || ''}{' '}
                              {level && <span className={'badge ' + level}>!</span>}
                              {a.status === 'pending' && (
                                <span className="badge pending" title="Awaiting admin approval">⏳</span>
                              )}
                            </div>
                            {a.faculty_name && <div className="fac">{a.faculty_name}</div>}
                            {a.room_code && <div className="room">{a.room_code}</div>}
                            {!a.activity_code && !a.faculty_name && (
                              <div className="room">{a.raw_text}</div>
                            )}
                            {extras.map((x) => {
                              const xc = data.conflicts[x.id];
                              const xl = xc?.some((c) => c.level === 'error') ? 'error'
                                : xc?.length ? 'warn' : null;
                              return (
                                <div key={x.id} className="fac extra"
                                  title={xc ? xc.map((c) => c.message).join('\n')
                                    : (canEdit ? 'Additional faculty — click to edit' : undefined)}
                                  onClick={(e) => {
                                    if (!canEdit || moving) return;
                                    e.stopPropagation();
                                    setEditing(x);
                                  }}
                                  onContextMenu={(e) => {
                                    if (!canEdit) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setMenu({ x: e.clientX, y: e.clientY, allocation: x });
                                  }}>
                                  + {x.faculty_name || x.activity_code || x.raw_text || 'session'}
                                  {xl && <span className={'badge ' + xl}>!</span>}
                                  {x.status === 'pending' && (
                                    <span className="badge pending" title="Awaiting admin approval">⏳</span>
                                  )}
                                </div>
                              );
                            })}
                          </>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {!visibleBatches.length && !loading && (
              <tr><td className="batch">—</td><td colSpan={slots.length}>
                {facultyId ? 'No sessions for this faculty on this day.' : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                    No sessions for this day.
                    {canEdit && (
                      <button className="btn" onClick={generateDay} disabled={generating}
                        title="Copy the timetable from the most recent matching day">
                        {generating ? 'Generating…' : '⚡ Generate'}
                      </button>
                    )}
                  </span>
                )}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <AllocationModal
          initial={editing}
          programId={programId}
          date={date}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}

      {editingSlot && (
        <SlotModal
          slot={editingSlot}
          onClose={() => setEditingSlot(null)}
          onSaved={() => { setEditingSlot(null); reloadSlots(); reload(); }}
        />
      )}

      {menu && (
        <div className="ctx-backdrop"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="ctx-menu" style={{ top: menu.y, left: menu.x }} onClick={(e) => e.stopPropagation()}>
            {menu.batch ? (
              <>
                <button className="ctx-item"
                  onClick={() => { setEditingBatch(menu.batch.id); setMenu(null); }}>
                  Edit batch…
                </button>
                <button className="ctx-item"
                  onClick={() => { setEditingBatch('new'); setMenu(null); }}>
                  Add row (new batch)…
                </button>
              </>
            ) : (
              <>
                <button className="ctx-item"
                  onClick={() => { setReassigning(menu.allocation); setMenu(null); }}>
                  Reassign faculty…
                </button>
                <button className="ctx-item"
                  onClick={() => { setAddingFaculty(menu.allocation); setMenu(null); }}>
                  Add additional faculty…
                </button>
                <button className="ctx-item"
                  onClick={() => {
                    const a = menu.allocation;
                    setEditing({ programId, date, batch_id: a.batch_id, time_slot_id: a.time_slot_id });
                    setMenu(null);
                  }}>
                  Add additional session…
                </button>
                <button className="ctx-item danger"
                  onClick={() => { const a = menu.allocation; setMenu(null); clearSession(a); }}>
                  Clear session
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {reassigning && (
        <ReassignModal
          allocation={reassigning}
          programId={programId}
          dayAllocations={data.allocations}
          onClose={() => setReassigning(null)}
          onSaved={() => { setReassigning(null); reload(); }}
        />
      )}

      {addingFaculty && (
        <ReassignModal
          mode="add"
          allocation={addingFaculty}
          programId={programId}
          date={date}
          dayAllocations={data.allocations}
          onClose={() => setAddingFaculty(null)}
          onSaved={() => { setAddingFaculty(null); reload(); }}
        />
      )}

      {editingBatch && (
        <BatchModal
          batchId={editingBatch === 'new' ? null : editingBatch}
          programId={programId}
          onClose={() => setEditingBatch(null)}
          onSaved={(newId) => {
            setEditingBatch(null);
            reload();
            // A brand-new batch has no sessions yet, so the grid has no row to
            // show — chain straight into "Add session" for it to create one.
            if (newId) setEditing({ programId, date, batch_id: newId });
          }}
        />
      )}

      {pendingMove && (
        <div className="modal-bg" onClick={() => setPendingMove(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{pendingMove.target ? 'Swap sessions?' : 'Move session?'}</h3>
            {pendingMove.target ? (
              <p style={{ margin: '4px 0 14px' }}>
                Swap <b>{describeSession(pendingMove.src)}</b> with{' '}
                <b>{describeSession(pendingMove.target)}</b>. The two sessions
                change places.
              </p>
            ) : (
              <p style={{ margin: '4px 0 14px' }}>
                Move <b>{describeSession(pendingMove.src)}</b> to{' '}
                <b>{pendingMove.batch.name} · {pendingMove.slot.label}</b>.
              </p>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn ghost" onClick={() => setPendingMove(null)}>Cancel</button>
              <button className="btn" onClick={() => {
                const pm = pendingMove;
                setPendingMove(null);
                moveSession(pm.src, pm.batch.id, pm.slot.id, pm.target);
              }}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// A short human label for a session cell: activity / faculty / room, falling
// back to the raw imported text.
function describeSession(a) {
  if (!a) return 'this session';
  return [a.activity_code, a.faculty_name, a.room_code].filter(Boolean).join(' · ')
    || a.raw_text || 'this session';
}

function EmailSchedules({ date }) {
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!confirm(`Email each faculty (with an address) their schedule for ${date}?`)) return;
    setBusy(true);
    try {
      const { data } = await api.post('/allocations/notify', { date });
      let msg = `Sent ${data.sent} of ${data.total} faculty emails.`;
      if (data.failures?.length) msg += `\nFailures: ${data.failures.map((f) => f.faculty).join(', ')}`;
      alert(msg);
    } catch (e) {
      alert(e.response?.data?.error || 'Could not send emails');
    } finally { setBusy(false); }
  }
  return (
    <button className="btn ghost" onClick={send} disabled={busy} title="Email faculty their schedule for this date">
      {busy ? 'Sending…' : '✉ Email schedules'}
    </button>
  );
}

function ConflictSummary({ conflicts }) {
  const items = Object.values(conflicts).flat();
  const seen = new Set();
  const unique = items.filter((c) => {
    if (seen.has(c.message)) return false;
    seen.add(c.message);
    return true;
  });
  return (
    <ul className="conf-list">
      {unique.map((c, i) => (
        <li key={i}><span className={'dot ' + c.level} />{c.message}</li>
      ))}
    </ul>
  );
}

function fmt(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
