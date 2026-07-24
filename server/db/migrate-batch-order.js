// Idempotent migration: adds batches.sort_order so timetable rows can be
// reordered (right-click → "Add row above/below").
//
// Existing batches are backfilled with sort_order = id, which preserves the
// current grid order exactly (rows were ordered by batch_id before).
import { pool } from './pool.js';

// Adds a column only when it is missing, so the script is safe to re-run.
async function addColumn(conn, table, column, ddl) {
  const [[hit]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (hit.n) { console.log(`   • ${table}.${column} already present`); return; }
  await conn.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  console.log(`   ✓ added ${table}.${column}`);
}

async function run() {
  const conn = await pool.getConnection();
  try {
    console.log('Adding sort_order to batches…');
    await addColumn(conn, 'batches', 'sort_order', 'sort_order INT NOT NULL DEFAULT 0');
    const [r] = await conn.query('UPDATE batches SET sort_order = id WHERE sort_order = 0');
    console.log(`   ✓ backfilled ${r.affectedRows} row(s) with sort_order = id`);
    console.log('\n✅ Batch ordering migration complete.');
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
