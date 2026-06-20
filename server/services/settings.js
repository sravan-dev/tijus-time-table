import { pool } from '../db/pool.js';

// Read all settings as a plain object.
export async function getSettings() {
  const [rows] = await pool.query('SELECT skey, svalue FROM app_settings');
  return Object.fromEntries(rows.map((r) => [r.skey, r.svalue]));
}

// Upsert a map of settings.
export async function setSettings(map) {
  const entries = Object.entries(map);
  if (!entries.length) return;
  for (const [k, v] of entries) {
    await pool.query(
      `INSERT INTO app_settings (skey, svalue) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)`,
      [k, v == null ? '' : String(v)]
    );
  }
}
