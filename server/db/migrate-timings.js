// Idempotent migration: put the standard timetable grid (OET / IELTS / PTE /
// Fluency) on the timings the academy's day sheets use:
//
//   1  09:10-10:05   |  2  10:05-11:05   |  (break 11:05-11:10)
//   3  11:10-12:10   |  4  12:10-13:10   |  (lunch 13:10-13:50)
//   5  13:50-14:50   |  6  14:50-15:50   |  (break 15:50-16:00)
//   7  16:00-17:00
//
// Slots are re-timed IN PLACE (matched by their current label) so every
// existing allocation keeps its time_slot_id link. A database still on the old
// 8-slot grid also loses its "1.10-2.00" lunch column, provided nothing was
// ever allocated there. The German grid is left untouched. Runs on every boot
// (see init.js) and is safe to re-run.
import { pool as defaultPool } from './pool.js';

const STANDARD = ['OET', 'IELTS', 'PTE', 'FLUENCY'];

// [new label, start, end, labels it replaces]
export const STANDARD_TIMES = [
  ['9.10-10.05', '09:10', '10:05', ['9.00-10.00']],
  ['10.05-11.05', '10:05', '11:05', ['10.00-11.00']],
  ['11.10-12.10', '11:10', '12:10', ['11.15-12.15']],
  ['12.10-1.10', '12:10', '13:10', ['12.15-1.15']],
  ['1.50-2.50', '13:50', '14:50', ['2.00-2.55']],
  ['2.50-3.50', '14:50', '15:50', ['2.55-3.50']],
  ['4.00-5.00', '16:00', '17:00', []],
];
const DROP_LABEL = '1.10-2.00';

export async function migrateTimings(pool = defaultPool) {
  const [progs] = await pool.query('SELECT id, code FROM programs WHERE code IN (?)', [STANDARD]);
  for (const { id: pid, code } of progs) {
    let changed = 0;
    for (let i = 0; i < STANDARD_TIMES.length; i++) {
      const [label, start, end, old] = STANDARD_TIMES[i];
      const [r] = await pool.query(
        `UPDATE time_slots SET label=?, start_time=?, end_time=?, sort_order=?
          WHERE program_id=? AND label IN (?)
            AND NOT (label <=> ? AND start_time <=> ? AND end_time <=> ? AND sort_order <=> ?)`,
        [label, start, end, i, pid, [label, ...old], label, `${start}:00`, `${end}:00`, i]);
      changed += r.affectedRows;
    }

    const [[slot]] = await pool.query(
      'SELECT id FROM time_slots WHERE program_id=? AND label=?', [pid, DROP_LABEL]);
    if (slot) {
      const [[{ n }]] = await pool.query(
        'SELECT COUNT(*) n FROM allocations WHERE time_slot_id=?', [slot.id]);
      if (n === 0) await pool.query('DELETE FROM time_slots WHERE id=?', [slot.id]);
      else console.warn(`[timings] ${code}: "${DROP_LABEL}" has ${n} session(s) — left in place`);
    }
    if (changed) console.log(`[timings] ${code}: re-timed ${changed} slot(s) to the sheet timings`);
  }
}

// CLI entry point: `node db/migrate-timings.js`
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('db/migrate-timings.js')) {
  migrateTimings()
    .then(() => defaultPool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
