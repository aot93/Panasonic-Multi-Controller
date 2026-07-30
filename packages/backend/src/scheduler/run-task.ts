import type { DatabaseSync } from 'node:sqlite';
import type { CommandTarget, TargetKind } from '@ppc/shared';
import type { Dispatch } from '../dispatch/dispatch.js';
import { runMacro, summarizeMacroRun } from '../macros/run-macro.js';

export interface ScheduledTaskRow {
  id: number;
  name: string;
  target_kind: TargetKind;
  target_id: number | null;
  action_kind: 'command' | 'macro';
  action_id: number;
  param: string | null;
}

/**
 * Executes one scheduled task's action and records the outcome — the same
 * "fire a dispatch, log what happened" shape as the external trigger
 * server's `fire()`, but against `scheduled_tasks.last_run_at`/`last_result`
 * instead of `external_triggers.last_fired_at`.
 *
 * Kept separate from the node-cron wiring in scheduler.ts so it can be
 * tested directly, deterministically, without waiting on real cron timing.
 */
export async function runScheduledTask(db: DatabaseSync, dispatch: Dispatch, task: ScheduledTaskRow): Promise<void> {
  const nowIso = new Date().toISOString();
  let resultSummary: string;

  try {
    const target: CommandTarget = {
      kind: task.target_kind,
      ids: task.target_id !== null ? [task.target_id] : undefined,
    };

    if (task.action_kind === 'command') {
      const { results } = await dispatch(target, { commandId: task.action_id }, task.param, 'schedule');
      const okCount = results.filter((r) => r.ok).length;
      resultSummary = `${okCount}/${results.length} succeeded`;
      const firstFailure = results.find((r) => !r.ok);
      if (firstFailure) {
        resultSummary += ` (e.g. ${firstFailure.deviceName}: ${firstFailure.error})`;
      }
    } else {
      const result = await runMacro(db, dispatch, task.action_id, target, 'schedule');
      resultSummary = summarizeMacroRun(result);
    }
  } catch (err) {
    resultSummary = `Error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[scheduler] task "${task.name}" (#${task.id}) failed:`, err);
  }

  db.prepare('UPDATE scheduled_tasks SET last_run_at = ?, last_result = ? WHERE id = ?').run(
    nowIso,
    resultSummary,
    task.id,
  );
}
