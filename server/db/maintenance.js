// Database maintenance helpers for the admin Settings page:
//  - dumpDatabase(): a portable mysqldump-style .sql backup of the whole DB,
//    built in pure JS so it works on hosts without shell / mysqldump access.
//  - clearTimetableData(): wipe all timetable + reference data, keeping only
//    user accounts and app settings, and pin a flag so the auto-seeder doesn't
//    repopulate everything on the next server restart.
import { pool } from './pool.js';

// Escape a value into a MySQL string/number literal. Columns come back as
// strings (dateStrings:true) or numbers/null, so this covers our schema.
function escVal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (Buffer.isBuffer(v)) return v.length ? `0x${v.toString('hex')}` : 'NULL';
  const s = String(v)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x00/g, '\\0')
    .replace(/\x1a/g, '\\Z');
  return `'${s}'`;
}

export async function dumpDatabase() {
  const [tableRows] = await pool.query('SHOW TABLES');
  const tables = tableRows.map((r) => Object.values(r)[0]);

  const lines = [];
  lines.push('-- Tijus Academy Timetable — database backup');
  lines.push(`-- Generated ${new Date().toISOString()}`);
  lines.push('SET NAMES utf8mb4;');
  lines.push('SET FOREIGN_KEY_CHECKS = 0;');
  lines.push('');

  for (const t of tables) {
    const [[createRow]] = await pool.query(`SHOW CREATE TABLE \`${t}\``);
    const createSql = createRow['Create Table'] || createRow['Create View'];
    lines.push(`-- ---------- Table: ${t} ----------`);
    lines.push(`DROP TABLE IF EXISTS \`${t}\`;`);
    lines.push(`${createSql};`);
    lines.push('');

    const [rows] = await pool.query(`SELECT * FROM \`${t}\``);
    if (rows.length) {
      const cols = Object.keys(rows[0]);
      const colList = cols.map((c) => `\`${c}\``).join(', ');
      const valueLines = rows.map(
        (row) => '  (' + cols.map((c) => escVal(row[c])).join(', ') + ')'
      );
      lines.push(`INSERT INTO \`${t}\` (${colList}) VALUES`);
      lines.push(valueLines.join(',\n') + ';');
      lines.push('');
    }
  }

  lines.push('SET FOREIGN_KEY_CHECKS = 1;');
  lines.push('');
  return lines.join('\n');
}

// Tables wiped by a "Clear all data" reset, child-first. Users and app_settings
// are deliberately kept; tickets (tied to users) are kept too.
const CLEAR_TABLES = [
  'allocations',
  'faculty_leave',
  'room_blocks',
  'batches',
  'time_slots',
  'activities',
  'faculty',
  'classrooms',
  'programs',
];

export async function clearTimetableData() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of CLEAR_TABLES) {
      await conn.query(`DELETE FROM \`${t}\``);
      try { await conn.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`); } catch { /* ignore */ }
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    // Stop the boot-time auto-seeder from re-importing the docx timetables and
    // reference data the next time the server restarts — the reset must stick.
    await conn.query(
      `INSERT INTO app_settings (skey, svalue) VALUES ('seed_disabled', '1')
       ON DUPLICATE KEY UPDATE svalue = '1'`
    );
  } finally {
    conn.release();
  }
}
