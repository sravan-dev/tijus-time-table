import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import AllocationModal from '../components/AllocationModal';
import SlotModal from '../components/SlotModal';
import ReassignModal from '../components/ReassignModal';
import NoteModal from '../components/NoteModal';

// Inline colours for a session note, if the note was given its own.
function noteStyle(a) {
  if (!a.note_text_color && !a.note_bg_color) return undefined;
  return { color: a.note_text_color || undefined, background: a.note_bg_color || undefined };
}
import BatchModal from '../components/BatchModal';
import ActivityModal from '../components/ActivityModal';
import SplitCellModal from '../components/SplitCellModal';

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
  const [noting, setNoting] = useState(null); // allocation whose note is being edited
  const [addingFaculty, setAddingFaculty] = useState(null); // allocation getting a co-teacher
  // Highlighted activity being added to a cell (or an existing one being
  // recoloured): a cell stub { batch_id, time_slot_id, … } or an allocation.
  const [activityCell, setActivityCell] = useState(null);
  // Cell being split into another area (the hover "+" divider, or the menu).
  const [splitting, setSplitting] = useState(null);
  // Right-click batch edit/create: { batchId } to edit, { placement } to insert
  // a new row above/below an existing one, {} to append at the end.
  const [editingBatch, setEditingBatch] = useState(null);
  // Column copied with "Copy column": { date, slot:{id,label}, programId, count }.
  // Kept across date changes so a column can be pasted onto another day.
  const [columnClip, setColumnClip] = useState(null);
  // Single cell copied with "Copy cell": { date, slot:{id,label}, batch:{id,name}, programId }.
  const [cellClip, setCellClip] = useState(null);
  // Excel-style fill handle drag: { from:{row,col}, to:{row,col} } as indexes
  // into the rows / slot columns on screen. Set only while dragging.
  const [fill, setFill] = useState(null);
  const fillRef = useRef(null);
  // Every program's grid for the day, loaded for "Print all":
  // [{ program, slots, rows }]. Set only while the print dialog is up.
  const [printData, setPrintData] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [facultyId, setFacultyId] = useState(''); // optional faculty filter
  const [generating, setGenerating] = useState(false);
  const [clearing, setClearing] = useState(false);
  const dragRef = useRef(null);           // allocation being dragged
  const [dragOver, setDragOver] = useState(null); // cellKey of the current drop target
  const rowDragRef = useRef(null);        // batch id of the row being dragged
  // Row drop indicator: { id, pos: 'above'|'below' } for the hovered row.
  const [rowDragOver, setRowDragOver] = useState(null);
  const [moving, setMoving] = useState(false);
  // A drop awaiting confirmation: { src, batch:{id,name}, slot:{id,label}, target }.
  // The move is only applied once the admin clicks Apply in the modal.
  const [pendingMove, setPendingMove] = useState(null);
  // Undo/redo history (Ctrl+Z / Ctrl+Y). Typed entries:
  //  { type:'cells', ops:[{ id, from:{batch_id,time_slot_id}, to:{...} }] } — session drag/swap
  //  { type:'order', program_id, from:[batch ids], to:[batch ids] }        — row reorder
  //  { type:'batch-delete', batch, allocations }                           — batch delete
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
      setDate(todayIso());   // open on today's timetable, even if it's still empty
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
  const batches = useMemo(
    () => buildRows(data.allocations, programId, slotIds),
    [data, programId, slotIds]
  );

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

  // Print every program's timetable for the day as one document (one program
  // per page), so a single "Save as PDF" covers the whole academy.
  async function printAll() {
    setPrinting(true);
    try {
      const sets = await Promise.all(programs.map(async (p) => {
        const [{ data: ps }, { data: day }] = await Promise.all([
          api.get(`/slots?program_id=${p.id}`),
          api.get(`/allocations?date=${date}&program_id=${p.id}`),
        ]);
        // pending requests never go on paper
        const approved = day.allocations.filter((a) => a.status !== 'pending');
        return { program: p, slots: ps, rows: buildRows(approved, p.id, new Set(ps.map((s) => s.id))) };
      }));
      const withSessions = sets.filter((s) => s.rows.length);
      if (!withSessions.length) toast('No sessions to print on this day', 'error');
      else setPrintData(withSessions);
    } catch (e) {
      toast(e.response?.data?.error || 'Could not load the timetables to print', 'error');
    } finally {
      setPrinting(false);
    }
  }

  // Open the print dialog once the combined timetables have rendered, and
  // drop them again when it closes.
  useEffect(() => {
    if (!printData) return;
    const done = () => setPrintData(null);
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printData]);

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
    const activity = isHighlighted(a);   // added via "Add activity…", not a class
    if (!confirm(activity ? 'Remove this activity?' : 'Clear this session?')) return;
    try {
      await api.delete(`/allocations/${a.id}`);
      await reload();
      toast(activity ? 'Activity removed' : 'Session cleared');
    } catch (e) {
      toast(e.response?.data?.error || 'Could not clear the session', 'error');
    }
  }

  // Approved sessions of this program in a time-slot column on screen.
  function columnSessions(slotId) {
    return data.allocations.filter((a) =>
      a.program_id === programId && a.time_slot_id === slotId && a.status !== 'rejected');
  }

  // Whether the column menu would offer anything: a copy, or a paste target.
  function hasColumnAction(slotId) {
    const n = columnSessions(slotId).length;
    return n > 0 || Boolean(columnClip && columnClip.programId === programId);
  }

  // Remember a whole column (every batch's session in one time slot).
  function copyColumn(slot) {
    const count = columnSessions(slot.id).filter((a) => a.status === 'approved').length;
    if (!count) { toast('That column has no sessions to copy', 'error'); return; }
    setColumnClip({ date, slot: { id: slot.id, label: slot.label }, programId, count });
    toast(`Copied ${count} session(s) from ${slot.label} — right-click an empty column to paste`);
  }

  // Paste the copied column into an empty one (this day or another).
  async function pasteColumn(slot) {
    const clip = columnClip;
    if (!clip || clip.programId !== programId) return;
    if (columnSessions(slot.id).length) {
      toast('That column already has sessions — paste into an empty column', 'error');
      return;
    }
    try {
      const { data: r } = await api.post('/allocations/copy-column', {
        program_id: programId,
        source_date: clip.date, source_slot_id: clip.slot.id,
        date, time_slot_id: slot.id,
      });
      await refreshDates();
      await reload();
      toast(`Pasted ${r.created} session(s) into ${slot.label}`);
    } catch (e) {
      toast(e.response?.data?.error || 'Could not paste the column', 'error');
    }
  }

  // Remember one cell (its session and anything added under it).
  function copyCell(cell) {
    setCellClip({
      date, programId,
      slot: { id: cell.time_slot_id, label: cell.slot_label },
      batch: { id: cell.batch_id, name: cell.batch_name },
    });
    toast(`Copied ${cell.batch_name} · ${cell.slot_label} — right-click an empty cell to paste`);
  }

  // Paste the copied cell into an empty cell (this day or another).
  async function pasteCell(cell) {
    const clip = cellClip;
    if (!clip || clip.programId !== programId) return;
    try {
      const { data: r } = await api.post('/allocations/copy-column', {
        program_id: programId,
        source_date: clip.date, source_slot_id: clip.slot.id, source_batch_id: clip.batch.id,
        date, time_slot_id: cell.time_slot_id, batch_id: cell.batch_id,
      });
      await refreshDates();
      await reload();
      toast(r.created ? `Pasted into ${cell.batch_name} · ${cell.slot_label}`
        : 'The copied cell is empty now — nothing pasted', r.created ? undefined : 'error');
    } catch (e) {
      toast(e.response?.data?.error || 'Could not paste the cell', 'error');
    }
  }

  // Cells a fill drag covers, excluding the source. Like Excel it runs along
  // one axis only: down/up a column or across a row, whichever is dragged further.
  function fillTargets(f) {
    if (!f) return [];
    const dr = f.to.row - f.from.row, dc = f.to.col - f.from.col;
    const out = [];
    if (Math.abs(dr) >= Math.abs(dc)) {
      const step = Math.sign(dr);
      for (let r = f.from.row + step; step && r !== f.to.row + step; r += step)
        out.push({ row: r, col: f.from.col });
    } else {
      const step = Math.sign(dc);
      for (let c = f.from.col + step; c !== f.to.col + step; c += step)
        out.push({ row: f.from.row, col: c });
    }
    return out;
  }
  const fillSet = useMemo(
    () => new Set(fillTargets(fill).map((t) => `${t.row}:${t.col}`)), [fill]);

  function startFill(e, row, col) {
    e.preventDefault();       // no text selection, no native drag of the cell
    e.stopPropagation();
    const f = { from: { row, col }, to: { row, col } };
    fillRef.current = f;
    setFill(f);
  }

  // Track the pointer over the grid while a fill drag is on; release applies it.
  useEffect(() => {
    if (!fill) return;
    function onMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-fill]');
      if (!el || !fillRef.current) return;
      const [row, col] = el.dataset.fill.split(':').map(Number);
      const cur = fillRef.current;
      if (cur.to.row === row && cur.to.col === col) return;
      fillRef.current = { ...cur, to: { row, col } };
      setFill(fillRef.current);
    }
    function onUp() {
      const f = fillRef.current;
      fillRef.current = null;
      setFill(null);
      runFill(f);
    }
    function onKey(e) {
      if (e.key === 'Escape') { fillRef.current = null; setFill(null); }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [Boolean(fill)]);

  // Copy the source cell into every empty cell `cells` names; occupied ones are
  // left alone. Returns the cells actually filled and how many were skipped.
  async function copyIntoCells(src, cells) {
    const filled = [];
    let skipped = 0;
    for (const c of cells) {
      if (batches.find((x) => x.id === c.batch_id)?.cells[c.time_slot_id]) { skipped++; continue; }
      try {
        const { data: r } = await api.post('/allocations/copy-column', {
          program_id: programId,
          source_date: date, source_slot_id: src.time_slot_id, source_batch_id: src.batch_id,
          date, time_slot_id: c.time_slot_id, batch_id: c.batch_id,
        });
        if (r.created) filled.push(c);
      } catch (e) {
        if (e.response?.status === 409) skipped++;   // filled meanwhile / hidden by the faculty filter
        else throw e;
      }
    }
    return { filled, skipped };
  }

  async function runFill(f) {
    const src = f && visibleBatches[f.from.row];
    const srcSlot = f && slots[f.from.col];
    if (!src?.id || !srcSlot || moving) return;
    const cells = fillTargets(f)
      .map(({ row, col }) => ({ batch_id: visibleBatches[row]?.id, time_slot_id: slots[col]?.id }))
      .filter((c) => c.batch_id && c.time_slot_id);
    if (!cells.length) return;
    const from = { batch_id: src.id, time_slot_id: srcSlot.id };
    setMoving(true);
    try {
      const { filled, skipped } = await copyIntoCells(from, cells);
      await reload();
      if (filled.length) {
        setUndoStack((s) => [...s, { type: 'fill', src: from, cells: filled }]);
        setRedoStack([]);
      }
      toast(filled.length
        ? `Filled ${filled.length} cell(s)${skipped ? ` · skipped ${skipped} that already had sessions` : ''}`
        : 'Nothing filled — those cells already have sessions', filled.length ? undefined : 'error');
    } catch (e) {
      toast(e.response?.data?.error || 'Could not fill the cells', 'error');
      await reload();
    } finally {
      setMoving(false);
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
      setUndoStack((s) => [...s, { type: 'cells', ops }]);
      setRedoStack([]);                          // a fresh move invalidates redo
      toast(target ? 'Sessions swapped' : 'Session moved');
    } catch (e) {
      toast(e.response?.data?.error || 'Could not move the session', 'error');
      await reload();
    } finally {
      setMoving(false);
    }
  }

  // Refresh the date dropdown (days can appear/vanish when sessions are
  // deleted or restored in bulk).
  async function refreshDates() {
    const { data: ds } = await api.get('/allocations/dates');
    setDates(ds.map((d) => d.slice(0, 10)));
  }

  // Delete a batch row: removes the batch and its sessions on EVERY date,
  // not just the day on screen. Undoable with Ctrl+Z — the server returns
  // the deleted rows and /batches/restore reinserts them.
  async function deleteBatch(b) {
    if (!confirm(`Delete the batch "${b.name}" and ALL of its sessions on every date? ` +
      'You can undo this with Ctrl+Z until you leave this view.')) return;
    try {
      const { data: r } = await api.delete(`/batches/${b.id}`);
      await refreshDates();
      await reload();
      setUndoStack((s) => [...s, { type: 'batch-delete', batch: r.batch, allocations: r.allocations }]);
      setRedoStack([]);
      toast(`Batch deleted (${r.deleted_sessions} session(s) removed) — Ctrl+Z to undo`);
    } catch (e) {
      toast(e.response?.data?.error || 'Could not delete the batch', 'error');
    }
  }

  // Drag a batch row above/below another row: rebuild the full order of the
  // grid's batches and persist it in one call. Uses the unfiltered `batches`
  // list so a faculty-filtered view still reorders against the real grid.
  async function moveRow(srcId, targetId, pos) {
    if (moving || srcId === targetId) return;
    const prevIds = batches.map((b) => b.id).filter(Boolean);
    const ids = [...prevIds];
    const from = ids.indexOf(srcId);
    if (from === -1) return;
    ids.splice(from, 1);
    let at = ids.indexOf(targetId);
    if (at === -1) return;
    if (pos === 'below') at += 1;
    ids.splice(at, 0, srcId);
    setMoving(true);
    try {
      await api.put('/batches/reorder', { program_id: programId, order: ids });
      await reload();
      setUndoStack((s) => [...s, { type: 'order', program_id: programId, from: prevIds, to: ids }]);
      setRedoStack([]);
      toast('Row moved');
    } catch (e) {
      toast(e.response?.data?.error || 'Could not move the row', 'error');
    } finally {
      setMoving(false);
    }
  }

  // Apply one history entry in the given direction ('undo' | 'redo').
  async function applyEntry(entry, dir) {
    if (entry.type === 'cells') {
      const key = dir === 'undo' ? 'from' : 'to';
      await applyPositions(entry.ops.map((o) => ({ id: o.id, ...o[key] })));
    } else if (entry.type === 'order') {
      await api.put('/batches/reorder', {
        program_id: entry.program_id,
        order: dir === 'undo' ? entry.from : entry.to,
      });
    } else if (entry.type === 'batch-delete') {
      if (dir === 'undo') {
        await api.post('/batches/restore', {
          batch: entry.batch, allocations: entry.allocations,
        });
      } else {
        await api.delete(`/batches/${entry.batch.id}`);
      }
      await refreshDates();
    } else if (entry.type === 'fill') {
      if (dir === 'undo') {
        // the filled cells were empty before, so undo empties them again
        const ids = data.allocations
          .filter((a) => a.program_id === programId && entry.cells.some((c) =>
            c.batch_id === a.batch_id && c.time_slot_id === a.time_slot_id))
          .map((a) => a.id);
        for (const id of ids) await api.delete(`/allocations/${id}`);
      } else {
        await copyIntoCells(entry.src, entry.cells);
      }
    }
  }

  function entryToast(entry, dir) {
    if (entry.type === 'fill') return dir === 'undo' ? 'Fill undone' : 'Fill redone';
    if (entry.type === 'order') return dir === 'undo' ? 'Row order undone' : 'Row order redone';
    if (entry.type === 'batch-delete')
      return dir === 'undo' ? 'Batch restored' : 'Batch deleted again';
    return dir === 'undo' ? 'Move undone' : 'Move redone';
  }

  // Undo the most recent grid change (Ctrl+Z).
  async function undoMove() {
    if (moving || !undoStack.length) return;
    const entry = undoStack[undoStack.length - 1];
    setMoving(true);
    try {
      await applyEntry(entry, 'undo');
      await reload();
      setUndoStack((s) => s.slice(0, -1));
      setRedoStack((s) => [...s, entry]);
      toast(entryToast(entry, 'undo'));
    } catch (e) {
      toast(e.response?.data?.error || 'Could not undo', 'error');
      await reload();
    } finally {
      setMoving(false);
    }
  }

  // Redo the last undone change (Ctrl+Y / Ctrl+Shift+Z).
  async function redoMove() {
    if (moving || !redoStack.length) return;
    const entry = redoStack[redoStack.length - 1];
    setMoving(true);
    try {
      await applyEntry(entry, 'redo');
      await reload();
      setRedoStack((s) => s.slice(0, -1));
      setUndoStack((s) => [...s, entry]);
      toast(entryToast(entry, 'redo'));
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
    <div className={'page' + (printData ? ' printing-all' : '') + (fill ? ' filling' : '')}>
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
            {/* The chosen day may have no sessions yet (e.g. today), so make
                sure it is still listed rather than the select showing another day. */}
            {(date && !dates.includes(date) ? [...dates, date].sort() : dates)
              .map((d) => <option key={d} value={d}>{fmt(d)}</option>)}
          </select>
        </label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn ghost" onClick={() => window.print()}
          title="Print this program's timetable">Print</button>
        <button className="btn ghost" onClick={printAll} disabled={printing || !date}
          title="Print every program's timetable for this day in one document (Save as PDF)">
          {printing ? 'Preparing…' : '🖨 Print all'}
        </button>
        {canEdit && <EmailSchedules date={date} />}
        {canEdit && (undoStack.length > 0 || redoStack.length > 0) && (
          <>
            <button className="btn ghost" onClick={undoMove}
              disabled={moving || !undoStack.length}
              title="Undo the last grid change (Ctrl+Z)">↶ Undo</button>
            <button className="btn ghost" onClick={redoMove}
              disabled={moving || !redoStack.length}
              title="Redo the last undone change (Ctrl+Y)">↷ Redo</button>
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
                  title={canEdit ? 'Click to edit this timing · Right-click to copy / paste the column' : undefined}
                  onClick={() => canEdit && setEditingSlot(s)}
                  onContextMenu={(e) => {
                    if (!canEdit || !hasColumnAction(s.id)) return;
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, slot: s });
                  }}>
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleBatches.map((b, ri) => (
              <tr key={b.id ?? b.name}
                className={rowDragOver?.id === b.id ? 'row-drag-' + rowDragOver.pos : undefined}
                onDragOver={(e) => {
                  // Only react to a row drag (rowDragRef), never a session drag.
                  if (!canEdit || !rowDragRef.current || !b.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const r = e.currentTarget.getBoundingClientRect();
                  const pos = e.clientY < r.top + r.height / 2 ? 'above' : 'below';
                  setRowDragOver((cur) =>
                    cur?.id === b.id && cur.pos === pos ? cur : { id: b.id, pos });
                }}
                onDrop={(e) => {
                  if (!canEdit || !rowDragRef.current) return;
                  e.preventDefault();
                  const src = rowDragRef.current;
                  const over = rowDragOver;
                  rowDragRef.current = null;
                  setRowDragOver(null);
                  if (b.id && src !== b.id) moveRow(src, b.id, over?.pos || 'above');
                }}>
                <td className="batch"
                  draggable={Boolean(canEdit && b.id)}
                  title={canEdit && b.id
                    ? 'Drag to reorder rows · Right-click to edit this batch' : undefined}
                  onDragStart={(e) => {
                    if (!canEdit || !b.id) return;
                    rowDragRef.current = b.id;
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => { rowDragRef.current = null; setRowDragOver(null); }}
                  onContextMenu={(e) => {
                    if (!canEdit || !b.id) return; // batch-less rows have nothing to edit
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, batch: b });
                  }}>
                  {b.name}{b.count ? <span className="room"> ({b.count})</span> : null}
                </td>
                {slots.map((s, ci) => {
                  const a = b.cells[s.id];
                  const extras = b.extra?.[s.id] || [];
                  const conf = a ? data.conflicts[a.id] : null;
                  const level = conf?.some((c) => c.level === 'error') ? 'error'
                    : conf?.length ? 'warn' : null;
                  const cellKey = (b.id ?? b.name) + ':' + s.id;
                  // Where a new activity would land. Batch-less rows (German's
                  // per-tutor rows) have no cell to add one to.
                  const cellRef = b.id ? {
                    batch_id: b.id, batch_name: b.name,
                    time_slot_id: s.id, slot_label: s.label,
                    occupied: Boolean(a),
                  } : null;
                  return (
                    <td key={s.id}>
                      <div
                        className={'cell' + (level ? ' conf-' + level : '')
                          + (dragOver === cellKey ? ' drag-over' : '')
                          + (a?.status === 'pending' ? ' pending' : '')
                          + (highlight(a) ? ' tinted' : '')
                          + (fill && fill.from.row === ri && fill.from.col === ci ? ' fill-src' : '')
                          + (fillSet.has(`${ri}:${ci}`) ? ' fill-range' : '')}
                        data-fill={`${ri}:${ci}`}
                        style={highlight(a)}
                        title={a?.status === 'pending'
                          ? 'Requested by the tutor — awaiting approval'
                          : (conf ? conf.map((c) => c.message).join('\n') : '')}
                        draggable={Boolean(canEdit && a)}
                        onDragStart={(e) => {
                          if (fillRef.current) { e.preventDefault(); return; } // fill handle, not a move
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
                          if (!canEdit) return;                 // admins only
                          if (!a && !cellRef && !hasColumnAction(s.id)) return; // nothing to act on
                          e.preventDefault();
                          // An empty cell still gets a menu, so an activity can
                          // be dropped straight into a free slot.
                          setMenu({ x: e.clientX, y: e.clientY, allocation: a, cell: cellRef, slot: s });
                        }}>
                        {a ? (
                          <>
                            <div className="act">
                              {a.activity_code || ''}{' '}
                              {a.note && (a.activity_code || a.faculty_name) && (
                                <span className="note" title={a.note} style={noteStyle(a)}>{a.note}</span>
                              )}{' '}
                              {level && <span className={'badge ' + level}>!</span>}
                              {a.status === 'pending' && (
                                <span className="badge pending" title="Awaiting admin approval">⏳</span>
                              )}
                            </div>
                            {a.faculty_name && <div className="fac">{a.faculty_name}</div>}
                            {a.room_code && <div className="room">{a.room_code}</div>}
                            {!a.activity_code && !a.faculty_name && (
                              <div className="room">{a.raw_text || a.note}</div>
                            )}
                            {extras.map((x) => {
                              const xc = data.conflicts[x.id];
                              const xl = xc?.some((c) => c.level === 'error') ? 'error'
                                : xc?.length ? 'warn' : null;
                              // A split area holds nothing yet: it is a colour
                              // waiting for its activity, so clicking it goes
                              // straight to the activity picker.
                              const label = x.faculty_name || x.activity_code || x.raw_text || x.note;
                              return (
                                <div key={x.id}
                                  className={'fac extra' + (highlight(x) ? ' tinted' : '')}
                                  style={highlight(x)}
                                  title={xc ? xc.map((c) => c.message).join('\n')
                                    : (canEdit
                                      ? (!label
                                        ? 'Empty area — click to add an activity'
                                        : (highlight(x)
                                          ? 'Activity — click to edit, right-click to remove'
                                          : 'Additional faculty — click to edit'))
                                      : undefined)}
                                  onClick={(e) => {
                                    if (!canEdit || moving) return;
                                    e.stopPropagation();
                                    if (label) setEditing(x);
                                    else setActivityCell(x);
                                  }}
                                  onContextMenu={(e) => {
                                    if (!canEdit) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    // `cell` as well as the session itself: once a
                                    // cell is full these lines cover it, and the
                                    // menu still has to be able to add to it.
                                    setMenu({ x: e.clientX, y: e.clientY, allocation: x, cell: cellRef, slot: s });
                                  }}>
                                  {label ? `+ ${label}` : <span className="empty-area">+ activity</span>}
                                  {x.note && label && x.note !== label && (
                                    <span className="note" title={x.note} style={noteStyle(x)}>{x.note}</span>
                                  )}
                                  {xl && <span className={'badge ' + xl}>!</span>}
                                  {x.status === 'pending' && (
                                    <span className="badge pending" title="Awaiting admin approval">⏳</span>
                                  )}
                                </div>
                              );
                            })}
                          </>
                        ) : null}
                        {/* Hovering a filled cell reveals a divider with a "+":
                            click it to split the cell into another area. */}
                        {canEdit && a && cellRef && (
                          <button type="button" className="split-add no-print"
                            title="Split this cell — add another area"
                            onClick={(e) => { e.stopPropagation(); setSplitting(cellRef); }}
                            onContextMenu={(e) => e.stopPropagation()}>
                            <span>+</span>
                          </button>
                        )}
                        {/* Excel-style fill handle: drag it across or down to
                            copy this cell into the empty cells it passes over. */}
                        {canEdit && a && cellRef && a.status === 'approved' && (
                          <span className="fill-handle no-print"
                            title="Drag across or down to copy this cell into empty cells"
                            onPointerDown={(e) => startFill(e, ri, ci)}
                            onClick={(e) => e.stopPropagation()}
                            onContextMenu={(e) => e.stopPropagation()} />
                        )}
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

      {printData && (
        <div className="print-all">
          {printData.map(({ program, slots: ps, rows }) => (
            <section key={program.id} className="print-prog">
              <h2 className="print-title">
                {program.code} TIMETABLE ({date.split('-').reverse().join('/')})
              </h2>
              <table className="tt">
                <thead>
                  <tr>
                    <th className="batch">Batch</th>
                    {ps.map((s) => <th key={s.id}>{s.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id ?? b.name}>
                      <td className="batch">
                        {b.name}{b.count ? <span className="room"> ({b.count})</span> : null}
                      </td>
                      {ps.map((s) => (
                        <td key={s.id}>
                          {b.cells[s.id] && <PrintCell a={b.cells[s.id]} extras={b.extra?.[s.id] || []} />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

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
          <div className="ctx-menu" style={{ top: menu.y, left: menu.x }} onClick={(e) => e.stopPropagation()}
            ref={(el) => {
              // Keep the menu on screen: open it upward / leftward from the
              // cursor when there isn't room below / to the right.
              if (!el) return;
              const pad = 8;
              const { width, height } = el.getBoundingClientRect();
              const vw = window.innerWidth, vh = window.innerHeight;
              let top = menu.y, left = menu.x;
              if (top + height > vh - pad) top = Math.max(pad, menu.y - height);
              if (left + width > vw - pad) left = Math.max(pad, vw - width - pad);
              el.style.top = `${top}px`;
              el.style.left = `${left}px`;
            }}>
            {menu.batch ? (
              <>
                <button className="ctx-item"
                  onClick={() => { setEditingBatch({ batchId: menu.batch.id }); setMenu(null); }}>
                  Edit batch…
                </button>
                <button className="ctx-item"
                  onClick={() => {
                    setEditingBatch({ placement: { position: 'above', relative_to: menu.batch.id } });
                    setMenu(null);
                  }}>
                  Add row above (new batch)…
                </button>
                <button className="ctx-item"
                  onClick={() => {
                    setEditingBatch({ placement: { position: 'below', relative_to: menu.batch.id } });
                    setMenu(null);
                  }}>
                  Add row below (new batch)…
                </button>
                <button className="ctx-item"
                  onClick={() => { setEditingBatch({}); setMenu(null); }}>
                  Add row at end (new batch)…
                </button>
                <button className="ctx-item danger"
                  onClick={() => { const b = menu.batch; setMenu(null); deleteBatch(b); }}>
                  Delete row (batch)…
                </button>
              </>
            ) : (
              <>
                {menu.allocation && (
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
                    <button className="ctx-item"
                      onClick={() => { setNoting(menu.allocation); setMenu(null); }}>
                      {menu.allocation.note ? 'Edit note…' : 'Add note…'}
                    </button>
                  </>
                )}
                {menu.cell && (
                  <>
                    <button className="ctx-item"
                      onClick={() => { setActivityCell(menu.cell); setMenu(null); }}>
                      Add activity…
                    </button>
                    {/* Same as the hover "+", for touch screens and for anyone
                        who works from the menu. */}
                    {menu.allocation && (
                      <button className="ctx-item"
                        onClick={() => { setSplitting(menu.cell); setMenu(null); }}>
                        Split cell…
                      </button>
                    )}
                  </>
                )}
                {menu.allocation && (
                  <button className="ctx-item"
                    onClick={() => { setActivityCell(menu.allocation); setMenu(null); }}>
                    {isHighlighted(menu.allocation)
                      ? 'Edit activity / colours…'
                      : 'Colour this session…'}
                  </button>
                )}
                {menu.allocation && (
                  <button className="ctx-item danger"
                    onClick={() => { const a = menu.allocation; setMenu(null); clearSession(a); }}>
                    {isHighlighted(menu.allocation) ? 'Remove activity' : 'Clear session'}
                  </button>
                )}
                {menu.slot && (
                  <>
                    {(menu.allocation || menu.cell) && <div className="ctx-sep" />}
                    {menu.cell?.occupied && (
                      <button className="ctx-item"
                        onClick={() => { const c = menu.cell; setMenu(null); copyCell(c); }}>
                        Copy cell
                      </button>
                    )}
                    {menu.cell && !menu.cell.occupied
                      && cellClip && cellClip.programId === programId && (
                      <button className="ctx-item"
                        onClick={() => { const c = menu.cell; setMenu(null); pasteCell(c); }}>
                        Paste cell ({cellClip.batch.name} · {cellClip.slot.label}
                        {cellClip.date !== date ? `, ${fmt(cellClip.date)}` : ''})
                      </button>
                    )}
                    {columnSessions(menu.slot.id).length > 0 && (
                      <button className="ctx-item"
                        onClick={() => { const s = menu.slot; setMenu(null); copyColumn(s); }}>
                        Copy column ({menu.slot.label})
                      </button>
                    )}
                    {columnClip && columnClip.programId === programId
                      && !columnSessions(menu.slot.id).length && (
                      <button className="ctx-item"
                        onClick={() => { const s = menu.slot; setMenu(null); pasteColumn(s); }}>
                        Paste column ({columnClip.slot.label}
                        {columnClip.date !== date ? `, ${fmt(columnClip.date)}` : ''})
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {noting && (
        <NoteModal
          allocation={noting}
          onClose={() => setNoting(null)}
          onSaved={() => { setNoting(null); reload(); }}
        />
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

      {activityCell && (
        <ActivityModal
          target={activityCell}
          programId={programId}
          date={date}
          onClose={() => setActivityCell(null)}
          onSaved={() => { setActivityCell(null); reload(); }}
        />
      )}

      {splitting && (
        <SplitCellModal
          cell={splitting}
          programId={programId}
          date={date}
          onClose={() => setSplitting(null)}
          onSaved={() => { setSplitting(null); reload(); }}
        />
      )}

      {editingBatch && (
        <BatchModal
          batchId={editingBatch.batchId || null}
          placement={editingBatch.placement || null}
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

// The highlight colours of a session. Only the colours stored on the session
// itself paint the grid — the activity type's colours are just the default the
// "Add activity" modal offers — so recolouring a type never repaints days that
// are already published, and untouched sessions keep the plain grid look.
function highlight(a) {
  if (!a) return undefined;
  const color = a.text_color;
  const background = a.bg_color;
  if (!color && !background) return undefined;
  const style = {};
  if (color) style.color = color;
  if (background) style.background = background;
  return style;
}

const isHighlighted = (a) => Boolean(highlight(a));

// Batch rows × slot columns for one program's day. Only rows for that program
// and its current slot grid are kept, so another program's sessions can never
// render as blank "—" rows.
function buildRows(allocations, programId, slotIds) {
  const byBatch = new Map();
  for (const a of allocations) {
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
  return [...byBatch.values()];
}

// A read-only grid cell for "Print all".
function PrintCell({ a, extras }) {
  return (
    <div className={'cell' + (highlight(a) ? ' tinted' : '')} style={highlight(a)}>
      <div className="act">
        {a.activity_code || ''}{' '}
        {a.note && (a.activity_code || a.faculty_name) && (
          <span className="note" style={noteStyle(a)}>{a.note}</span>
        )}
      </div>
      {a.faculty_name && <div className="fac">{a.faculty_name}</div>}
      {a.room_code && <div className="room">{a.room_code}</div>}
      {!a.activity_code && !a.faculty_name && <div className="room">{a.raw_text || a.note}</div>}
      {extras.map((x) => {
        const label = x.faculty_name || x.activity_code || x.raw_text || x.note;
        if (!label) return null;
        return (
          <div key={x.id} className={'fac extra' + (highlight(x) ? ' tinted' : '')} style={highlight(x)}>
            + {label}
            {x.note && x.note !== label && <span className="note" style={noteStyle(x)}>{x.note}</span>}
          </div>
        );
      })}
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

// Today as YYYY-MM-DD in the browser's local time zone (not UTC, which would
// still be yesterday early in the morning in India).
function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmt(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
