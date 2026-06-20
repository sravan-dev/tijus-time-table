// Auto-initialise the database when the server boots — for hosts without shell
// access. Creates tables if missing, seeds reference data and imports the
// timetables only when they're empty. It NEVER drops or overwrites existing
// data, so it's safe to run on every startup.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';
import { seedReference } from './seed-reference.js';
import { importDocx } from '../import/parse-docx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function tableExists(name) {
  const [rows] = await pool.query('SHOW TABLES LIKE ?', [name]);
  return rows.length > 0;
}

export async function initDb() {
  try {
    // 1. Create the schema only if the core table is absent (fresh database).
    if (!(await tableExists('allocations'))) {
      console.log('[init] No tables found — applying schema.sql');
      const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      await pool.query(sql); // pool has multipleStatements enabled
    }

    // 2. Idempotent patches so partial/older databases gain newer pieces.
    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_settings (
         skey VARCHAR(60) PRIMARY KEY, svalue MEDIUMTEXT
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    try { await pool.query("ALTER TABLE users MODIFY role ENUM('admin','manager','viewer','faculty') NOT NULL DEFAULT 'viewer'"); } catch { /* already correct */ }
    try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS faculty_id INT NULL'); } catch { /* exists */ }
    try { await pool.query('ALTER TABLE faculty ADD COLUMN IF NOT EXISTS email VARCHAR(160) NULL'); } catch { /* exists */ }

    // 3. Seed reference data (programs, rooms, faculty, batches, users, settings)
    //    only if not present.
    const [[{ n: progs }]] = await pool.query('SELECT COUNT(*) AS n FROM programs');
    if (progs === 0) {
      console.log('[init] Seeding reference data…');
      await seedReference();
    }

    // 4. Import the daily timetables only if there are no allocations yet.
    const [[{ n: allocs }]] = await pool.query('SELECT COUNT(*) AS n FROM allocations');
    if (allocs === 0) {
      console.log('[init] Importing timetables from data/*.docx …');
      const inserted = await importDocx();
      console.log(`[init] Imported ${inserted} sessions.`);
    }

    const [[{ n: total }]] = await pool.query('SELECT COUNT(*) AS n FROM allocations');
    console.log(`[init] Database ready (${total} timetable sessions).`);
  } catch (e) {
    console.error('[init] Database initialisation failed:', e.message);
  }
}
