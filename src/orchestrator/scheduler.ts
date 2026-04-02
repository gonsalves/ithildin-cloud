import cron from 'node-cron';
import { DateTime } from 'luxon';
import type { Manager } from './manager.js';

interface ScheduledJob {
  task: cron.ScheduledTask;
  cronExpr: string;
  timezone: string;
}

export class Scheduler {
  private jobs = new Map<number, ScheduledJob>();

  constructor(private manager: Manager) {}

  /** Schedule a user's processing runs */
  scheduleUser(userId: number, cronExpr: string, timezone: string): void {
    // Stop existing job if any
    this.unscheduleUser(userId);

    if (!cron.validate(cronExpr)) {
      console.error(`[scheduler] Invalid cron expression for user ${userId}: ${cronExpr}`);
      return;
    }

    const task = cron.schedule(cronExpr, async () => {
      console.log(`[scheduler] Triggering processing for user ${userId}`);
      try {
        await this.manager.runForUser(userId);
      } catch (err) {
        console.error(`[scheduler] Error running for user ${userId}:`, err);
      }
    }, {
      timezone,
    });

    this.jobs.set(userId, { task, cronExpr, timezone });
    console.log(`[scheduler] User ${userId} scheduled: ${cronExpr} (${timezone})`);
  }

  /** Remove a user's scheduled job */
  unscheduleUser(userId: number): void {
    const job = this.jobs.get(userId);
    if (job) {
      job.task.stop();
      this.jobs.delete(userId);
    }
  }

  /** Stop all scheduled jobs */
  stopAll(): void {
    for (const [userId, job] of this.jobs) {
      job.task.stop();
    }
    this.jobs.clear();
  }

  /** Get the next run time for a user (approximate) */
  getNextRun(userId: number): Date | undefined {
    const job = this.jobs.get(userId);
    if (!job) return undefined;

    // Parse the cron expression to estimate next run
    // node-cron doesn't expose this, so we approximate
    return estimateNextCron(job.cronExpr, job.timezone);
  }

  /** Check if a user is scheduled */
  isScheduled(userId: number): boolean {
    return this.jobs.has(userId);
  }
}

/** Rough estimate of next cron fire time */
function estimateNextCron(cronExpr: string, timezone: string): Date | undefined {
  try {
    const parts = cronExpr.split(' ');
    if (parts.length !== 5) return undefined;

    const [minute, hour] = parts;
    const now = DateTime.now().setZone(timezone);

    // Handle comma-separated hours (e.g. "0 6,21 * * *")
    const hours = hour.split(',').map(Number).filter(h => !isNaN(h));
    const minutes = minute.split(',').map(Number).filter(m => !isNaN(m));

    if (hours.length === 0 || minutes.length === 0) return undefined;

    // Find the next matching time
    for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
      for (const h of hours) {
        for (const m of minutes) {
          const candidate = now.plus({ days: dayOffset }).set({ hour: h, minute: m, second: 0, millisecond: 0 });
          if (candidate > now) {
            return candidate.toJSDate();
          }
        }
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}
