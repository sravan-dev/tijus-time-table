// Idempotent migration: adds the approval workflow for tutor-submitted leave
// and tutor-proposed sessions.
//
// Existing rows keep working unchanged: both columns default to 'approved', so
// leave and allocations that predate this migration stay live in the timetable
// and its conflict checks. Only new tutor requests start out 'pending'.
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
    console.log('Adding approval columns to faculty_leave…');
    await addColumn(conn, 'faculty_leave', 'status',
      "status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved'");
    await addColumn(conn, 'faculty_leave', 'requested_by', 'requested_by INT NULL');
    await addColumn(conn, 'faculty_leave', 'decided_by', 'decided_by INT NULL');
    await addColumn(conn, 'faculty_leave', 'decided_at', 'decided_at DATETIME NULL');
    await addColumn(conn, 'faculty_leave', 'decision_note', 'decision_note VARCHAR(255) NULL');

    console.log('Adding approval columns to allocations…');
    await addColumn(conn, 'allocations', 'status',
      "status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved'");
    await addColumn(conn, 'allocations', 'requested_by', 'requested_by INT NULL');
    await addColumn(conn, 'allocations', 'decided_by', 'decided_by INT NULL');
    await addColumn(conn, 'allocations', 'decided_at', 'decided_at DATETIME NULL');
    await addColumn(conn, 'allocations', 'decision_note', 'decision_note VARCHAR(255) NULL');

    // Approval queues filter on status, and the timetable filters it per date.
    for (const [table, idx, cols] of [
      ['faculty_leave', 'idx_leave_status', '(status)'],
      ['allocations', 'idx_alloc_status', '(status)'],
    ]) {
      const [[hit]] = await conn.query(
        `SELECT COUNT(*) AS n FROM information_schema.statistics
          WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
        [table, idx]
      );
      if (hit.n) { console.log(`   • ${table}.${idx} already present`); continue; }
      await conn.query(`CREATE INDEX ${idx} ON ${table} ${cols}`);
      console.log(`   ✓ created index ${table}.${idx}`);
    }

    console.log('\n✅ Approval workflow migration complete.');
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
