// Parses the daily timetable .docx files in ../data into the `allocations`
// table. Files are named "<WEEKDAY> <DD>.docx" (e.g. "MONDAY 22.docx"); they are
// discovered automatically and their full dates resolved (see resolveDate), so a
// fresh set of sheets can simply be dropped into data/ without editing this file.
// Run with `--dry` to preview parsed rows without writing to the DB.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { readTablesFromXml } from './docx-table.js';
import AdmZipLike from './unzip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');

// The academy's sheets are named by weekday + day-of-month only ("MONDAY 22"),
// carrying no month or year. We resolve the month by searching outward from an
// anchor for the calendar month whose DDth actually falls on the named weekday —
// which fills in the month AND validates the filename. The anchor defaults to
// June 2026 (the current season) and can be overridden with the IMPORT_YEAR /
// IMPORT_MONTH env vars for a set that has rolled into a new month or year.
const IMPORT_YEAR = Number(process.env.IMPORT_YEAR) || 2026;
const ANCHOR_MONTH = Number(process.env.IMPORT_MONTH) || 6; // June

const WEEKDAYS = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

// "MONDAY 22.docx" -> "2026-06-22". Returns null for files that aren't weekday
// sheets (so stray .docx in data/ are ignored). Throws if a weekday sheet's day
// doesn't land on that weekday in any month near the anchor.
export function resolveDate(filename) {
  const m = filename
    .toUpperCase()
    .match(/\b(SUN|MON|TUE|WED|THU|FRI|SAT)[A-Z]*\b[^0-9]*(\d{1,2})\b/);
  if (!m) return null;
  const wanted = WEEKDAYS[m[1]];
  const day = Number(m[2]);
  // search order: anchor month, then +1, -1, +2, -2, ... up to ±6 months
  for (let k = 0; k <= 6; k++) {
    for (const off of k === 0 ? [0] : [k, -k]) {
      let month = ANCHOR_MONTH + off;
      let year = IMPORT_YEAR;
      while (month < 1) { month += 12; year--; }
      while (month > 12) { month -= 12; year++; }
      const d = new Date(Date.UTC(year, month - 1, day));
      if (d.getUTCMonth() === month - 1 && d.getUTCDay() === wanted) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }
  throw new Error(
    `Cannot resolve a date for "${filename}": no month near ${IMPORT_YEAR}-` +
    `${String(ANCHOR_MONTH).padStart(2, '0')} has day ${day} on a ${m[1]}. ` +
    `Set IMPORT_YEAR / IMPORT_MONTH if this set is for a different period.`
  );
}

// The weekday a sheet is named for, 0 = Sunday, or null when the filename
// names none. Unlike resolveDate this never throws, so a Knowledge Base sheet
// whose day-of-month doesn't line up is still filed under the right weekday.
export function weekdayFromName(filename) {
  const m = filename.toUpperCase().match(/\b(SUN|MON|TUE|WED|THU|FRI|SAT)[A-Z]*\b/);
  return m ? WEEKDAYS[m[1]] : null;
}

// Discover every "<WEEKDAY> <DD>.docx" in data/, mapped filename -> ISO date,
// ordered by date.
function discoverFileDates() {
  const dated = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.toLowerCase().endsWith('.docx'))
    .map((f) => ({ file: f, date: resolveDate(f) }))
    .filter((x) => x.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  return Object.fromEntries(dated.map(({ file, date }) => [file, date]));
}

// ---- text helpers ---------------------------------------------------------
function visibleText(xmlChunk) {
  return [...xmlChunk.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => m[1])
    .join(' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

// Determine which program each table belongs to, using the title paragraphs
// that sit between tables in document order.
function detectProgramsFromXml(xml) {
  const parts = xml.split('<w:tbl>');
  const result = [];
  // parts[0] = text before table0; parts[i] (i>=1) starts with table i-1's body.
  // The title for table i sits in the text AFTER table i-1 closes.
  let preText = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const after = parts[i].split('</w:tbl>');
    const beforeTable = preText; // text preceding this table
    result.push(classifyProgram(visibleText(beforeTable)));
    preText = after[1] || ''; // text between this table and the next
  }
  return result;
}

function classifyProgram(titleText) {
  const t = titleText.toUpperCase();
  // pick the LAST keyword mentioned (closest to the table)
  const markers = [
    ['GERMAN', 'GERMAN'],
    ['FLUENCY', 'FLUENCY'],
    ['IELTS', 'IELTS'],
    ['PTE', 'IELTS'],
    ['OET', 'OET'],
  ];
  let best = null;
  let bestIdx = -1;
  for (const [kw, prog] of markers) {
    const idx = t.lastIndexOf(kw);
    if (idx > bestIdx) {
      bestIdx = idx;
      best = prog;
    }
  }
  return best || 'OET';
}

const MONTHS = {
  JAN: 'January', FEB: 'Feb', MAR: 'March', APR: 'April', MAY: 'May',
  JUN: 'June', JUNE: 'June', JUL: 'July', JULY: 'July',
};

function extractRoom(text) {
  const m = text.match(/\(\s*([A-Da-d]\s?\d[0-9]?(?:\s*-\s*\w+)?)\s*\)/);
  if (!m) return null;
  return m[1].replace(/\s+/g, '').toUpperCase();
}

function extractCount(label) {
  const m = label.match(/\((\d+)\)/); // (24), (8) etc = student count in batch label
  return m ? Number(m[1]) : null;
}

function extractMonth(label) {
  const t = label.toUpperCase();
  for (const k of Object.keys(MONTHS)) {
    if (t.includes(k)) return MONTHS[k];
  }
  if (/EXAM/.test(t)) return 'Exam';
  return null;
}

// Turn already-loaded sheets into allocation rows, without writing any of them.
// `sheets` is [{ label, xml, date }] where `xml` is the sheet's
// word/document.xml and `date` the ISO date the sessions belong to. The same
// code backs both the data/ import and the Knowledge Base (whose sheets live as
// blobs in the database), so a KB sheet is read exactly like an imported one.
//
// Reference rows the sheets mention but the database lacks (a tutor, a room, a
// batch) are created as a side effect, unless { dry: true } is passed.
export async function parseDocxSheets(sheets, { dry: DRY = false } = {}) {
  const conn = await pool.getConnection();
  try {
    return await parseWithConn(conn, sheets, DRY);
  } finally {
    conn.release();
  }
}

async function parseWithConn(conn, sheets, DRY) {
  // Lookups
  const [progRows] = await conn.query('SELECT id, code FROM programs');
  const progByCode = Object.fromEntries(progRows.map((p) => [p.code, p.id]));

  const [slotRows] = await conn.query(
    `SELECT id, program_id, label, sort_order, start_time, end_time
       FROM time_slots ORDER BY program_id, sort_order`
  );
  const slotsByProg = {};
  for (const s of slotRows) (slotsByProg[s.program_id] ??= []).push(s);

  const [actRows] = await conn.query('SELECT id, code, name FROM activities');
  // longest codes first so "A R E" beats "A R" beats "R"
  const activities = actRows
    .map((a) => ({ ...a, up: a.code.toUpperCase() }))
    .sort((a, b) => b.up.length - a.up.length);

  const [facRows] = await conn.query('SELECT id, name FROM faculty');
  const facById = new Map();
  const facByUpper = new Map();
  for (const f of facRows) {
    facById.set(f.id, f.name);
    facByUpper.set(f.name.toUpperCase(), f.id);
  }
  // alias
  facByUpper.set('SUCHITRA', facByUpper.get('SUCHITHRA'));

  const [roomRows] = await conn.query('SELECT id, code FROM classrooms');
  const roomByCode = new Map(roomRows.map((r) => [r.code.toUpperCase(), r.id]));

  const [batchRows] = await conn.query(
    'SELECT id, name, program_id, student_count, home_room_id, exam_month FROM batches'
  );

  // --- on-the-fly creators (cache; in dry mode just fabricate negative ids)
  let fakeId = -1;
  const newFaculty = [], newRooms = [], newActs = [], newBatches = [];

  async function getFacultyId(nameUpper) {
    if (facByUpper.has(nameUpper)) return facByUpper.get(nameUpper);
    const name = nameUpper.charAt(0) + nameUpper.slice(1).toLowerCase();
    let id;
    if (DRY) id = fakeId--;
    else {
      const [r] = await conn.query('INSERT INTO faculty (name) VALUES (?)', [name]);
      id = r.insertId;
    }
    facByUpper.set(nameUpper, id);
    newFaculty.push(name);
    return id;
  }
  async function getRoomId(code) {
    if (!code) return null;
    const up = code.toUpperCase();
    if (roomByCode.has(up)) return roomByCode.get(up);
    let id;
    if (DRY) id = fakeId--;
    else {
      const [r] = await conn.query('INSERT INTO classrooms (code, capacity) VALUES (?, 0)', [up]);
      id = r.insertId;
    }
    roomByCode.set(up, id);
    newRooms.push(up);
    return id;
  }
  function matchActivity(text) {
    const up = text.toUpperCase().trimStart();
    for (const a of activities) {
      if (up.startsWith(a.up)) return a.id;
    }
    return null;
  }

  const batchCache = new Map(); // key: prog|label -> id
  async function getBatchId(programId, label) {
    const key = programId + '|' + label;
    if (batchCache.has(key)) return batchCache.get(key);
    const room = extractRoom(label) || roomFromBareCode(label);
    const month = extractMonth(label);
    const roomId = room ? roomByCode.get(room) : null;
    // try to match a seeded batch by program + room + month
    let found = batchRows.find(
      (b) =>
        b.program_id === programId &&
        roomId && b.home_room_id === roomId &&
        month && (b.exam_month || '').toUpperCase().startsWith(month.toUpperCase())
    );
    if (!found)
      found = batchRows.find(
        (b) => b.program_id === programId && roomId && b.home_room_id === roomId
      );
    if (found) {
      batchCache.set(key, found.id);
      return found.id;
    }
    // create a new batch reflecting the sheet
    const name = label.replace(/\s+/g, ' ').trim().slice(0, 120);
    const count = extractCount(label);
    let id;
    if (DRY) id = fakeId--;
    else {
      const [r] = await conn.query(
        'INSERT INTO batches (name, program_id, student_count, home_room_id, exam_month) VALUES (?, ?, ?, ?, ?)',
        [name, programId, count || 0, roomId || null, month]
      );
      id = r.insertId;
    }
    batchRows.push({ id, name, program_id: programId, home_room_id: roomId, exam_month: month });
    newBatches.push(name);
    batchCache.set(key, id);
    return id;
  }

  // a bare room code at end of a batch label e.g. "APR 1 (8)A4"
  function roomFromBareCode(label) {
    const m = label.toUpperCase().match(/\b([ABCD]\d)\b\s*$/);
    return m ? m[1] : null;
  }

  function parseFaculty(text) {
    const ids = [];
    const up = text.toUpperCase();
    for (const [name, id] of facByUpper) {
      if (id && new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(up)) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
    return ids;
  }

  // ---- German ---------------------------------------------------------------
  // The German sheet is laid out by tutor, not by batch, and its columns don't
  // line up with the German slot grid: the header carries blank spacer columns,
  // the afternoon block has its own "tutor" column in front of the 2.00-5.00
  // cell, and a mid-table sub-header row ("9:30-11.15 | 11:00-12:00 | …")
  // re-times the columns for the rows beneath it. So columns are mapped onto
  // slots by the times written in the header, and each session is filed under
  // the German level it teaches (A1, A2, B1, B2 …) so the grid gets one row per
  // level, with every tutor on that class listed in the cell.
  const allAllocs = [];
  const sample = [];

  const actById = new Map(activities.map((a) => [a.id, a.up]));
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const toMin = (t) => {
    if (t == null) return null;
    const [h, m] = String(t).split(':').map(Number);
    return Number.isFinite(h) ? h * 60 + (m || 0) : null;
  };
  const cellText = (c) => (c?.lines.join(' ') || '').replace(/\s+/g, ' ').trim();

  // "9.15-11.15", "11:00-12:00", "11.15 -11.30" -> minutes since midnight.
  // The sheet writes afternoon hours as 1-7, so those are pm.
  function parseRange(text) {
    const m = String(text).replace(/\s+/g, '')
      .match(/^(\d{1,2})[.:](\d{2})-(\d{1,2})[.:](\d{2})$/);
    if (!m) return null;
    const at = (h, mi) => { h = Number(h); return (h < 8 ? h + 12 : h) * 60 + Number(mi); };
    return { start: at(m[1], m[2]), end: at(m[3], m[4]), label: `${m[1]}.${m[2]}-${m[3]}.${m[4]}` };
  }

  // The slot a sheet column belongs to: the one it overlaps most.
  function slotForRange(range, slots) {
    let best = null;
    let bestOverlap = 0;
    for (const s of slots) {
      const a = toMin(s.start_time), b = toMin(s.end_time);
      if (a == null || b == null) continue;
      const overlap = Math.min(b, range.end) - Math.max(a, range.start);
      if (overlap > bestOverlap) { bestOverlap = overlap; best = s; }
    }
    return best || slots.find((s) => parseRange(s.label)?.label === range.label) || null;
  }

  // Grid position -> { slot, range } for a header row. A column whose header
  // isn't a time is null (a spacer, or the afternoon tutor column). `base` is
  // the mapping a sub-header refines: columns it leaves blank keep theirs.
  function columnMap(cells, slots, base = null) {
    const map = base ? [...base] : [];
    let pos = 0;
    for (let ci = 0; ci < cells.length; ci++) {
      const span = cells[ci].span || 1;
      const range = ci === 0 ? null : parseRange(cellText(cells[ci]));
      const slot = range ? slotForRange(range, slots) : null;
      for (let k = 0; k < span; k++) {
        if (slot) map[pos + k] = { slot, range };
        else if (!base) map[pos + k] = null;
      }
      pos += span;
    }
    return map;
  }

  const NOT_A_TUTOR = new Set(['TUTOR', 'NAME', 'AND', 'VIDEO', 'BREAK', 'LUNCH']);
  // Every tutor named in a cell ("HARIJA SNEHA", "ATHUL,SNEHA | ADITHYA"), in
  // the order the sheet lists them so the first-named tutor leads the cell:
  // known faculty by name, and each remaining word as a tutor to create.
  async function tutorsIn(text) {
    const up = text.toUpperCase();
    const found = [];                       // [position in text, faculty id]
    let rest = up;
    for (const id of parseFaculty(text)) {
      for (const [name, fid] of facByUpper) {
        if (fid !== id) continue;
        const re = new RegExp('\\b' + escapeRe(name) + '\\b', 'g');
        const m = re.exec(up);
        if (!m) continue;
        found.push([m.index, id]);
        rest = rest.replace(new RegExp('\\b' + escapeRe(name) + '\\b', 'g'), (s) => ' '.repeat(s.length));
        break;
      }
    }
    for (const m of rest.matchAll(/[A-Z]+/g)) {
      if (m[0].length < 3 || NOT_A_TUTOR.has(m[0])) continue;
      found.push([m.index, await getFacultyId(m[0])]);
    }
    const ids = [];
    for (const [, id] of found.sort((a, b) => a[0] - b[0])) if (!ids.includes(id)) ids.push(id);
    return ids;
  }

  const levelOf = (text) => (text.toUpperCase().match(/\b([ABC][12])\b/) || [])[1] || null;

  // The German batch for a level: an existing one whose name carries it
  // ("German A1 (Morning)"), or a new "German A1".
  async function germanBatchId(programId, level) {
    if (!level) return null;
    const key = programId + '|level|' + level;
    if (batchCache.has(key)) return batchCache.get(key);
    const re = new RegExp('\\b' + level + '\\b', 'i');
    const found = batchRows
      .filter((b) => b.program_id === programId && re.test(b.name))
      .sort((a, b) => a.name.length - b.name.length)[0];
    let id = found?.id;
    if (!found) {
      const name = `German ${level}`;
      if (DRY) id = fakeId--;
      else {
        const [r] = await conn.query(
          'INSERT INTO batches (name, program_id, student_count, home_room_id, exam_month) VALUES (?, ?, 0, NULL, NULL)',
          [name, programId]
        );
        id = r.insertId;
      }
      batchRows.push({ id, name, program_id: programId, home_room_id: null, exam_month: null });
      newBatches.push(name);
    }
    batchCache.set(key, id);
    return id;
  }

  async function parseGermanTable(rows, programId, slots, isoDate) {
    let colMap = columnMap(rows[0] || [], slots);
    for (let ri = 1; ri < rows.length; ri++) {
      const cells = rows[ri];
      if (!cells.length) continue;
      const label = cellText(cells[0]);
      const texts = cells.map(cellText);

      // a sub-header re-times the columns for the rows below it
      if (!label && texts.slice(1).some((t) => parseRange(t))) {
        colMap = columnMap(cells, slots, colMap);
        continue;
      }
      if (/^(SHOOT|LIVE|ONLINE|DEMO|INTERVIEW|MEETING|PRE|CON|BREAK|LUNCH|VIDEO)/i.test(label))
        continue;

      let tutors = label ? await tutorsIn(label) : [];
      // a cell that names no level (LISTENING, READING …) teaches the row's level
      const rowLevel = texts.slice(1).map(levelOf).find(Boolean) || null;

      let pos = 0;
      for (let ci = 0; ci < cells.length; ci++) {
        const at = pos;
        pos += cells[ci].span || 1;
        const text = texts[ci];
        if (ci === 0 || !text) continue;
        if (/^(BREAK|LUNCH BREAK|LUNCH)$/i.test(text)) continue;

        const col = colMap[at];
        if (!col) {                        // the afternoon tutor column
          tutors = await tutorsIn(text);
          continue;
        }

        const activityId = matchActivity(text);
        const code = activityId ? actById.get(activityId) : null;
        // what the session is, minus a leading activity code the grid already shows
        const detail = code
          ? text.replace(new RegExp('^' + escapeRe(code) + '\\b\\s*', 'i'), '')
          : text;
        // a column the sub-header re-timed keeps its real time in the note
        const retimed = col.range.start !== toMin(col.slot.start_time)
          || col.range.end !== toMin(col.slot.end_time);
        const note = [retimed ? col.range.label : null, detail].filter(Boolean).join(' ') || null;
        const batchId = await germanBatchId(programId, levelOf(text) || rowLevel);

        for (const facultyId of tutors.length ? tutors : [null]) {
          allAllocs.push({
            alloc_date: isoDate,
            program_id: programId,
            batch_id: batchId,
            activity_id: activityId,
            time_slot_id: col.slot.id,
            classroom_id: null,
            faculty_id: facultyId,
            student_count: null,
            raw_text: text.slice(0, 255),
            note: note ? note.slice(0, 255) : null,
          });
        }
      }
    }
  }

  // ---- gather allocations ------------------------------------------------

  for (const sheet of sheets) {
    const isoDate = sheet.date;
    const tables = readTablesFromXml(sheet.xml);
    const progs = detectProgramsFromXml(sheet.xml);

    for (let ti = 0; ti < tables.length; ti++) {
      const rows = tables[ti];
      const progCode = progs[ti] || 'OET';
      const programId = progByCode[progCode];
      const slots = slotsByProg[programId] || [];
      if (!slots.length) continue;
      if (progCode === 'GERMAN') {
        await parseGermanTable(rows, programId, slots, isoDate);
        continue;
      }

      // The new standard grid dropped the historical "1.10-2.00" column (an
      // always-empty lunch slot). The docx files still carry it, so locate it
      // in this table's header and skip it when mapping columns onto slots,
      // keeping the remaining columns aligned. (German grid is unchanged.)
      let droppedColIndex = -1; // session-column index (0-based) to skip
      if (progCode !== 'GERMAN') {
        const header = rows[0] || [];
        let hc = 0;
        for (let ci = 0; ci < header.length; ci++) {
          const span = header[ci].span || 1;
          if (ci === 0) { hc += span; continue; }
          // strip ALL whitespace: some tables label it "1.10- 2.00"
          const hl = (header[ci].lines.join('') || '').replace(/\s+/g, '');
          if (hl === '1.10-2.00') { droppedColIndex = hc - 1; break; }
          hc += span;
        }
      }

      // data rows start after the header row (row 0)
      for (let ri = 1; ri < rows.length; ri++) {
        const cells = rows[ri];
        if (!cells.length) continue;
        const label = (cells[0].lines.join(' ') || '').replace(/\s+/g, ' ').trim();
        if (!label) continue;

        const batchId = await getBatchId(programId, label);

        // walk columns honouring gridSpan
        let col = 0;
        for (let ci = 0; ci < cells.length; ci++) {
          const cell = cells[ci];
          const span = cell.span || 1;
          if (ci === 0) { col += span; continue; } // batch / tutor column
          let slotIndex = col - 1;
          col += span;
          if (droppedColIndex >= 0) {
            if (slotIndex === droppedColIndex) continue;     // dropped lunch column
            if (slotIndex > droppedColIndex) slotIndex -= 1; // shift later columns left
          }
          const slot = slots[slotIndex];
          const cellText = cell.lines.join(' ').replace(/\s+/g, ' ').trim();
          if (!cellText || !slot) continue;
          if (/^(BREAK|LUNCH BREAK|LUNCH)$/i.test(cellText)) continue;

          const room = extractRoom(cellText);
          const roomId = await getRoomId(room);
          const facIds = parseFaculty(cellText);
          const facultyId = facIds[0] || null;
          const activityId = matchActivity(cellText);

          const alloc = {
            alloc_date: isoDate,
            program_id: programId,
            batch_id: batchId,
            activity_id: activityId,
            time_slot_id: slot.id,
            classroom_id: roomId,
            faculty_id: facultyId,
            student_count: null,
            raw_text: cellText.slice(0, 255),
            note: facIds.length > 1 ? 'faculty: ' + facIds.map((i) => facById.get(i) || i).join(', ') : null,
          };
          allAllocs.push(alloc);
          if (sample.length < 12 && progCode !== 'FLUENCY')
            sample.push({ date: isoDate, prog: progCode, batch: label.slice(0, 22), slot: slot.label, raw: cellText.slice(0, 40), room, fac: facIds.map((i) => facById.get(i)) });
        }
      }
    }
  }

  return { allocations: allAllocs, sample, newFaculty, newRooms, newBatches };
}

// Columns written for a parsed session, shared by the data/ import and the
// Knowledge Base "apply to a day" action.
export const ALLOC_COLS = ['alloc_date', 'program_id', 'batch_id', 'activity_id',
  'time_slot_id', 'classroom_id', 'faculty_id', 'student_count', 'raw_text', 'note'];

// Insert parsed rows in chunks (a full day is a few hundred sessions).
export async function insertAllocations(rows, conn = pool) {
  const values = rows.map((a) => ALLOC_COLS.map((c) => a[c]));
  for (let i = 0; i < values.length; i += 200) {
    await conn.query(
      `INSERT INTO allocations (${ALLOC_COLS.join(',')}) VALUES ?`,
      [values.slice(i, i + 200)]
    );
  }
  return rows.length;
}

// Parse the daily .docx files in data/ into `allocations`. Pass { dry: true }
// to preview without writing. Returns the number of allocations inserted.
export async function importDocx({ dry: DRY = false } = {}) {
  const FILE_DATES = discoverFileDates();
  const found = Object.entries(FILE_DATES);
  if (!found.length) {
    throw new Error(`No "<WEEKDAY> <DD>.docx" timetable files found in ${DATA_DIR}`);
  }
  console.log(`Discovered ${found.length} timetable file(s) in data/:`);
  for (const [file, date] of found) console.log(`  ${date}  ${file}`);

  const sheets = [];
  for (const [file, date] of found) {
    const full = path.join(DATA_DIR, file);
    if (!fs.existsSync(full)) {
      console.warn('  (missing) ' + file);
      continue;
    }
    sheets.push({ label: file, date, xml: AdmZipLike.readEntry(full, 'word/document.xml') });
  }

  const { allocations, sample, newFaculty, newRooms, newBatches } =
    await parseDocxSheets(sheets, { dry: DRY });

  console.log(`\nParsed ${allocations.length} allocations across ${sheets.length} files.`);
  console.log('Sample (OET/IELTS sessions):');
  console.table(sample);
  console.log('New faculty created:', newFaculty);
  console.log('New rooms created  :', newRooms);
  console.log('New batches created:', newBatches.length);

  if (DRY) {
    console.log('\n--dry: nothing written.');
    return 0;
  }

  // wipe existing allocations for these dates, then insert
  const dates = sheets.map((s) => s.date);
  await pool.query('DELETE FROM allocations WHERE alloc_date IN (?)', [dates]);
  await insertAllocations(allocations);
  console.log(`Inserted ${allocations.length} allocations.`);
  return allocations.length;
}

// CLI entry point: `node import/parse-docx.js [--dry]`
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('import/parse-docx.js')) {
  importDocx({ dry: process.argv.includes('--dry') })
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
