// Knowledge Base (admin only): the library of reference day-sheets the
// timetable generator is trained on. An admin uploads the academy's .docx
// sheets here; "Generate" on the Timetable then rebuilds an empty day from the
// sheet whose weekday matches, instead of copying whichever earlier day came
// last. See db/migrate-kb.js for the storage model.
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { readTablesFromXml } from '../import/docx-table.js';
import { parseDocxSheets, insertAllocations } from '../import/parse-docx.js';
import {
  insertDocument, seedFromFolder, sheetXml, recountDocument, WEEKDAY_NAMES,
} from '../db/migrate-kb.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const LIST_COLS = `id, title, filename, weekday, sheet_date, size_bytes,
                   session_count, parse_error, uploaded_by, created_at`;

// A .docx is a ZIP: reject anything else before it reaches the parser, so a
// mis-picked PDF fails with a clear message rather than "Not a zip file".
function assertDocx(buf, filename) {
  if (!/\.docx$/i.test(filename)) throw new Error('Only .docx sheets can be added');
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b)
    throw new Error('That file is not a readable .docx');
}

async function loadDoc(id) {
  const [[row]] = await pool.query('SELECT * FROM kb_documents WHERE id = ?', [id]);
  return row || null;
}

// Parse a stored sheet against the live reference data. `dry` keeps it from
// creating tutors/rooms/batches the sheet mentions but the database lacks —
// used for counting and previewing, never for applying.
async function parseDoc(row, date, { dry = true } = {}) {
  const { allocations } = await parseDocxSheets(
    [{ label: row.filename, date, xml: sheetXml(row) }],
    { dry }
  );
  return allocations;
}

// GET /api/knowledge — the library, in weekday order (sheets that aren't filed
// under a day sort last), newest first within a day.
router.get('/', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT ${LIST_COLS} FROM kb_documents ORDER BY weekday IS NULL, weekday, created_at DESC`
  );
  res.json(rows.map((r) => ({
    ...r,
    weekday_name: r.weekday == null ? null : WEEKDAY_NAMES[r.weekday],
  })));
});

// POST /api/knowledge { filename, title?, content } — content is the .docx as a
// base64 string (or a data: URL, which is what a browser FileReader produces).
router.post('/', async (req, res) => {
  const { filename, title, content } = req.body || {};
  if (!filename || !content)
    return res.status(400).json({ error: 'A filename and file content are required' });

  const base64 = String(content).includes(',')
    ? String(content).slice(String(content).indexOf(',') + 1)
    : String(content);
  const buf = Buffer.from(base64, 'base64');
  try {
    assertDocx(buf, filename);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  let id;
  try {
    id = await insertDocument(pool, {
      filename,
      title: (title || filename.replace(/\.docx$/i, '')).slice(0, 160),
      content: buf,
      uploaded_by: req.user.id,
    });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'A sheet with that filename is already in the Knowledge Base' });
    throw e;
  }

  await recountDocument(pool, id);
  const [[row]] = await pool.query(`SELECT ${LIST_COLS} FROM kb_documents WHERE id = ?`, [id]);
  res.status(201).json({ ...row, weekday_name: row.weekday == null ? null : WEEKDAY_NAMES[row.weekday] });
});

// PUT /api/knowledge/:id — rename, or re-file under a different weekday.
router.put('/:id', async (req, res) => {
  const { title, weekday } = req.body || {};
  const patch = [];
  const params = [];
  if (typeof title === 'string' && title.trim()) {
    patch.push('title = ?');
    params.push(title.trim().slice(0, 160));
  }
  if ('weekday' in (req.body || {})) {
    const w = weekday === null || weekday === '' ? null : Number(weekday);
    if (w !== null && !(Number.isInteger(w) && w >= 0 && w <= 6))
      return res.status(400).json({ error: 'Weekday must be 0 (Sunday) to 6 (Saturday)' });
    patch.push('weekday = ?');
    params.push(w);
  }
  if (!patch.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  await pool.query(`UPDATE kb_documents SET ${patch.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true });
});

// GET /api/knowledge/:id/preview — the sheet as the parser sees it: the raw
// tables (so the admin can check the grid read correctly) plus the sessions it
// would create, resolved to names. Nothing is written.
router.get('/:id/preview', async (req, res) => {
  const row = await loadDoc(req.params.id);
  if (!row) return res.status(404).json({ error: 'Sheet not found' });

  let tables = [];
  let allocations = [];
  let error = null;
  try {
    tables = readTablesFromXml(sheetXml(row)).map((t) =>
      t.map((cells) => cells.map((c) => ({ text: c.text, span: c.span })))
    );
    allocations = await parseDoc(row, row.sheet_date || '2000-01-01');
  } catch (e) {
    error = e.message;
  }

  res.json({
    document: { ...pickMeta(row), weekday_name: row.weekday == null ? null : WEEKDAY_NAMES[row.weekday] },
    tables,
    sessions: await labelSessions(allocations),
    error,
  });
});

const pickMeta = (r) => ({
  id: r.id, title: r.title, filename: r.filename, weekday: r.weekday,
  sheet_date: r.sheet_date, size_bytes: r.size_bytes,
  session_count: r.session_count, parse_error: r.parse_error, created_at: r.created_at,
});

// Turn parsed rows into something readable. A dry parse invents negative ids for
// reference rows the sheet needs but the database lacks; those show as "new",
// which is exactly what applying the sheet would create.
async function labelSessions(allocations) {
  if (!allocations.length) return [];
  const [progs] = await pool.query('SELECT id, code FROM programs');
  const [slots] = await pool.query('SELECT id, label FROM time_slots');
  const [acts] = await pool.query('SELECT id, code FROM activities');
  const [facs] = await pool.query('SELECT id, name FROM faculty');
  const [rooms] = await pool.query('SELECT id, code FROM classrooms');
  const [batches] = await pool.query('SELECT id, name FROM batches');
  const map = (rows, key) => new Map(rows.map((r) => [r.id, r[key]]));
  const name = (m, id) => (id == null ? null : m.get(id) ?? '(new)');
  const P = map(progs, 'code'), S = map(slots, 'label'), A = map(acts, 'code');
  const F = map(facs, 'name'), R = map(rooms, 'code'), B = map(batches, 'name');
  return allocations.map((a) => ({
    program: name(P, a.program_id),
    batch: name(B, a.batch_id),
    slot: name(S, a.time_slot_id),
    activity: name(A, a.activity_id),
    faculty: name(F, a.faculty_id),
    room: name(R, a.classroom_id),
    raw_text: a.raw_text,
  }));
}

// POST /api/knowledge/:id/apply { date, program_id?, replace? }
// Build a real day from this sheet. Refuses a day that already has sessions
// unless `replace` is set, so it can't quietly double up an existing timetable.
router.post('/:id/apply', async (req, res) => {
  const { date, program_id, replace } = req.body || {};
  if (!date) return res.status(400).json({ error: 'A date is required' });
  const row = await loadDoc(req.params.id);
  if (!row) return res.status(404).json({ error: 'Sheet not found' });

  const created = await applySheet(row, { date, program_id, replace });
  if (created.error) return res.status(created.status || 400).json({ error: created.error });
  res.json(created);
});

// Shared by the route above and the Timetable's Generate button.
export async function applySheet(row, { date, program_id = null, replace = false }) {
  const progFilter = program_id ? ' AND program_id = ?' : '';
  const progParams = program_id ? [program_id] : [];

  const [[existing]] = await pool.query(
    `SELECT COUNT(*) AS n FROM allocations WHERE alloc_date = ?${progFilter}`,
    [date, ...progParams]
  );
  if (existing.n && !replace)
    return { status: 409, error: 'That day already has sessions' };

  let allocations;
  try {
    allocations = await parseDoc(row, date, { dry: false });
  } catch (e) {
    return { status: 400, error: `Could not read "${row.filename}": ${e.message}` };
  }
  if (program_id) allocations = allocations.filter((a) => a.program_id === Number(program_id));
  if (!allocations.length)
    return { status: 400, error: 'That sheet has no sessions for this program' };

  if (existing.n) {
    await pool.query(
      `DELETE FROM allocations WHERE alloc_date = ?${progFilter}`,
      [date, ...progParams]
    );
  }
  await insertAllocations(allocations);
  return { created: allocations.length, source: 'knowledge-base', sheet: row.title };
}

// The sheets to try when building `date`, best first: those filed under that
// weekday, then sheets filed under no weekday (e.g. a program's own sheet that
// holds for every day), then — for a weekday with no sheet of its own — the
// other day sheets, so the latest uploaded timetable still beats copying an old
// day. Most recently added first within each group. The caller takes the first
// that has sessions for the program, and falls back to copying an earlier day
// when none does.
export async function sheetsForDate(date) {
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const [rows] = await pool.query(
    `SELECT * FROM kb_documents
      WHERE parse_error IS NULL AND session_count > 0
      ORDER BY CASE WHEN weekday = ? THEN 0 WHEN weekday IS NULL THEN 1 ELSE 2 END,
               created_at DESC, id DESC`,
    [weekday]
  );
  return rows;
}

// POST /api/knowledge/reseed — reload the sheets shipped in the repo's
// "Knowledge Base" folder (skipping any already stored).
router.post('/reseed', async (_req, res) => {
  const added = await seedFromFolder(pool);
  res.json({ added });
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM kb_documents WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

export default router;
