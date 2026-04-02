import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { rawDb } from '../db/index.js';
import { encrypt, decrypt } from '../crypto/secrets.js';
import type { Manager } from '../orchestrator/manager.js';

const router = Router();
const q = rawDb; // short alias

function getManager(req: any): Manager {
  return req.app.locals.manager as Manager;
}

router.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/dashboard' : '/login');
});

// --- Dashboard ---

router.get('/dashboard', requireAuth, (req, res) => {
  const userId = req.session.userId!;
  const manager = getManager(req);

  const cfg = q.prepare('SELECT * FROM user_configs WHERE user_id = ?').get(userId) as any;
  const runs = q.prepare('SELECT * FROM processing_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT 20').all(userId);
  const mgrStatus = manager.getUserStatus(userId);

  const configured = !!(cfg?.obsidian_email && cfg?.anthropic_api_key && cfg?.vault_name);

  res.render('dashboard', {
    configured,
    status: mgrStatus.status || 'unconfigured',
    lastError: mgrStatus.lastError || null,
    schedule: (cfg?.cron_schedule && cfg?.timezone) ? `${cfg.cron_schedule} (${cfg.timezone})` : 'not set',
    runs: runs || [],
  });
});

// --- Settings ---

router.get('/settings', requireAuth, (req, res) => {
  const userId = req.session.userId!;
  const cfg = q.prepare('SELECT * FROM user_configs WHERE user_id = ?').get(userId) as any || {};

  res.render('settings', {
    error: null,
    success: null,
    c: {
      obsidianEmail: cfg.obsidian_email ? decrypt(cfg.obsidian_email) : '',
      vaultName: cfg.vault_name || '',
      anthropicApiKey: cfg.anthropic_api_key ? '••••' + decrypt(cfg.anthropic_api_key).slice(-8) : '',
      timezone: cfg.timezone || 'Asia/Kolkata',
      cronSchedule: cfg.cron_schedule || '0 6,21 * * *',
      enabled: !!cfg.enabled,
      hasObsidianPassword: !!cfg.obsidian_password,
      hasVaultEncryptionPassword: !!cfg.vault_encryption_password,
    },
  });
});

router.post('/settings', requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const manager = getManager(req);
  const body = req.body;

  try {
    const sets: string[] = [];
    const vals: any[] = [];

    if (body.obsidianEmail)           { sets.push('obsidian_email = ?');            vals.push(encrypt(body.obsidianEmail)); }
    if (body.obsidianPassword)        { sets.push('obsidian_password = ?');         vals.push(encrypt(body.obsidianPassword)); }
    if (body.vaultName)               { sets.push('vault_name = ?');               vals.push(body.vaultName); }
    if (body.vaultEncryptionPassword) { sets.push('vault_encryption_password = ?'); vals.push(encrypt(body.vaultEncryptionPassword)); }
    if (body.anthropicApiKey)         { sets.push('anthropic_api_key = ?');         vals.push(encrypt(body.anthropicApiKey)); }
    if (body.timezone)                { sets.push('timezone = ?');                  vals.push(body.timezone); }
    if (body.cronSchedule)            { sets.push('cron_schedule = ?');             vals.push(body.cronSchedule); }

    const wasEnabled = (q.prepare('SELECT enabled FROM user_configs WHERE user_id = ?').get(userId) as any)?.enabled;
    const isEnabled = body.enabled === 'on';
    sets.push('enabled = ?');
    vals.push(isEnabled ? 1 : 0);

    if (sets.length > 0) {
      vals.push(userId);
      q.prepare(`UPDATE user_configs SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals);
    }

    // Provision or deprovision
    if (isEnabled && !wasEnabled) {
      await manager.provisionUser(userId);
    } else if (!isEnabled && wasEnabled) {
      manager.deprovisionUser(userId);
    }

    // Re-read and render
    const cfg = q.prepare('SELECT * FROM user_configs WHERE user_id = ?').get(userId) as any || {};
    res.render('settings', {
      error: null,
      success: 'Settings saved.',
      c: {
        obsidianEmail: cfg.obsidian_email ? decrypt(cfg.obsidian_email) : '',
        vaultName: cfg.vault_name || '',
        anthropicApiKey: cfg.anthropic_api_key ? '••••' + decrypt(cfg.anthropic_api_key).slice(-8) : '',
        timezone: cfg.timezone || 'Asia/Kolkata',
        cronSchedule: cfg.cron_schedule || '0 6,21 * * *',
        enabled: !!cfg.enabled,
        hasObsidianPassword: !!cfg.obsidian_password,
        hasVaultEncryptionPassword: !!cfg.vault_encryption_password,
      },
    });
  } catch (err: any) {
    console.error('Settings save error:', err);
    res.render('settings', {
      error: 'Failed to save: ' + err.message,
      success: null,
      c: body,
    });
  }
});

// --- Run Now ---

router.post('/api/run-now', requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const manager = getManager(req);
  const status = manager.getUserStatus(userId);

  if (status.status === 'processing') {
    res.redirect('/dashboard');
    return;
  }

  // Fire and forget
  manager.runForUser(userId).catch(err => {
    console.error(`[run-now] Error for user ${userId}:`, err);
  });

  res.redirect('/dashboard');
});

// --- Status API (for htmx polling) ---

router.get('/api/status', requireAuth, (req, res) => {
  const userId = req.session.userId!;
  const manager = getManager(req);
  const s = manager.getUserStatus(userId);

  res.json(s);
});

export { router as webRoutes };
