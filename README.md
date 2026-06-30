# Tijus Academy — Timetable & Allocation

Daily timetable and classroom/faculty allocation app for Tijus Academy
(OET, IELTS, PTE, German, Fluency programs).

- **Frontend:** React + Vite
- **Backend:** Node + Express REST API
- **Database:** MySQL / MariaDB (XAMPP)
- **Auth:** JWT, roles `admin` (edit), `viewer` (read-only), and `faculty`
  (sees own schedule + applies for own leave)

> If you set the database up before the faculty feature, run
> `npm run db:migrate` once to add the `faculty` role and `users.faculty_id`
> link without losing data. Fresh setups via `npm run db:setup` already include it.

The seven daily `.docx` timetables in `data/` are parsed into the database so
the app starts with real data.

## Project layout

```
data/                     original .docx source files
server/                   Express API
  db/schema.sql           database schema
  db/seed-reference.js    programs, rooms, faculty, slots, activities, batches, users
  import/parse-docx.js    parses the 7 daily .docx files into `allocations`
  services/conflicts.js   allocation rules engine (clashes, leave, capacity)
  routes/                 auth, reference, batches, allocations, schedule
client/                   React + Vite SPA
```

## First-time setup

MySQL must be running (XAMPP). The default connection (`root`, no password) is
in `server/.env` — edit it if your credentials differ.

```bash
# 1. Backend: install, create schema, seed reference data, import the docx files
cd server
npm install
npm run db:setup        # = db:schema + db:seed + db:import

# 2. Frontend
cd ../client
npm install
```

## Running

```bash
# terminal 1 — API on http://localhost:4000
cd server && npm run dev

# terminal 2 — app on http://localhost:5173
cd client && npm run dev
```

Open http://localhost:5173 and sign in.

| User     | Password    | Role   |
|----------|-------------|--------|
| `admin`  | `admin123`  | edit   |
| `viewer` | `viewer123` | read   |

> Change these in production (`server/db/seed-reference.js`) and set a real
> `JWT_SECRET` in `server/.env`.

## Features

- **Timetable grid** — batches × time slots, per program, switchable by date.
- **Allocation editor** (admin) — add/edit/delete a session via dropdowns.
- **Conflict detection** — encodes the rules from `process.docx`:
  - room double-booked in a slot
  - faculty double-booked in a slot
  - faculty allocated while on leave
  - room used while blocked
  - room capacity below batch strength
  Conflicting cells are highlighted; a summary lists all issues for the day.
- **Manage** — batches, faculty, classrooms (with capacities).
- **Leave & Blocks** — record faculty leave and room blocks that feed the rules.
- **Print** — browser print produces a clean timetable.

## Production build (single Node process)

For deployment the Express server also serves the built React app, so the whole
thing runs as **one Node process** on one port.

```bash
# from the repo root
npm run setup          # installs server + client deps
npm run build          # builds client → client/dist
npm start              # node server/index.js  (serves API + the built app)
```

When `client/dist` exists, the server serves it and falls back to `index.html`
for client-side routes. The React app calls the API at a relative `/api`, so no
extra CORS or URL config is needed in production.

## Deploying to Hostinger (Node.js)

1. **Push to GitHub** (done) and, in Hostinger, create a **Node.js application**
   pointing at this repo (or upload the files). Set:
   - **Application root:** the repo folder
   - **Startup file:** `server/index.js`
   - **Node version:** 18 or newer
2. **Create a MySQL database** in Hostinger (hPanel → Databases) and note the
   host, name, user, password.
3. **Set environment variables** in the Node.js app panel (instead of a `.env`
   file): `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PORT`
   (use the value Hostinger assigns, often via `process.env.PORT`), and a strong
   `JWT_SECRET`.
4. **Install & build** (via Hostinger's terminal/SSH or the panel's NPM install):
   ```bash
   npm run setup
   npm run build
   npm run db:setup     # creates schema, seeds reference data, imports the docx
   npm run db:migrate   # roles + settings + capability matrix + new 7-session
                        # timetable grid; re-times the standard slots (safe to re-run)
   ```
5. **Start / restart** the app from the panel. Visit your domain — you should see
   the login page.
6. **First-run security:** change the default `admin` password, set a real
   `JWT_SECRET`, and (optionally) remove the demo `viewer` user.

> If your Hostinger plan installs deps only from the repo root, the root
> `package.json` scripts (`setup`, `build`, `start`) orchestrate the `server/`
> and `client/` folders for you.

## Re-importing the docx data

`npm run db:import` clears allocations for the seven dates and re-parses the
files. Use `node import/parse-docx.js --dry` to preview parsing without writing.

## Notes on the parsing

- Numbers inside cells (e.g. `W -28`) are lesson/material numbers, **not**
  student counts — student strength lives on the batch.
- Each parsed cell keeps its original text in `allocations.raw_text` so nothing
  is lost; admins can correct any cell in the UI.
