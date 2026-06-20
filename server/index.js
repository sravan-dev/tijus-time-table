import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import authRoutes from './routes/auth.js';
import referenceRoutes from './routes/reference.js';
import batchRoutes from './routes/batches.js';
import allocationRoutes from './routes/allocations.js';
import scheduleRoutes from './routes/schedule.js';
import userRoutes from './routes/users.js';
import myRoutes from './routes/my.js';
import notificationRoutes from './routes/notifications.js';
import settingsRoutes from './routes/settings.js';

// Load server/.env regardless of the working directory (so it works whether
// started from the repo root or the server folder). On hosts that inject env
// vars directly (e.g. Hostinger panel), the missing file is simply ignored.
dotenv.config({ path: path.join(__dirname, '.env') });
const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' })); // allow base64 logo uploads

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use('/api/auth', authRoutes);
// Mounted before referenceRoutes (which gates all of /api behind auth) so the
// public branding endpoint /api/settings/public stays reachable without a token.
app.use('/api/settings', settingsRoutes);
app.use('/api', referenceRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/allocations', allocationRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/users', userRoutes);
app.use('/api/my', myRoutes);
app.use('/api/notifications', notificationRoutes);

// Unmatched API routes return JSON (not the SPA fallback below).
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// In production, serve the built React app from a single Node process.
const clientDist = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  console.log('📦 Serving client build from', clientDist);
}

// fallback error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
