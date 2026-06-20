// Idempotent migration: adds the `manager` role to the users enum.
import { pool } from './pool.js';

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      "ALTER TABLE users MODIFY role ENUM('admin','manager','viewer','faculty') NOT NULL DEFAULT 'viewer'"
    );
    console.log('✅ users.role enum now includes manager.');
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
