import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireEditor } from '../middleware/auth.js';
import { conflictsForDate } from '../services/conflicts.js';
import { sendMail, scheduleEmail, sessionAssignedEmail } from '../services/mailer.js';
import { getSettings } from '../services/settings.js';
import { sheetsForDate, applySheet, sheetSessionCount } from './knowledge.js';
import { WEEKDAY_NAMES } from '../db/migrate-kb.js';

const router = Router();
router.use(requireAuth);

const SELECT = `
  SELECT a.*, p.code AS program_code,
         b.name AS batch_name, b.student_count,
         ac.code AS activity_code, ac.name AS activity_name,
         ac.text_color AS activity_text_color, ac.bg_color AS activity_bg_color,
         ts.label AS slot_label, ts.sort_order AS slot_order,
         r.code AS room_code, r.capacity AS room_capacity,
         f.name AS faculty_name
    FROM allocations a
    JOIN programs p     ON p.id = a.program_id
    LEFT JOIN batches b ON b.id = a.batch_id
    LEFT JOIN activities ac ON ac.id = a.activity_id
    JOIN time_slots ts  ON ts.id = a.time_slot_id
    LEFT JOIN classrooms r ON r.id = a.classroom_id
    LEFT JOIN faculty f ON f.id = a.faculty_id`;

// GET /api/allocations?date=YYYY-MM-DD[&program_id=]
router.get('/', async (req, res) => {
  const { date, program_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });
  const params = [date];
  // Rejected requests are kept for the tutor's own history but never belong in
  // the grid; pending ones show through, badged, so admins can judge in context.
  let sql = SELECT + " WHERE a.alloc_date = ? AND a.status <> 'rejected'";
  if (program_id) { sql += ' AND a.program_id = ?'; params.push(program_id); }
  // a.id last so a cell's sessions keep a stable, insertion order: the
  // original class leads the cell and anything added later (a co-teacher, an
  // activity) lines up underneath it instead of displacing it.
  sql += ' ORDER BY p.code, b.sort_order, a.batch_id, ts.sort_order, a.id';
  const [rows] = await pool.query(sql, params);
  const conflicts = await conflictsForDate(date);
  res.json({ allocations: rows, conflicts });
});

// distinct dates that have data (for the date picker)
router.get('/dates', async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT DISTINCT alloc_date FROM allocations WHERE status <> 'rejected' ORDER BY alloc_date"
  );
  res.json(rows.map((r) => r.alloc_date));
});

router.get('/conflicts', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });
  res.json(await conflictsForDate(date));
});

// Email each faculty (who has an address) their schedule for a date.
// Intended to be run after allocations are finalised.
router.post('/notify', requireEditor, async (req, res) => {
  const { date } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date is required' });
  const settings = await getSettings();
  if (settings.smtp_enabled !== '1')
    return res.status(400).json({ error: 'Email is disabled — enable SMTP in Settings first' });

  const [rows] = await pool.query(
    `SELECT a.faculty_id, f.name AS faculty_name, f.email,
            ac.code AS activity_code, ac.name AS activity_name,
            ts.label AS slot_label, ts.sort_order,
            p.code AS program_code, b.name AS batch_name, r.code AS room_code
       FROM allocations a
       JOIN faculty f      ON f.id = a.faculty_id
       JOIN programs p     ON p.id = a.program_id
       LEFT JOIN batches b ON b.id = a.batch_id
       LEFT JOIN activities ac ON ac.id = a.activity_id
       JOIN time_slots ts  ON ts.id = a.time_slot_id
       LEFT JOIN classrooms r ON r.id = a.classroom_id
      WHERE a.alloc_date = ? AND a.faculty_id IS NOT NULL AND f.email IS NOT NULL AND f.email <> ''
      ORDER BY a.faculty_id, ts.sort_order`,
    [date]
  );

  // group sessions per faculty
  const byFac = new Map();
  for (const r of rows) {
    if (!byFac.has(r.faculty_id))
      byFac.set(r.faculty_id, { name: r.faculty_name, email: r.email, sessions: [] });
    byFac.get(r.faculty_id).sessions.push(r);
  }

  let sent = 0;
  const failures = [];
  for (const fac of byFac.values()) {
    try {
      const { subject, html } = scheduleEmail(fac.name, date, fac.sessions, settings.app_title);
      await sendMail({ to: fac.email, subject, html });
      sent++;
    } catch (e) {
      failures.push({ faculty: fac.name, error: e.message });
    }
  }
  res.json({ sent, total: byFac.size, skipped_no_email: 0, failures });
});

// GET /api/allocations/sheets?date=&program_id= — the Knowledge Base sheets
// that could build this day, best first, with how many sessions each holds for
// the program. Feeds the picker the Timetable opens when Generate finds nothing
// to build from on its own: the admin chooses the sheet instead of guessing.
router.get('/sheets', requireEditor, async (req, res) => {
  const { date, program_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });
  res.json({ sheets: await describeSheets(date, program_id) });
});

// A sheet that won't parse is still listed, with its reason, rather than
// dropped — an admin picking sheets needs to see why one is unusable.
async function describeSheets(date, program_id) {
  const rows = await sheetsForDate(date);
  return Promise.all(rows.map(async (r) => {
    let sessions = null;
    let error = null;
    try {
      sessions = await sheetSessionCount(r, date, program_id || null);
    } catch (e) {
      error = e.message;
    }
    return {
      id: r.id,
      title: r.title,
      filename: r.filename,
      weekday: r.weekday,
      weekday_name: r.weekday == null ? null : WEEKDAY_NAMES[r.weekday],
      session_count: r.session_count,
      sessions,
      error,
    };
  }));
}

// POST /api/allocations/generate { date, program_id?, sheet_id? }
// Creates the timetable for an empty day. With sheet_id the admin has picked a
// Knowledge Base sheet themselves (the picker below) and that sheet is used as
// given. Otherwise: first choice is the Knowledge Base sheet filed under that
// weekday (the academy's reference pattern for, say, a Monday), then any other
// sheet (see sheetsForDate); only when no sheet has sessions for the program
// does it copy the most recent earlier day that has sessions, again preferring
// the same weekday. Refuses if the target day already has sessions (for the
// program, when one is given).
router.post('/generate', requireEditor, async (req, res) => {
  const { date, program_id, sheet_id } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date is required' });
  const progFilter = program_id ? ' AND program_id = ?' : '';
  const progParams = program_id ? [program_id] : [];

  const [[existing]] = await pool.query(
    `SELECT COUNT(*) AS n FROM allocations WHERE alloc_date = ?${progFilter}`,
    [date, ...progParams]
  );
  if (existing.n)
    return res.status(409).json({ error: 'That day already has sessions' });

  // A sheet the admin picked in the modal is used as asked — including its
  // failures, which are theirs to see rather than silently skipped.
  if (sheet_id) {
    const [[sheet]] = await pool.query('SELECT * FROM kb_documents WHERE id = ?', [sheet_id]);
    if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
    const applied = await applySheet(sheet, { date, program_id });
    if (applied.error) return res.status(applied.status || 400).json({ error: applied.error });
    return res.json(applied);
  }

  // A Knowledge Base sheet beats a copied day: it is the pattern an admin
  // curated for this weekday. Its own failures (an unreadable sheet, nothing for
  // this program) are not fatal — we try the next sheet, then the copy below.
  for (const sheet of await sheetsForDate(date)) {
    const applied = await applySheet(sheet, { date, program_id });
    if (!applied.error) return res.json(applied);
  }

  const [cands] = await pool.query(
    `SELECT DISTINCT alloc_date FROM allocations WHERE alloc_date < ?${progFilter}
      ORDER BY alloc_date DESC`,
    [date, ...progParams]
  );
  // Nothing to copy either. Hand back the Knowledge Base sheets so the client
  // can offer them, instead of leaving the admin at a dead end.
  if (!cands.length) {
    const sheets = await describeSheets(date, program_id);
    return res.status(400).json({
      error: sheets.length
        ? 'No earlier day to copy from — pick a Knowledge Base sheet'
        : 'No earlier day to copy from, and the Knowledge Base has no usable sheet',
      code: 'no_source',
      sheets,
    });
  }
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const sameWeekday = cands.find(
    (r) => new Date(r.alloc_date + 'T00:00:00Z').getUTCDay() === weekday
  );
  const source = (sameWeekday || cands[0]).alloc_date;

  // merge_id is only ever matched together with the date, so reusing the
  // source day's ids keeps its merged cells merged on the new day.
  const [r] = await pool.query(
    `INSERT INTO allocations (alloc_date, program_id, batch_id, activity_id, time_slot_id,
                              classroom_id, faculty_id, student_count, raw_text, note,
                              text_color, bg_color, note_text_color, note_bg_color,
                              merge_id, merge_copy)
     SELECT ?, program_id, batch_id, activity_id, time_slot_id,
            classroom_id, faculty_id, student_count, raw_text, note,
            text_color, bg_color, note_text_color, note_bg_color,
            merge_id, merge_copy
       FROM allocations WHERE alloc_date = ?${progFilter}`,
    [date, source, ...progParams]
  );
  res.json({ created: r.affectedRows, source: 'previous-day', source_date: source });
});

// POST /api/allocations/copy-column
//   { program_id, source_date, source_slot_id, date, time_slot_id,
//     source_batch_id?, batch_id? }
// Pastes every session of one time-slot column (all batches) into another
// column, on the same day or a different one. With source_batch_id + batch_id
// it copies a single cell instead (the cell's lead session and anything added
// under it) into another cell. Only approved sessions are copied — a tutor's
// pending request is theirs, not part of the timetable. Refuses when the
// target already has sessions, so a paste never stacks onto existing ones.
router.post('/copy-column', requireEditor, async (req, res) => {
  const { program_id, source_date, source_slot_id, date, time_slot_id,
    source_batch_id, batch_id } = req.body || {};
  if (!program_id || !source_date || !source_slot_id || !date || !time_slot_id)
    return res.status(400).json({ error: 'program_id, source_date, source_slot_id, date and time_slot_id are required' });
  const cell = source_batch_id != null || batch_id != null;
  if (cell && (source_batch_id == null || batch_id == null))
    return res.status(400).json({ error: 'source_batch_id and batch_id go together' });
  if (source_date === date && Number(source_slot_id) === Number(time_slot_id)
      && (!cell || Number(source_batch_id) === Number(batch_id)))
    return res.status(400).json({ error: `Pick a different ${cell ? 'cell' : 'column'} to paste into` });

  const batchWhere = cell ? ' AND batch_id = ?' : '';
  const [[existing]] = await pool.query(
    `SELECT COUNT(*) AS n FROM allocations
      WHERE alloc_date = ? AND program_id = ? AND time_slot_id = ?${batchWhere} AND status <> 'rejected'`,
    [date, program_id, time_slot_id, ...(cell ? [batch_id] : [])]
  );
  if (existing.n)
    return res.status(409).json({
      error: `That ${cell ? 'cell' : 'column'} already has sessions — clear it first`,
    });

  const [r] = await pool.query(
    `INSERT INTO allocations (alloc_date, program_id, batch_id, activity_id, time_slot_id,
                              classroom_id, faculty_id, student_count, raw_text, note,
                              text_color, bg_color, note_text_color, note_bg_color)
     SELECT ?, program_id, ${cell ? '?' : 'batch_id'}, activity_id, ?,
            classroom_id, faculty_id, student_count, raw_text, note,
            text_color, bg_color, note_text_color, note_bg_color
       FROM allocations
      WHERE alloc_date = ? AND program_id = ? AND time_slot_id = ?${batchWhere} AND status = 'approved'
      ORDER BY id`,
    [date, ...(cell ? [batch_id] : []), time_slot_id,
      source_date, program_id, source_slot_id, ...(cell ? [source_batch_id] : [])]
  );
  res.json({ created: r.affectedRows });
});

// ---- Merged cells -------------------------------------------------------
// A merge joins a run of adjacent slots in one batch row into one wide cell.
// The first cell's sessions stay the originals (merge_copy = 0) and every
// other slot of the run gets copies of them (merge_copy = 1), all sharing a
// merge_id. The copies keep conflicts, tutor schedules and emails right for
// every slot the merged cell covers; syncMerge rewrites them whenever the
// originals change, so the grid only ever edits the first cell.

const COPY_COLS = `program_id, batch_id, activity_id, classroom_id, faculty_id,
  student_count, raw_text, note, text_color, bg_color, note_text_color, note_bg_color`;

// Rebuild the copies of one merged cell from its originals. `slotIds` names
// the slots that should hold copies; by default the ones that hold them now.
// A merge whose originals are all gone is dissolved, copies and all.
async function syncMerge(db, { date, program_id, batch_id, merge_id }, slotIds = null) {
  const [rows] = await db.query(
    `SELECT id, time_slot_id, merge_copy, status FROM allocations
      WHERE alloc_date = ? AND program_id = ? AND batch_id = ? AND merge_id = ?
      ORDER BY id`,
    [date, program_id, batch_id, merge_id]
  );
  const originals = rows.filter((r) => !r.merge_copy);
  const slots = slotIds || [...new Set(rows.filter((r) => r.merge_copy).map((r) => r.time_slot_id))];
  await db.query(
    `DELETE FROM allocations
      WHERE alloc_date = ? AND program_id = ? AND batch_id = ? AND merge_id = ? AND merge_copy = 1`,
    [date, program_id, batch_id, merge_id]
  );
  // Only approved sessions are copied: a tutor's pending request stays theirs.
  const ids = originals.filter((r) => r.status === 'approved').map((r) => r.id);
  if (!ids.length) {
    await db.query(
      'UPDATE allocations SET merge_id = NULL, merge_copy = 0 WHERE id IN (?)',
      [originals.length ? originals.map((r) => r.id) : [0]]
    );
    return;
  }
  const anchorSlot = originals[0].time_slot_id;
  for (const slot of slots) {
    if (Number(slot) === Number(anchorSlot)) continue;
    await db.query(
      `INSERT INTO allocations (alloc_date, time_slot_id, merge_id, merge_copy, ${COPY_COLS})
       SELECT alloc_date, ?, merge_id, 1, ${COPY_COLS}
         FROM allocations WHERE id IN (?) ORDER BY id`,
      [slot, ids]
    );
  }
}

// Resync the merged cell an allocation belongs to (after it was added to,
// edited or removed). Copies are never edited on their own: a change to one
// is undone by rebuilding it from the originals.
async function resyncFor(row) {
  if (!row?.merge_id || row.batch_id == null) return;
  await syncMerge(pool, {
    date: row.alloc_date, program_id: row.program_id,
    batch_id: row.batch_id, merge_id: row.merge_id,
  });
}

// POST /api/allocations/merge { date, program_id, batch_id, slot_ids, replace? }
// Merges adjacent cells of one batch row. The first cell (in slot order) that
// holds a session supplies the merged cell's content; any other cell in the
// range that has sessions is refused with code 'occupied' unless `replace` is
// set, in which case those sessions are deleted. Cells already part of another
// merge that overlaps the range are unmerged first.
router.post('/merge', requireEditor, async (req, res) => {
  const { date, program_id, batch_id, slot_ids, replace } = req.body || {};
  if (!date || !program_id || !batch_id || !Array.isArray(slot_ids) || slot_ids.length < 2)
    return res.status(400).json({ error: 'date, program_id, batch_id and two or more slot_ids are required' });

  const [grid] = await pool.query(
    'SELECT id FROM time_slots WHERE program_id = ? ORDER BY sort_order, id', [program_id]);
  const order = grid.map((s) => s.id);
  const idx = [...new Set(slot_ids.map(Number))].map((id) => order.indexOf(id)).sort((a, b) => a - b);
  if (idx.some((i) => i === -1))
    return res.status(400).json({ error: 'Those time slots are not in this timetable' });
  if (idx.some((i, k) => k && i !== idx[k - 1] + 1))
    return res.status(400).json({ error: 'Only side-by-side cells can be merged' });
  const slots = idx.map((i) => order[i]);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const cellWhere = `alloc_date = ? AND program_id = ? AND batch_id = ? AND time_slot_id IN (?)
                       AND status <> 'rejected'`;
    const cellParams = [date, program_id, batch_id, slots];

    // Break up any merge touching the range; its cells outside the range keep
    // their copies as ordinary sessions.
    const [touching] = await conn.query(
      `SELECT DISTINCT merge_id FROM allocations WHERE ${cellWhere} AND merge_id IS NOT NULL`,
      cellParams
    );
    if (touching.length) {
      // copies inside the range go; the new merge re-copies from its anchor
      await conn.query(
        `DELETE FROM allocations WHERE ${cellWhere} AND merge_copy = 1`, cellParams);
      await conn.query(
        `UPDATE allocations SET merge_id = NULL, merge_copy = 0
          WHERE alloc_date = ? AND program_id = ? AND batch_id = ? AND merge_id IN (?)`,
        [date, program_id, batch_id, touching.map((t) => t.merge_id)]
      );
    }

    const [rows] = await conn.query(
      `SELECT id, time_slot_id, status FROM allocations WHERE ${cellWhere} ORDER BY id`, cellParams);
    const anchorSlot = slots.find((s) => rows.some((r) => r.time_slot_id === s && r.status === 'approved'));
    if (!anchorSlot) {
      await conn.rollback();
      return res.status(400).json({ error: 'Nothing to merge — add a session to one of the cells first' });
    }
    const others = rows.filter((r) => r.time_slot_id !== anchorSlot && r.status === 'approved');
    if (others.length && !replace) {
      await conn.rollback();
      return res.status(409).json({
        code: 'occupied', count: others.length,
        error: `${others.length} other session(s) in the selected cells would be replaced`,
      });
    }
    if (others.length)
      await conn.query('DELETE FROM allocations WHERE id IN (?)', [others.map((r) => r.id)]);

    const anchors = rows.filter((r) => r.time_slot_id === anchorSlot);
    const mergeId = anchors[0].id;
    await conn.query(
      'UPDATE allocations SET merge_id = ?, merge_copy = 0 WHERE id IN (?)',
      [mergeId, anchors.map((r) => r.id)]
    );
    await syncMerge(conn, { date, program_id, batch_id, merge_id: mergeId }, slots);
    await conn.commit();
    res.json({ merge_id: mergeId, slots: slots.length, replaced: others.length });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// POST /api/allocations/unmerge { date, program_id, batch_id, merge_id }
// Splits a merged cell back into its slots. Each slot keeps its session, so
// the admin can clear or change the ones no longer wanted.
router.post('/unmerge', requireEditor, async (req, res) => {
  const { date, program_id, batch_id, merge_id } = req.body || {};
  if (!date || !program_id || !batch_id || !merge_id)
    return res.status(400).json({ error: 'date, program_id, batch_id and merge_id are required' });
  const [r] = await pool.query(
    `UPDATE allocations SET merge_id = NULL, merge_copy = 0
      WHERE alloc_date = ? AND program_id = ? AND batch_id = ? AND merge_id = ?`,
    [date, program_id, batch_id, merge_id]
  );
  res.json({ updated: r.affectedRows });
});

const fields = ['alloc_date', 'program_id', 'batch_id', 'activity_id',
  'time_slot_id', 'classroom_id', 'faculty_id', 'student_count', 'note',
  'text_color', 'bg_color', 'note_text_color', 'note_bg_color'];

const COLOUR_FIELDS = new Set(['text_color', 'bg_color', 'note_text_color', 'note_bg_color']);

// The highlight colours end up in a style attribute in the grid, so only a
// plain #rrggbb literal is ever stored; anything else becomes NULL (= no
// highlight, falling back to the activity's own colours).
const HEX = /^#[0-9a-f]{6}$/i;
function value(field, body) {
  const v = body[field] ?? null;
  if (!COLOUR_FIELDS.has(field)) return v;
  return typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : null;
}

// Email the tutor that a session is now theirs. Fire-and-forget: a mail problem
// (SMTP down, no address on file, email switched off) must never fail — or
// roll back — the allocation itself, so everything here is swallowed and logged.
// Pending requests are skipped: a session isn't really assigned until approved.
async function notifyAssigned(allocationId) {
  try {
    const settings = await getSettings();
    if (settings.smtp_enabled !== '1') return;          // email disabled in Settings
    const [[s]] = await pool.query(
      `SELECT a.alloc_date, a.note, f.name AS faculty_name, f.email,
              p.code AS program_code, b.name AS batch_name,
              ac.code AS activity_code, ac.name AS activity_name,
              ts.label AS slot_label, r.code AS room_code
         FROM allocations a
         JOIN faculty f      ON f.id = a.faculty_id
         JOIN programs p     ON p.id = a.program_id
         LEFT JOIN batches b ON b.id = a.batch_id
         LEFT JOIN activities ac ON ac.id = a.activity_id
         JOIN time_slots ts  ON ts.id = a.time_slot_id
         LEFT JOIN classrooms r ON r.id = a.classroom_id
        WHERE a.id = ? AND a.status = 'approved'`,
      [allocationId]
    );
    if (!s?.email) return;                              // no address on file
    const { subject, html, text } = sessionAssignedEmail(s.faculty_name, s, settings.app_title);
    await sendMail({ to: s.email, subject, html, text });
  } catch (e) {
    console.error(`[mail] assignment notice for allocation ${allocationId} failed:`, e.message);
  }
}

router.post('/', requireEditor, async (req, res) => {
  const vals = fields.map((f) => value(f, req.body));
  const [r] = await pool.query(
    `INSERT INTO allocations (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
    vals
  );
  // A session added to a merged cell (a co-teacher, an activity) joins the
  // merge, so it is copied across every slot the cell covers.
  if (req.body.batch_id && req.body.time_slot_id) {
    const [[m]] = await pool.query(
      `SELECT merge_id FROM allocations
        WHERE alloc_date = ? AND program_id = ? AND batch_id = ? AND time_slot_id = ?
          AND merge_id IS NOT NULL AND merge_copy = 0 AND id <> ? LIMIT 1`,
      [req.body.alloc_date, req.body.program_id, req.body.batch_id, req.body.time_slot_id, r.insertId]
    );
    if (m) {
      await pool.query('UPDATE allocations SET merge_id = ? WHERE id = ?', [m.merge_id, r.insertId]);
      const [[row]] = await pool.query('SELECT * FROM allocations WHERE id = ?', [r.insertId]);
      await resyncFor(row);
    }
  }
  res.json({ id: r.insertId });
  if (req.body.faculty_id) notifyAssigned(r.insertId);  // after responding
});

router.put('/:id', requireEditor, async (req, res) => {
  const sets = fields.filter((f) => f in req.body);
  if (!sets.length) return res.json({ ok: true });

  // Only a *change* of tutor is an assignment. Dragging a session around the
  // grid never sends faculty_id, so a move can't spam the same tutor.
  const [[before]] = await pool.query('SELECT * FROM allocations WHERE id = ?', [req.params.id]);
  const previousFaculty = before?.faculty_id ?? null;

  await pool.query(
    `UPDATE allocations SET ${sets.map((f) => `${f}=?`).join(',')} WHERE id=?`,
    [...sets.map((f) => value(f, req.body)), req.params.id]
  );
  // An edit to a merged cell reaches all its slots. A session moved out of
  // its cell leaves the merge (and the merge drops the copies it had).
  if (before?.merge_id) {
    const moved = ['alloc_date', 'program_id', 'batch_id', 'time_slot_id'].some(
      (f) => f in req.body && String(req.body[f] ?? '') !== String(before[f] ?? ''));
    if (moved)
      await pool.query('UPDATE allocations SET merge_id = NULL, merge_copy = 0 WHERE id = ?', [req.params.id]);
    await resyncFor(before);
  }
  res.json({ ok: true });

  const nowFaculty = req.body.faculty_id ?? null;
  if (nowFaculty && Number(nowFaculty) !== Number(previousFaculty))
    notifyAssigned(req.params.id);
});

// DELETE /api/allocations?date=YYYY-MM-DD[&program_id=] — clear a whole
// day's table (for one program when program_id is given).
router.delete('/', requireEditor, async (req, res) => {
  const { date, program_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });
  const params = [date];
  let sql = 'DELETE FROM allocations WHERE alloc_date = ?';
  if (program_id) { sql += ' AND program_id = ?'; params.push(program_id); }
  const [r] = await pool.query(sql, params);
  res.json({ deleted: r.affectedRows });
});

router.delete('/:id', requireEditor, async (req, res) => {
  const [[row]] = await pool.query('SELECT * FROM allocations WHERE id = ?', [req.params.id]);
  await pool.query('DELETE FROM allocations WHERE id = ?', [req.params.id]);
  // Clearing a merged cell clears it in every slot it covers.
  await resyncFor(row);
  res.json({ ok: true });
});

export default router;
