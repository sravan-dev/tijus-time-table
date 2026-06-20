// Creates the database (if needed) and applies schema.sql.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbName = process.env.DB_NAME || 'tijus_timetable';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
});

await conn.query(
  `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
);
await conn.query(`USE \`${dbName}\`;`);

const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
await conn.query(sql);

console.log(`✅ Schema applied to database "${dbName}".`);
await conn.end();
