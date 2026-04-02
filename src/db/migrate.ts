import Database from 'better-sqlite3';
import { config } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';

const dbDir = path.dirname(config.databasePath);
fs.mkdirSync(dbDir, { recursive: true });

const sqlite = new Database(config.databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_configs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    obsidian_email TEXT,
    obsidian_password TEXT,
    vault_name TEXT,
    vault_encryption_password TEXT,
    anthropic_api_key TEXT,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    cron_schedule TEXT NOT NULL DEFAULT '0 6,21 * * *',
    enabled INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS processing_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'success', 'failed', 'skipped')),
    daily_note_date TEXT,
    notes_created INTEGER DEFAULT 0,
    error_message TEXT,
    api_tokens_used INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_runs_user ON processing_runs(user_id);
  CREATE INDEX IF NOT EXISTS idx_runs_status ON processing_runs(status);
`);

console.log('Database migrated successfully.');
sqlite.close();
