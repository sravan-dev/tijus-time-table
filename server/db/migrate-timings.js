// Idempotent migration: switch the standard timetable grid
// (OET / IELTS / PTE / Fluency) from the old 8-slot layout to the new
// 7-session schedule from the academy's updated timing sheet:
//
//   1  09:00-10:00   |  2  10:00-11:00   |  (break 11:00-11:15)
//   3  11:15-12:15   |  4  12:15-13:15   |  (lunch 13:15-14:00)
//   5  14:00-14:55   |  6  14:55-15:50   |  (break 15:50-16:00)
//   7  16:00-17:00
//
// The 7 surviving slots are re-timed IN PLACE (matched by their old label) so
// every existing allocation keeps its time_slot_id link. The historical
// "1.10-2.00" slot — now the lunch break — is dropped; it carries no
// allocations. The German grid is left untouched. Safe to re-run.
import { pool } from './pool.js';

const STANDARD = ['OET', 'IELTS', 'PTE', 'FLUENCY'];

// old label -> [new label, start, end, sort_order]
const RETIME = [
  ['9.10-10.05', '9.00-10.00', '09:00', '10:00', 0],
  ['10.05-11.05', '10.00-11.00', '10:00', '11:00', 1],
  ['11.10-12.10', '11.15-12.15', '11:15', '12:15', 2],
  ['12.10-1.10', '12.15-1.15', '12:15', '13:15', 3],
  ['1.50-2.50', '2.00-2.55', '14:00', '14:55', 4],
  ['2.50-3.50', '2.55-3.50', '14:55', '15:50', 5],
  ['4.00-5.00', '4.00-5.00', '16:00', '17:00', 6],
];
const DROP_LABEL = '1.10-2.00';

async function run() {
  const conn = await pool.getConnection();
  try {
    const [progs] = await conn.query(
      'SELECT id, code FROM programs WHERE code IN (?)', [STANDARD]);
    if (!progs.length) {
      console.log('• no standard programs found — nothing to do');
      return;
    }

    for (const { id: pid, code } of progs) {
      // 1) Re-time the surviving slots in place, matched by their OLD label.
      //    Once a label has changed, a re-run simply matches 0 rows.
      let retimed = 0;
      for (const [oldLabel, newLabel, start, end, sort] of RETIME) {
        const [r] = await conn.query(
          `UPDATE time_slots SET label=?, start_time=?, end_time=?, sort_order=?
            WHERE program_id=? AND label=?`,
          [newLabel, start, end, sort, pid, oldLabel]);
        retimed += r.affectedRows;
      }

      // 2) Drop the old "1.10-2.00" slot (the new lunch break). Refuse to drop
      //    it if anything was ever allocated there, to avoid orphaning sessions.
      const [[slot]] = await conn.query(
        'SELECT id FROM time_slots WHERE program_id=? AND label=?', [pid, DROP_LABEL]);
      if (slot) {
        const [[{ n }]] = await conn.query(
          'SELECT COUNT(*) n FROM allocations WHERE time_slot_id=?', [slot.id]);
        if (n === 0) {
          await conn.query('DELETE FROM time_slots WHERE id=?', [slot.id]);
          console.log(`• ${code}: re-timed slots, dropped "${DROP_LABEL}"`);
        } else {
          console.warn(`⚠ ${code}: "${DROP_LABEL}" has ${n} allocation(s) — left in place; reassign them, then re-run`);
        }
      } else {
        console.log(`• ${code}: already on the new grid (re-timed ${retimed})`);
      }
    }
    console.log('✅ Timings migration complete (standard grid → new 7-session schedule).');
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
