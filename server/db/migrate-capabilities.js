// Idempotent migration: faculty_capabilities table (tutor x program x module)
// from the "TUTORS & MODULE" sheet. Safe to re-run; does NOT drop existing
// rows, so admin edits made in the UI are preserved.
import { pool } from './pool.js';

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS faculty_capabilities (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        faculty_id  INT NOT NULL,
        program_id  INT NOT NULL,
        module      ENUM('LISTENING','READING','SPEAKING','WRITING','GENERAL') NOT NULL,
        FOREIGN KEY (faculty_id) REFERENCES faculty(id)  ON DELETE CASCADE,
        FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
        UNIQUE KEY uq_capability (faculty_id, program_id, module)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('• faculty_capabilities table ready');
    console.log('✅ Capabilities migration complete (run db:seed to populate from the sheet).');
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
