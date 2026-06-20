// Idempotent migration: adds the `faculty` role and users.faculty_id link
// to an existing database without dropping data. Safe to re-run.
import { pool } from './pool.js';

async function run() {
  const conn = await pool.getConnection();
  try {
    // 1. widen the role enum
    await conn.query(
      "ALTER TABLE users MODIFY role ENUM('admin','viewer','faculty') NOT NULL DEFAULT 'viewer'"
    );
    console.log('• role enum now includes faculty');

    // 2. add faculty_id column if missing (MariaDB supports IF NOT EXISTS)
    await conn.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS faculty_id INT NULL');
    console.log('• users.faculty_id present');

    // 3. add the FK if it isn't there yet
    const [[fk]] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
          AND CONSTRAINT_NAME = 'fk_users_faculty'`
    );
    if (!fk.n) {
      await conn.query(
        `ALTER TABLE users ADD CONSTRAINT fk_users_faculty
           FOREIGN KEY (faculty_id) REFERENCES faculty(id) ON DELETE SET NULL`
      );
      console.log('• fk_users_faculty added');
    } else {
      console.log('• fk_users_faculty already exists');
    }

    console.log('✅ Migration complete.');
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
