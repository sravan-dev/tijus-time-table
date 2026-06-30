// Parses the 7 daily timetable .docx files into the `allocations` table.
// Run with `--dry` to preview parsed rows without writing to the DB.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { readTables } from './docx-table.js';
import AdmZipLike from './unzip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');

// filename -> ISO date (all files are June 2026)
const FILE_DATES = {
  'MONDAY 8.docx': '2026-06-08',
  'TUESDAY 9.docx': '2026-06-09',
  'WEDNESDAY 10.docx': '2026-06-10',
  'THURSDAY 11.docx': '2026-06-11',
  'FRIDAY 12.docx': '2026-06-12',
  'MONDAY 15.docx': '2026-06-15',
  'TUESDAY 16.docx': '2026-06-16',
};

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
function detectProgramsPerTable(docxPath) {
  const xml = AdmZipLike.readEntry(docxPath, 'word/document.xml');
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

// Parse the daily .docx files into `allocations`. Pass { dry: true } to
// preview without writing. Returns the number of allocations inserted.
export async function importDocx({ dry: DRY = false } = {}) {
  const conn = await pool.getConnection();

  // Lookups
  const [progRows] = await conn.query('SELECT id, code FROM programs');
  const progByCode = Object.fromEntries(progRows.map((p) => [p.code, p.id]));

  const [slotRows] = await conn.query(
    'SELECT id, program_id, label, sort_order FROM time_slots ORDER BY program_id, sort_order'
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

  // ---- gather allocations ------------------------------------------------
  const allAllocs = [];
  const sample = [];

  for (const [file, isoDate] of Object.entries(FILE_DATES)) {
    const full = path.join(DATA_DIR, file);
    if (!fs.existsSync(full)) {
      console.warn('  (missing) ' + file);
      continue;
    }
    const tables = readTables(full);
    const progs = detectProgramsPerTable(full);

    for (let ti = 0; ti < tables.length; ti++) {
      const rows = tables[ti];
      const progCode = progs[ti] || 'OET';
      const programId = progByCode[progCode];
      const slots = slotsByProg[programId] || [];
      if (!slots.length) continue;

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

        // German table: col0 is the tutor, not a batch
        const isGerman = progCode === 'GERMAN';
        let batchId = null;
        let rowFacultyId = null;
        if (isGerman) {
          // skip non-tutor rows (shoot/live/online/section headers)
          if (/^(SHOOT|LIVE|ONLINE|DEMO|INTERVIEW|MEETING|PRE|CON|BREAK|LUNCH)/i.test(label))
            continue;
          const fac = parseFaculty(label);
          rowFacultyId = fac[0] || (await getFacultyId(label.toUpperCase()));
        } else {
          batchId = await getBatchId(programId, label);
        }

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
          const facultyId = facIds[0] || rowFacultyId || null;
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
          if (sample.length < 12 && !isGerman && progCode !== 'FLUENCY')
            sample.push({ date: isoDate, prog: progCode, batch: label.slice(0, 22), slot: slot.label, raw: cellText.slice(0, 40), room, fac: facIds.map((i) => facById.get(i)) });
        }
      }
    }
  }

  console.log(`\nParsed ${allAllocs.length} allocations across ${Object.keys(FILE_DATES).length} files.`);
  console.log('Sample (OET/IELTS sessions):');
  console.table(sample);
  console.log('New faculty created:', newFaculty);
  console.log('New rooms created  :', newRooms);
  console.log('New batches created:', newBatches.length);

  if (DRY) {
    console.log('\n--dry: nothing written.');
    conn.release();
    return 0;
  }

  // wipe existing allocations for these dates, then insert
  const dates = Object.values(FILE_DATES);
  await conn.query('DELETE FROM allocations WHERE alloc_date IN (?)', [dates]);
  const cols = ['alloc_date', 'program_id', 'batch_id', 'activity_id', 'time_slot_id', 'classroom_id', 'faculty_id', 'student_count', 'raw_text', 'note'];
  const values = allAllocs.map((a) => cols.map((c) => a[c]));
  for (let i = 0; i < values.length; i += 200) {
    const chunk = values.slice(i, i + 200);
    await conn.query(`INSERT INTO allocations (${cols.join(',')}) VALUES ?`, [chunk]);
  }
  console.log(`✅ Inserted ${allAllocs.length} allocations.`);
  conn.release();
  return allAllocs.length;
}

// CLI entry point: `node import/parse-docx.js [--dry]`
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('import/parse-docx.js')) {
  importDocx({ dry: process.argv.includes('--dry') })
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
