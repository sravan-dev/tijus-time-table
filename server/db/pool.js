import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve server/.env regardless of the current working directory.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// Shared connection pool used across the API and the seed/import scripts.
export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'tijus_timetable',
  waitForConnections: true,
  connectionLimit: 10,
  multipleStatements: true,
  // Return DATE/DATETIME as 'YYYY-MM-DD' strings so timezone offsets never
  // shift a day when serialised to JSON.
  dateStrings: true,
});
