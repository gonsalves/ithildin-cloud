import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { decrypt } from '../crypto/secrets.js';
import { provisionSync, startContinuousSync, stopSync, isSyncAlive, type SyncWorker } from '../worker/sync.js';
import { runProcessing, type RunResult } from '../worker/run-processing.js';
import { Scheduler } from './scheduler.js';

export type UserStatus = 'unconfigured' | 'provisioning' | 'syncing' | 'ready' | 'processing' | 'error' | 'disabled';

interface ManagedUser {
  userId: number;
  sync: SyncWorker | null;
  status: UserStatus;
  lastRunAt?: Date;
  lastError?: string;
}

export class Manager {
  private users = new Map<number, ManagedUser>();
  private scheduler: Scheduler;
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.scheduler = new Scheduler(this);
  }

  /** Start the orchestrator — load all enabled users and provision them */
  async start(): Promise<void> {
    console.log('[manager] Starting orchestrator...');

    // Load all enabled users
    const configs = db.select().from(schema.userConfigs).all();

    for (const cfg of configs) {
      if (!cfg.enabled) continue;
      if (!cfg.obsidianEmail || !cfg.obsidianPassword || !cfg.vaultName || !cfg.anthropicApiKey) continue;

      try {
        await this.provisionUser(cfg.userId);
      } catch (err) {
        console.error(`[manager] Failed to provision user ${cfg.userId}:`, err);
      }
    }

    // Start health checks
    this.healthInterval = setInterval(() => this.healthCheck(), 60000);

    console.log(`[manager] Started. ${this.users.size} users active.`);
  }

  /** Stop the orchestrator */
  stop(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }

    this.scheduler.stopAll();

    for (const [userId, user] of this.users) {
      if (user.sync) {
        stopSync(user.sync);
      }
    }

    this.users.clear();
    console.log('[manager] Stopped.');
  }

  /** Provision a user — login, sync, schedule */
  async provisionUser(userId: number): Promise<void> {
    const cfg = db.select().from(schema.userConfigs).where(eq(schema.userConfigs.userId, userId)).get();
    if (!cfg || !cfg.obsidianEmail || !cfg.obsidianPassword || !cfg.vaultName || !cfg.anthropicApiKey) {
      throw new Error('User not fully configured');
    }

    const managed: ManagedUser = {
      userId,
      sync: null,
      status: 'provisioning',
    };
    this.users.set(userId, managed);

    console.log(`[manager] Provisioning user ${userId}...`);

    try {
      const syncWorker = await provisionSync({
        userId,
        dataDir: config.dataDir,
        obsidianEmail: decrypt(cfg.obsidianEmail),
        obsidianPassword: decrypt(cfg.obsidianPassword),
        vaultName: cfg.vaultName,
        vaultEncryptionPassword: cfg.vaultEncryptionPassword ? decrypt(cfg.vaultEncryptionPassword) : undefined,
      });

      managed.sync = syncWorker;

      if (syncWorker.status === 'error') {
        managed.status = 'error';
        managed.lastError = syncWorker.lastError;
        console.error(`[manager] User ${userId} sync error: ${syncWorker.lastError}`);
        return;
      }

      managed.status = 'ready';

      // Schedule cron
      this.scheduler.scheduleUser(userId, cfg.cronSchedule, cfg.timezone);

      console.log(`[manager] User ${userId} provisioned and READY. Vault: ${syncWorker.vaultPath}`);
    } catch (err) {
      managed.status = 'error';
      managed.lastError = String(err);
      console.error(`[manager] User ${userId} provision error:`, err);
    }
  }

  /** Deprovision a user */
  deprovisionUser(userId: number): void {
    const managed = this.users.get(userId);
    if (managed?.sync) {
      stopSync(managed.sync);
    }
    this.scheduler.unscheduleUser(userId);
    this.users.delete(userId);
    console.log(`[manager] User ${userId} deprovisioned.`);
  }

  /** Run processing for a user (called by scheduler or "Run Now") */
  async runForUser(userId: number): Promise<RunResult | null> {
    const managed = this.users.get(userId);
    if (!managed || !managed.sync) {
      console.error(`[manager] Cannot run for user ${userId}: not provisioned`);
      return null;
    }

    if (managed.status === 'processing') {
      console.warn(`[manager] User ${userId} already processing, skipping`);
      return null;
    }

    const cfg = db.select().from(schema.userConfigs).where(eq(schema.userConfigs.userId, userId)).get();
    if (!cfg?.anthropicApiKey) {
      console.error(`[manager] User ${userId}: no API key`);
      return null;
    }

    managed.status = 'processing';

    // Insert a processing run record
    const run = db.insert(schema.processingRuns).values({
      userId,
      status: 'running',
      dailyNoteDate: new Date().toISOString().slice(0, 10),
    }).run();
    const runId = Number(run.lastInsertRowid);

    try {
      const result = await runProcessing({
        vaultPath: managed.sync.vaultPath,
        anthropicApiKey: decrypt(cfg.anthropicApiKey),
      });

      // Update the run record
      db.update(schema.processingRuns)
        .set({
          status: result.errors.length > 0 ? 'failed' : 'success',
          completedAt: new Date().toISOString(),
          notesCreated: result.dailyProcessing.notesCreated,
          apiTokensUsed: result.totalTokensUsed,
          errorMessage: result.errors.length > 0 ? result.errors.join('; ') : null,
        })
        .where(eq(schema.processingRuns.id, runId))
        .run();

      managed.status = 'ready';
      managed.lastRunAt = new Date();
      managed.lastError = result.errors.length > 0 ? result.errors[0] : undefined;

      return result;
    } catch (err) {
      db.update(schema.processingRuns)
        .set({
          status: 'failed',
          completedAt: new Date().toISOString(),
          errorMessage: String(err),
        })
        .where(eq(schema.processingRuns.id, runId))
        .run();

      managed.status = 'error';
      managed.lastError = String(err);
      return null;
    }
  }

  /** Get status for a user */
  getUserStatus(userId: number): { status: UserStatus; lastRunAt?: Date; lastError?: string; nextRun?: Date } {
    const managed = this.users.get(userId);
    if (!managed) return { status: 'unconfigured' };

    return {
      status: managed.status,
      lastRunAt: managed.lastRunAt,
      lastError: managed.lastError,
      nextRun: this.scheduler.getNextRun(userId),
    };
  }

  /** Health check — restart dead sync processes */
  private healthCheck(): void {
    for (const [userId, managed] of this.users) {
      if (managed.sync && !isSyncAlive(managed.sync)) {
        console.warn(`[health] User ${userId}: sync process dead, restarting...`);
        managed.sync = startContinuousSync(
          userId,
          managed.sync.vaultPath,
          managed.sync.homeDir,
        );

        if (managed.status !== 'processing') {
          managed.status = isSyncAlive(managed.sync) ? 'ready' : 'error';
        }
      }
    }
  }
}
