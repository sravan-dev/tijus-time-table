// One-shot data loader: schema → migrations → reference seed → docx import,
// then prints a row-count summary so you can confirm the data actually landed.
// Run from the server folder:  npm run db:load
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');

function step(label, cmd) {
  console.log(`\n=== ${label} ===`);
  execSync(cmd, { cwd: serverDir, stdio: 'inherit' });
}

async function main() {
  // Show which database we're loading into (helps catch env-var problems).
  console.log(`Loading into: ${process.env.DB_USER || 'root'}@${process.env.DB_HOST || '127.0.0.1'}` +
    `:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'tijus_timetable'}`);

  step('1/4  Schema (create tables)', 'node db/run-schema.js');
  step('2/4  Migrations (roles, settings, email)',
    'node db/migrate-faculty-users.js && node db/migrate-settings.js && node db/migrate-manager-role.js');
  step('3/4  Reference data (programs, rooms, faculty, batches, users, settings)',
    'node db/seed-reference.js');
  step('4/4  Import daily timetables (.docx)', 'node import/parse-docx.js');

  // Summary
  const counts = {};
  for (const t of ['programs', 'classrooms', 'faculty', 'batches', 'time_slots',
    'activities', 'allocations', 'users', 'app_settings']) {
    const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    counts[t] = r.n;
  }
  console.log('\n========== LOAD COMPLETE ==========');
  console.table(counts);
  if (!counts.allocations) {
    console.warn('⚠  0 allocations — the timetable import did not load any rows. ' +
      'Check that the data/*.docx files exist on the server.');
  } else {
    console.log(`✅ ${counts.allocations} timetable sessions loaded.`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error('\n❌ Load failed:', e.message);
  process.exit(1);
});
