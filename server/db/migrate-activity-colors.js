// Idempotent migration: highlight colours for activities.
//
//   activities.text_color / bg_color   — the default look of an activity type
//   allocations.text_color / bg_color  — the colours of one cell in the grid
//
// The grid right-click menu ("Add activity…") copies the activity's default
// colours onto the session it creates, so recolouring a type later never
// rewrites days that are already published — each cell keeps what it was
// given. A session with no colours of its own falls back to its activity's.
//
// Also seeds the highlight activity types (Movie, Assessment, …). Types that
// already exist (GRAMMAR, ACTIVITY) keep their name and only gain colours.
import { pool } from './pool.js';

// [code, name, text_color, bg_color]
export const HIGHLIGHT_ACTIVITIES = [
  ['OET GRAMMAR', 'OET Grammar', '#5b21b6', '#ede9fe'],
  ['GRAMMAR', 'Grammar', '#075985', '#e0f2fe'],
  ['ASSESSMENT', 'Assessment', '#991b1b', '#fee2e2'],
  ['MOVIE', 'Movie', '#92400e', '#fef3c7'],
  ['SKILL DEVELOPMENT', 'Skill Development', '#166534', '#dcfce7'],
  ['ACTIVITY', 'Activity', '#9d174d', '#fce7f3'],
  ['MENTORS MEETING', 'Mentors Meeting', '#334155', '#e2e8f0'],
];

// Adds a column only when it is missing (MySQL 8 has no ADD COLUMN IF NOT
// EXISTS), so the migration is safe to re-run — and quiet when there is
// nothing to do, since init.js calls it on every boot.
async function addColumn(conn, table, column, ddl) {
  const [[hit]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (hit.n) return false;
  await conn.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  console.log(`[migrate] added ${table}.${column}`);
  return true;
}

// `seed: false` adds the columns but not the activity types — used after an
// admin "Clear all data" reset, which must stay cleared.
export async function migrateActivityColors(conn = pool, { seed = true } = {}) {
  for (const table of ['activities', 'allocations']) {
    await addColumn(conn, table, 'text_color', 'text_color VARCHAR(9) NULL');
    await addColumn(conn, table, 'bg_color', 'bg_color VARCHAR(9) NULL');
  }
  if (!seed) return;
  for (const [code, name, text, bg] of HIGHLIGHT_ACTIVITIES) {
    // Only fill in colours that are still empty, so an admin's own choice
    // (saved from the "Add activity" modal) is never reset on the next boot.
    await conn.query(
      `INSERT INTO activities (code, name, text_color, bg_color) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         text_color = COALESCE(activities.text_color, VALUES(text_color)),
         bg_color   = COALESCE(activities.bg_color,   VALUES(bg_color))`,
      [code, name, text, bg]
    );
  }
}

// CLI entry point: `node db/migrate-activity-colors.js`
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('db/migrate-activity-colors.js')) {
  migrateActivityColors()
    .then(() => {
      console.log('✅ Activity highlight colours ready.');
      return pool.end();
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
