import type { DatabaseSync } from 'node:sqlite';
import { schedule, type ScheduledTask as CronJob } from 'node-cron';
import type { Dispatch } from '../dispatch/dispatch.js';
import { runScheduledTask, type ScheduledTaskRow } from './run-task.js';

/**
 * node-cron-based task runner for calendar-based automation (spec §2:
 * "shut down all units at 10 PM to preserve lamp life"). Loads every enabled
 * row from `scheduled_tasks` and registers a cron job per row; each job
 * fires through the SAME `Dispatch` function phase 4 built for the HTTP
 * route and the external trigger server, rather than a separate execution
 * path — a schedule is just a third way to trigger a dispatch.
 *
 * `reload()` fully tears down and re-registers every job. Simpler than
 * diffing the job set against what changed, and schedule edits are a rare,
 * low-frequency admin action — not worth the extra bookkeeping. Matches the
 * same restart-on-settings-change pattern as
 * triggers/external-trigger-server.ts.
 */
export class Scheduler {
  private jobs = new Map<number, CronJob>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly dispatch: Dispatch,
  ) {}

  get activeTaskIds(): number[] {
    return [...this.jobs.keys()];
  }

  start(): void {
    if (this.jobs.size > 0) return;
    const rows = this.db
      .prepare(
        `SELECT id, name, cron, timezone, target_kind, target_id, action_kind, action_id, param
         FROM scheduled_tasks WHERE enabled = 1`,
      )
      .all() as unknown as (ScheduledTaskRow & { cron: string; timezone: string | null })[];

    for (const row of rows) this.scheduleRow(row);
  }

  stop(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }

  /** Re-reads scheduled_tasks and re-registers every enabled job — called after any CRUD change so edits take effect immediately. */
  reload(): void {
    this.stop();
    this.start();
  }

  private scheduleRow(row: ScheduledTaskRow & { cron: string; timezone: string | null }): void {
    const job = schedule(
      row.cron,
      () => {
        void runScheduledTask(this.db, this.dispatch, row);
      },
      row.timezone ? { timezone: row.timezone } : undefined,
    );
    this.jobs.set(row.id, job);
  }
}
