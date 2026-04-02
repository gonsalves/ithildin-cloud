import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type SyncStatus = 'idle' | 'provisioning' | 'syncing' | 'error' | 'stopped';

export interface SyncWorker {
  process: ChildProcess | null;
  status: SyncStatus;
  vaultPath: string;
  homeDir: string;
  lastError?: string;
  lastActivity?: Date;
}

const OB_CMD = 'ob';

/**
 * Provision a user's vault: login to Obsidian, setup sync, start continuous sync.
 * Each user gets an isolated HOME directory so auth tokens don't collide.
 */
export async function provisionSync(opts: {
  userId: number;
  dataDir: string;
  obsidianEmail: string;
  obsidianPassword: string;
  vaultName: string;
  vaultEncryptionPassword?: string;
}): Promise<SyncWorker> {
  const homeDir = path.join(opts.dataDir, 'vaults', String(opts.userId));
  const vaultPath = path.join(homeDir, 'vault');

  fs.mkdirSync(vaultPath, { recursive: true });

  const env = { ...process.env, HOME: homeDir, PATH: process.env.PATH };

  // Step 1: Login
  try {
    execSync(
      `${OB_CMD} login --email ${shellEscape(opts.obsidianEmail)} --password ${shellEscape(opts.obsidianPassword)}`,
      { env, encoding: 'utf8', timeout: 30000, stdio: 'pipe' }
    );
  } catch (err: any) {
    return {
      process: null,
      status: 'error',
      vaultPath,
      homeDir,
      lastError: `Login failed: ${err.stderr || err.message}`,
    };
  }

  // Step 2: Setup sync
  try {
    const setupArgs = [
      `--vault ${shellEscape(opts.vaultName)}`,
      `--path ${shellEscape(vaultPath)}`,
      opts.vaultEncryptionPassword ? `--password ${shellEscape(opts.vaultEncryptionPassword)}` : '',
    ].filter(Boolean).join(' ');

    execSync(
      `${OB_CMD} sync-setup ${setupArgs}`,
      { env, encoding: 'utf8', timeout: 30000, stdio: 'pipe' }
    );
  } catch (err: any) {
    return {
      process: null,
      status: 'error',
      vaultPath,
      homeDir,
      lastError: `Sync setup failed: ${err.stderr || err.message}`,
    };
  }

  // Step 3: Initial sync (pull everything first)
  try {
    execSync(
      `${OB_CMD} sync --path ${shellEscape(vaultPath)}`,
      { env, encoding: 'utf8', timeout: 120000, stdio: 'pipe' }
    );
  } catch (err: any) {
    // Initial sync might partially succeed — continue anyway
    console.warn(`[sync] User ${opts.userId}: initial sync warning: ${err.stderr || err.message}`);
  }

  // Step 4: Start continuous sync
  const worker = startContinuousSync(opts.userId, vaultPath, homeDir);
  return worker;
}

/** Start the ob sync --continuous process for a user */
export function startContinuousSync(
  userId: number,
  vaultPath: string,
  homeDir: string,
): SyncWorker {
  const env = { ...process.env, HOME: homeDir, PATH: process.env.PATH };

  const proc = spawn(OB_CMD, ['sync', '--continuous', '--path', vaultPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  const worker: SyncWorker = {
    process: proc,
    status: 'syncing',
    vaultPath,
    homeDir,
    lastActivity: new Date(),
  };

  proc.stdout?.on('data', (data: Buffer) => {
    worker.lastActivity = new Date();
    const msg = data.toString().trim();
    if (msg) console.log(`[sync:${userId}] ${msg}`);
  });

  proc.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[sync:${userId}] ERROR: ${msg}`);
    worker.lastError = msg;
  });

  proc.on('exit', (code) => {
    console.log(`[sync:${userId}] Process exited with code ${code}`);
    worker.status = 'stopped';
    worker.process = null;
  });

  return worker;
}

/** Stop sync for a user */
export function stopSync(worker: SyncWorker): void {
  if (worker.process) {
    worker.process.kill('SIGTERM');
    worker.process = null;
    worker.status = 'stopped';
  }
}

/** Check if sync is alive */
export function isSyncAlive(worker: SyncWorker): boolean {
  return worker.process !== null && !worker.process.killed;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
