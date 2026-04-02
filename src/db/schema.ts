import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const userConfigs = sqliteTable('user_configs', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  obsidianEmail: text('obsidian_email'),       // encrypted
  obsidianPassword: text('obsidian_password'), // encrypted
  vaultName: text('vault_name'),
  vaultEncryptionPassword: text('vault_encryption_password'), // encrypted, E2EE password
  anthropicApiKey: text('anthropic_api_key'),  // encrypted
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  cronSchedule: text('cron_schedule').notNull().default('0 6,21 * * *'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
});

export const processingRuns = sqliteTable('processing_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
  status: text('status', { enum: ['running', 'success', 'failed', 'skipped'] }).notNull().default('running'),
  dailyNoteDate: text('daily_note_date'),
  notesCreated: integer('notes_created').default(0),
  errorMessage: text('error_message'),
  apiTokensUsed: integer('api_tokens_used').default(0),
});
