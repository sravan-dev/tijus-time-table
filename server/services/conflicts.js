import { pool } from '../db/pool.js';

// Computes all scheduling conflicts for a given date, encoding the rules
// described in process.docx:
//   - a room cannot host two sessions in the same slot
//   - a faculty cannot teach two sessions in the same slot
//   - a faculty marked on leave cannot be allocated
//   - a blocked room cannot be used
//   - a room whose capacity < batch strength is over capacity
// Returns a map of allocationId -> array of { level, type, message }.
export async function conflictsForDate(date) {
  const [rows] = await pool.query(
    `SELECT a.id, a.time_slot_id, a.classroom_id, a.faculty_id, a.batch_id,
            r.code AS room_code, r.capacity,
            f.name AS faculty_name,
            b.student_count, b.name AS batch_name,
            ts.label AS slot_label
       FROM allocations a
       LEFT JOIN classrooms r ON r.id = a.classroom_id
       LEFT JOIN faculty f    ON f.id = a.faculty_id
       LEFT JOIN batches b    ON b.id = a.batch_id
       LEFT JOIN time_slots ts ON ts.id = a.time_slot_id
      WHERE a.alloc_date = ? AND a.status = 'approved'`,
    [date]
  );

  // Only approved leave blocks an allocation: a pending request must not start
  // flagging the tutor's existing sessions before an admin has decided on it.
  const [leaves] = await pool.query(
    "SELECT faculty_id FROM faculty_leave WHERE leave_date = ? AND status = 'approved'",
    [date]
  );
  const onLeave = new Set(leaves.map((l) => l.faculty_id));

  const [blocks] = await pool.query(
    'SELECT classroom_id FROM room_blocks WHERE block_date = ?',
    [date]
  );
  const blocked = new Set(blocks.map((b) => b.classroom_id));

  const result = {};
  const add = (id, level, type, message) => {
    (result[id] ??= []).push({ level, type, message });
  };

  // group by slot to find double-bookings
  const roomSlot = new Map(); // `${slot}|${room}` -> [ids]
  const facSlot = new Map();
  for (const a of rows) {
    if (a.classroom_id) {
      const k = a.time_slot_id + '|' + a.classroom_id;
      (roomSlot.get(k) || roomSlot.set(k, []).get(k)).push(a);
    }
    if (a.faculty_id) {
      const k = a.time_slot_id + '|' + a.faculty_id;
      (facSlot.get(k) || facSlot.set(k, []).get(k)).push(a);
    }
  }

  for (const a of rows) {
    // double-booked room
    if (a.classroom_id) {
      const peers = roomSlot.get(a.time_slot_id + '|' + a.classroom_id);
      if (peers && peers.length > 1)
        add(a.id, 'error', 'room_clash',
          `Room ${a.room_code} double-booked at ${a.slot_label} (${peers.length} sessions)`);
      if (blocked.has(a.classroom_id))
        add(a.id, 'error', 'room_blocked', `Room ${a.room_code} is blocked on this date`);
      if (a.capacity > 0 && a.student_count > a.capacity)
        add(a.id, 'warn', 'over_capacity',
          `${a.batch_name} (${a.student_count}) exceeds ${a.room_code} capacity (${a.capacity})`);
    }
    // double-booked faculty
    if (a.faculty_id) {
      const peers = facSlot.get(a.time_slot_id + '|' + a.faculty_id);
      if (peers && peers.length > 1)
        add(a.id, 'error', 'faculty_clash',
          `${a.faculty_name} double-booked at ${a.slot_label} (${peers.length} sessions)`);
      if (onLeave.has(a.faculty_id))
        add(a.id, 'error', 'faculty_leave', `${a.faculty_name} is on leave on this date`);
    }
  }
  return result;
}
