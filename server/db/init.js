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

    // Support tickets (tutors raise, admins reply) — added in a later release, so
    // create them here for databases provisioned before the feature existed.
    await pool.query(
      `CREATE TABLE IF NOT EXISTS tickets (
         id         INT AUTO_INCREMENT PRIMARY KEY,
         user_id    INT NOT NULL,
         subject    VARCHAR(160) NOT NULL,
         status     ENUM('open','answered','closed') NOT NULL DEFAULT 'open',
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         INDEX idx_tickets_user (user_id),
         INDEX idx_tickets_status (status)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ticket_messages (
         id         INT AUTO_INCREMENT PRIMARY KEY,
         ticket_id  INT NOT NULL,
         user_id    INT NOT NULL,
         body       TEXT NOT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_tmsg_ticket (ticket_id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // An admin "Clear all data" reset pins this flag so we never repopulate the
    // database from seeds/docx on a later restart (which would undo the reset).
    const [[seedFlag]] = await pool.query(
      "SELECT svalue FROM app_settings WHERE skey = 'seed_disabled'");
    const seedDisabled = seedFlag?.svalue === '1';

    // 3. Seed reference data (programs, rooms, faculty, batches, users, settings)
    //    only if not present.
    const [[{ n: progs }]] = await pool.query('SELECT COUNT(*) AS n FROM programs');
    if (progs === 0 && !seedDisabled) {
      console.log('[init] Seeding reference data…');
      await seedReference();
    }

    // 4. Import the daily timetables only if there are no allocations yet.
    const [[{ n: allocs }]] = await pool.query('SELECT COUNT(*) AS n FROM allocations');
    if (allocs === 0 && !seedDisabled) {
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
