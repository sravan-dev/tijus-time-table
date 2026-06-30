// Seeds stable reference data (programs, rooms, faculty, slots, activities,
// batches) plus a default admin user. Idempotent: safe to re-run.
import bcrypt from 'bcryptjs';
import { pool } from './pool.js';

// ---- Programs -------------------------------------------------------------
const PROGRAMS = [
  ['OET', 'Occupational English Test'],
  ['IELTS', 'IELTS'],
  ['PTE', 'PTE Academic'],
  ['GERMAN', 'German Language'],
  ['FLUENCY', 'Fluency'],
];

// ---- Classrooms (capacity from process2.docx; 0 = unspecified) ------------
const CLASSROOMS = [
  ['B1', 60], ['B2', 20], ['C1', 25], ['C2', 30], ['C3', 0], ['C4', 0],
  ['C5', 0], ['C6', 0], ['C7', 0], ['C8', 0], ['A1', 0], ['A2', 0],
  ['A3', 0], ['A4', 0], ['A4-Front', 15], ['A4-Back', 10], ['A5', 15],
  ['A6', 20], ['D1', 0], ['D2', 20], ['T1', 0],
];

// ---- Faculty (normalised; Suchitra/Suchithra & Besty/Betsy treated as one) -
const FACULTY = [
  // OET
  'Deepthy', 'Suchithra', 'Haritha', 'Radhakrishnan', 'Gangalekshmi',
  'Goldy', 'Varsha', 'Vishnu', 'Anju', 'Amiya',
  // IELTS / PTE
  'Krishnanunni', 'Betsy', 'Akhila', 'Rissy', 'Stan', 'Farzana',
  'Tintu', 'Jeslin', 'Ann',
  // German
  'Abin', 'Sneha', 'Krishnendu', 'Revathy', 'Archana', 'Akash', 'Athul',
];

// ---- Faculty capabilities (from "TUTORS & MODULE" sheet) ------------------
// programCode -> { canonicalFacultyName: [modules] }. An empty module list
// means the program has no module split (Fluency) -> stored as GENERAL.
export const CAPABILITIES = {
  IELTS: {
    Betsy: ['L', 'R', 'S', 'W'], Tintu: ['L', 'R', 'S', 'W'],
    Akhila: ['L', 'R', 'S', 'W'], Jeslin: ['L', 'R', 'S', 'W'],
    Farzana: ['L', 'R', 'S', 'W'], Stan: ['L', 'R', 'S', 'W'],
    Rissy: ['L', 'R', 'S', 'W'], Vishnu: ['R', 'S'], Suchithra: ['R', 'S'],
    Varsha: ['S'], Goldy: ['S'], Ann: ['L'],
  },
  OET: {
    Varsha: ['S'], Suchithra: ['R', 'S'], Haritha: ['S', 'W'],
    Radhakrishnan: ['W'], Vishnu: ['R', 'S'], Gangalekshmi: ['S'],
    Amiya: ['L', 'S'], Goldy: ['S'], Anju: ['R', 'S'], Farzana: ['S'],
    Ann: ['W'],
  },
  PTE: {
    Farzana: ['L', 'R', 'S', 'W'], Stan: ['L', 'R', 'S', 'W'],
    Rissy: ['L', 'R', 'S', 'W'], Ann: ['L', 'R', 'S', 'W'],
  },
  FLUENCY: {
    Farzana: [], Vishnu: [], Goldy: [], Varsha: [], Gangalekshmi: [], Amiya: [],
  },
};

// Short module codes -> stored enum values.
export const MODULE_BY_CODE = {
  L: 'LISTENING', R: 'READING', S: 'SPEAKING', W: 'WRITING',
};

// New tutors introduced by the "TUTORS & MODULE" sheet (not in the original
// seed). Exported so a targeted live-DB apply can add just these.
export const NEW_FACULTY = ['Tintu', 'Jeslin', 'Ann'];

// ---- Activity / session types --------------------------------------------
const ACTIVITIES = [
  ['R', 'Reading'], ['W', 'Writing'], ['L', 'Listening'], ['S', 'Speaking'],
  ['W.C', 'Writing Correction'], ['R.E', 'Reading Explanation'],
  ['L.E', 'Listening Explanation'], ['A R', 'Academic Reading'],
  ['G R', 'General Reading'], ['A R E', 'Academic Reading Explanation'],
  ['G R E', 'General Reading Explanation'], ['GRAMMAR', 'Grammar'],
  ['ACTIVITY', 'Activity'], ['ORIENTATION', 'Orientation'],
  ['PREPARATION', 'Preparation'], ['VOCABULARY', 'Vocabulary'],
  ['MOCK', 'Mock Exam'], ['YOGA', 'Yoga Class'], ['ONLINE', 'Online'],
  ['SHOOT', 'Shoot'], ['DEMO', 'Demo / Interview'], ['MEETING', 'Meeting'],
  ['EXAM', 'Exam'],
];

// ---- Time slots per program ----------------------------------------------
// OET / IELTS / PTE / Fluency share the 7-session grid (updated timing sheet):
// 1hr sessions with a 15-min break after the 2nd, a 45-min lunch after the
// 4th, and a 10-min break before the last. migrate-timings.js moves existing
// databases off the old 8-slot grid (dropping the empty "1.10-2.00" lunch col).
const STANDARD_SLOTS = [
  ['9.00-10.00', '09:00', '10:00'],
  ['10.00-11.00', '10:00', '11:00'],
  ['11.15-12.15', '11:15', '12:15'],
  ['12.15-1.15', '12:15', '13:15'],
  ['2.00-2.55', '14:00', '14:55'],
  ['2.55-3.50', '14:55', '15:50'],
  ['4.00-5.00', '16:00', '17:00'],
];
const GERMAN_SLOTS = [
  ['9.15-11.15', '09:15', '11:15'],
  ['11.15-11.30', '11:15', '11:30'],
  ['11.30-12.30', '11:30', '12:30'],
  ['1.30-2.00', '13:30', '14:00'],
  ['2.00-5.00', '14:00', '17:00'],
];

// ---- Batches (from process2.docx + german.txt) ---------------------------
// [name, programCode, studentCount, homeRoomCode, examMonth]
const BATCHES = [
  ['Exam Batch (C7)', 'OET', 4, 'C7', 'Exam'],
  ['March (B2)', 'OET', 6, 'B2', 'March'],
  ['April 1', 'OET', 8, 'A4', 'April'],
  ['April 2', 'OET', 8, 'B1', 'April'],
  ['May 1', 'OET', 11, 'B1', 'May'],
  ['May 2', 'OET', 5, 'A6', 'May'],
  ['June 1', 'OET', 7, null, 'June'],
  ['Exam Batch (C1)', 'IELTS', 1, 'C1', 'Exam'],
  ['Feb–Apr (C1)', 'IELTS', 22, 'C1', 'Feb-Apr'],
  ['May 1 (A4)', 'IELTS', 9, 'A4', 'May'],
  ['May 2 (C2)', 'IELTS', 14, 'C2', 'May'],
  ['June 1 (A2)', 'IELTS', 17, 'A2', 'June'],
  ['PTE Morning (C3)', 'PTE', 5, 'C3', null],
  ['Fluency', 'FLUENCY', 20, 'D2', null],
  ['German A1 (Morning)', 'GERMAN', 7, 'A1', null],
  ['German A2 (Afternoon)', 'GERMAN', 9, 'A2', null],
  ['German B1', 'GERMAN', 4, 'B1', null],
  ['German B2', 'GERMAN', 1, 'B2', null],
];

export async function seedReference() {
  const conn = await pool.getConnection();
  try {
    // Programs
    for (const [code, name] of PROGRAMS) {
      await conn.query(
        'INSERT INTO programs (code, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name)',
        [code, name]
      );
    }
    // Classrooms
    for (const [code, cap] of CLASSROOMS) {
      await conn.query(
        'INSERT INTO classrooms (code, capacity) VALUES (?, ?) ON DUPLICATE KEY UPDATE capacity=VALUES(capacity)',
        [code, cap]
      );
    }
    // Faculty
    for (const name of FACULTY) {
      await conn.query(
        'INSERT INTO faculty (name) VALUES (?) ON DUPLICATE KEY UPDATE name=VALUES(name)',
        [name]
      );
    }
    // Activities
    for (const [code, name] of ACTIVITIES) {
      await conn.query(
        'INSERT INTO activities (code, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name)',
        [code, name]
      );
    }
    // Time slots
    const [progRows] = await conn.query('SELECT id, code FROM programs');
    const progByCode = Object.fromEntries(progRows.map((p) => [p.code, p.id]));
    const slotPlan = [
      ['OET', STANDARD_SLOTS], ['IELTS', STANDARD_SLOTS],
      ['PTE', STANDARD_SLOTS], ['FLUENCY', STANDARD_SLOTS],
      ['GERMAN', GERMAN_SLOTS],
    ];
    for (const [code, slots] of slotPlan) {
      const pid = progByCode[code];
      for (let i = 0; i < slots.length; i++) {
        const [label, start, end] = slots[i];
        await conn.query(
          `INSERT INTO time_slots (program_id, label, start_time, end_time, sort_order)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE start_time=VALUES(start_time), end_time=VALUES(end_time), sort_order=VALUES(sort_order)`,
          [pid, label, start, end, i]
        );
      }
    }
    // Batches
    const [roomRows] = await conn.query('SELECT id, code FROM classrooms');
    const roomByCode = Object.fromEntries(roomRows.map((r) => [r.code, r.id]));
    for (const [name, pcode, count, room, exam] of BATCHES) {
      await conn.query(
        `INSERT INTO batches (name, program_id, student_count, home_room_id, exam_month)
         VALUES (?, ?, ?, ?, ?)`,
        [name, progByCode[pcode], count, room ? roomByCode[room] : null, exam]
      );
    }
    // Faculty capabilities (tutor x program x module). Rebuilt from the sheet.
    const [facRows] = await conn.query('SELECT id, name FROM faculty');
    const facByName = Object.fromEntries(facRows.map((f) => [f.name, f.id]));
    await conn.query('DELETE FROM faculty_capabilities');
    for (const [pcode, tutors] of Object.entries(CAPABILITIES)) {
      const pid = progByCode[pcode];
      for (const [fname, codes] of Object.entries(tutors)) {
        const fid = facByName[fname];
        if (!pid || !fid) { console.warn(`  ⚠ skipped capability ${fname}/${pcode}`); continue; }
        const modules = codes.length ? codes.map((c) => MODULE_BY_CODE[c]) : ['GENERAL'];
        for (const m of modules) {
          await conn.query(
            'INSERT IGNORE INTO faculty_capabilities (faculty_id, program_id, module) VALUES (?, ?, ?)',
            [fid, pid, m]
          );
        }
      }
    }

    // Default admin + viewer users
    const adminHash = await bcrypt.hash('admin123', 10);
    const viewerHash = await bcrypt.hash('viewer123', 10);
    const terenceHash = await bcrypt.hash('Terence@2026', 10);
    await conn.query(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES
        ('admin', ?, 'Allocation Admin', 'admin'),
        ('viewer', ?, 'Viewer', 'viewer'),
        ('terence@tijusacademy.com', ?, 'Terence G', 'admin')
       ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)`,
      [adminHash, viewerHash, terenceHash]
    );

    // Default app settings (branding, timezone, SMTP placeholders)
    const DEFAULT_SETTINGS = {
      app_title: 'Tijus Academy', app_logo: '', timezone: 'Asia/Kolkata',
      smtp_host: '', smtp_port: '587', smtp_secure: '0', smtp_user: '',
      smtp_password: '', smtp_from: '', smtp_enabled: '0',
    };
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await conn.query('INSERT IGNORE INTO app_settings (skey, svalue) VALUES (?, ?)', [k, v]);
    }

    console.log('✅ Reference data seeded (programs, rooms, faculty, capabilities, slots, activities, batches, users, settings).');
    console.log('   Default logins:  admin / admin123   |   viewer / viewer123');
  } finally {
    conn.release();
  }
}

// CLI entry point: `node db/seed-reference.js`
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('db/seed-reference.js')) {
  seedReference()
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
