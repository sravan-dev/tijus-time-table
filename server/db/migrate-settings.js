// Idempotent migration: app_settings key-value table, faculty.email column,
// and default settings (timezone Asia/Kolkata). Safe to re-run.
import { pool } from './pool.js';

const DEFAULTS = {
  app_title: 'Tijus Academy',
  app_logo: '',               // empty => use bundled /logo.png
  timezone: 'Asia/Kolkata',
  smtp_host: '',
  smtp_port: '587',
  smtp_secure: '0',
  smtp_user: '',
  smtp_password: '',
  smtp_from: '',
  smtp_enabled: '0',
};

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        skey   VARCHAR(60) PRIMARY KEY,
        svalue MEDIUMTEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('• app_settings table ready');

    await conn.query('ALTER TABLE faculty ADD COLUMN IF NOT EXISTS email VARCHAR(160) NULL');
    console.log('• faculty.email present');

    for (const [k, v] of Object.entries(DEFAULTS)) {
      await conn.query(
        'INSERT IGNORE INTO app_settings (skey, svalue) VALUES (?, ?)', [k, v]);
    }
    console.log('• default settings seeded (timezone = Asia/Kolkata)');
    console.log('✅ Settings migration complete.');
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
