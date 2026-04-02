import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import * as schema from './schema.js';
import fs from 'node:fs';
import path from 'node:path';

// Ensure the data directory exists
const dbDir = path.dirname(config.databasePath);
fs.mkdirSync(dbDir, { recursive: true });

const sqlite = new Database(config.databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export const rawDb: import('better-sqlite3').Database = sqlite;
export { schema };
