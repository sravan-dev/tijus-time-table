// Knowledge Base: the reference day-sheets the timetable generator learns from.
//
// Each row is one .docx sheet added by an admin. We keep the sheet's
// word/document.xml (gzipped), not the .docx itself: the rest of the file is
// embedded fonts and styles the parser never looks at, and a whole sheet is
// ~3 MB — past MySQL's default max_allowed_packet, so it could neither be
// written nor read back. The XML is ~15 KB gzipped, so a sheet survives a
// redeploy on a host with an ephemeral filesystem and can be re-parsed at any
// time. Generating a day looks for the sheet whose weekday matches the target
// date and rebuilds that day's sessions from it, so the academy's real weekly
// pattern drives generation instead of a blind copy of whatever day happened to
// be last in the table.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { readEntryFrom } from '../import/unzip.js';
import { weekdayFromName, resolveDate, parseDocxSheets } from '../import/parse-docx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.resolve(__dirname, '../../Knowledge Base');

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday'];

export async function migrateKnowledgeBase(pool, { seed = true } = {}) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS kb_documents (
       id          INT AUTO_INCREMENT PRIMARY KEY,
       title       VARCHAR(160) NOT NULL,
       filename    VARCHAR(200) NOT NULL,
       weekday     TINYINT NULL,            -- 0 = Sunday; NULL = not a day sheet
       sheet_date  DATE NULL,               -- the date the sheet itself is for
       size_bytes  INT NOT NULL DEFAULT 0,  -- the .docx as uploaded, for display
       sheet_xml   LONGBLOB NOT NULL,       -- gzipped word/document.xml
       session_count INT NOT NULL DEFAULT 0,-- sessions found the last time it parsed
       parse_error VARCHAR(255) NULL,
       uploaded_by INT NULL,
       created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY uq_kb_filename (filename),
       KEY idx_kb_weekday (weekday)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  // Re-read every stored sheet so its session count reflects the current parser
  // (a document that was never a timetable drops to zero and stops generating).
  // Skipped until time slots exist: counted against no slots, every sheet reads as empty.
  const [[{ slots }]] = await pool.query('SELECT COUNT(*) AS slots FROM time_slots');
  if (slots) {
    const [docs] = await pool.query('SELECT id FROM kb_documents');
    for (const { id } of docs) await recountDocument(pool, id);
  }

  if (!seed) return 0;
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM kb_documents');
  if (n) return 0;                      // already populated (or deliberately emptied)
  return seedFromFolder(pool);
}

// First-boot convenience: load whatever sheets ship in the repo's
// "Knowledge Base" folder. Admins add the rest through the module.
// Call this only once the reference data exists — a sheet counted against an
// empty programs/time_slots table reads as zero sessions.
export async function seedFromFolder(pool) {
  if (!fs.existsSync(KB_DIR)) return 0;
  const files = fs.readdirSync(KB_DIR).filter((f) => f.toLowerCase().endsWith('.docx'));
  let added = 0;
  for (const file of files) {
    const buf = fs.readFileSync(path.join(KB_DIR, file));
    try {
      const id = await insertDocument(pool, {
        filename: file,
        title: file.replace(/\.docx$/i, ''),
        content: buf,
        uploaded_by: null,
      });
      await recountDocument(pool, id);
      added++;
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') continue;  // already loaded
      // One unreadable file must not stop the rest of the folder loading.
      console.warn(`[init] Skipped Knowledge Base sheet "${file}": ${e.message}`);
    }
  }
  if (added) console.log(`[init] Knowledge Base seeded with ${added} sheet(s).`);
  return added;
}

// Store one sheet, deriving its weekday (and date, when the name resolves to a
// real one) from the filename. Throws if the .docx has no readable document.xml,
// so a bad file is rejected on the way in rather than on every later parse.
// session_count is filled in by the route, which parses the sheet against the
// live reference data.
export async function insertDocument(pool, { filename, title, content, uploaded_by }) {
  const xml = readEntryFrom(content, 'word/document.xml', filename);
  let sheetDate = null;
  try { sheetDate = resolveDate(filename); } catch { /* day/weekday mismatch */ }
  const weekday = sheetDate
    ? new Date(sheetDate + 'T00:00:00Z').getUTCDay()
    : weekdayFromName(filename);
  const [r] = await pool.query(
    `INSERT INTO kb_documents (title, filename, weekday, sheet_date, size_bytes, sheet_xml, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [title, filename, weekday, sheetDate, content.length,
      zlib.gzipSync(Buffer.from(xml, 'utf8')), uploaded_by ?? null]
  );
  return r.insertId;
}

// The stored sheet, back as word/document.xml.
export function sheetXml(row) {
  return zlib.gunzipSync(row.sheet_xml).toString('utf8');
}

// How many sessions a sheet yields against the reference data as it stands now.
// Recorded so the module can show at a glance whether a sheet is usable, and so
// the generator can skip one that reads as empty. A sheet that fails outright
// keeps its error instead of silently counting zero.
export async function recountDocument(pool, id) {
  const [[row]] = await pool.query('SELECT * FROM kb_documents WHERE id = ?', [id]);
  if (!row) return 0;
  try {
    const { allocations } = await parseDocxSheets(
      [{ label: row.filename, date: row.sheet_date || '2000-01-01', xml: sheetXml(row) }],
      { dry: true }
    );
    await pool.query(
      'UPDATE kb_documents SET session_count = ?, parse_error = NULL WHERE id = ?',
      [allocations.length, id]
    );
    return allocations.length;
  } catch (e) {
    await pool.query(
      'UPDATE kb_documents SET session_count = 0, parse_error = ? WHERE id = ?',
      [String(e.message).slice(0, 255), id]
    );
    return 0;
  }
}
