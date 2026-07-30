import type { DatabaseSync } from 'node:sqlite';
import type { CommandTarget, MacroRunResult, MacroStepOutcome, TargetKind } from '@ppc/shared';
import type { Dispatch } from '../dispatch/dispatch.js';
import { NotFoundError } from '../http/errors.js';

export interface MacroStepRow {
  id: number;
  macro_id: number;
  seq: number;
  command_id: number;
  param: string | null;
  delay_ms_after: number;
  target_kind: TargetKind | null;
  target_id: number | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one macro's steps in sequence, honouring each step's configured
 * delay afterward. A step resolves its target from its own override
 * (`macro_steps.target_kind`/`target_id`) if set, else falls back to
 * whatever target the caller invoked the macro against — e.g. a custom
 * button bound to "close shutter, wait, power off" run against a group.
 *
 * Deliberately minimal: steps run strictly in order and a step that cannot
 * even be dispatched (bad command reference, no resolvable target — a
 * thrown error, not a per-device failure) stops the whole run. A partial
 * per-device failure within a step (e.g. 2 of 3 devices in a group
 * succeeded) is NOT itself fatal to the sequence — that mirrors how
 * dispatch() already treats group/all targets, and halting an entire
 * multi-step macro because one device had a network blip would often do
 * more harm than continuing.
 */
export async function runMacro(
  db: DatabaseSync,
  dispatch: Dispatch,
  macroId: number,
  invocationTarget: CommandTarget | null,
  source: string,
): Promise<MacroRunResult> {
  const steps = db
    .prepare('SELECT * FROM macro_steps WHERE macro_id = ? ORDER BY seq')
    .all(macroId) as unknown as MacroStepRow[];

  if (steps.length === 0) {
    throw new NotFoundError(`Macro ${macroId} has no steps, or does not exist`);
  }

  const outcomes: MacroStepOutcome[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const target: CommandTarget | null = step.target_kind
      ? { kind: step.target_kind, ids: step.target_id !== null ? [step.target_id] : undefined }
      : invocationTarget;

    if (!target) {
      outcomes.push({
        seq: step.seq,
        commandId: step.command_id,
        ok: false,
        error: 'No target resolved for this step (no per-step override and none supplied by the caller)',
        results: null,
      });
      break;
    }

    try {
      const { results } = await dispatch(target, { commandId: step.command_id }, step.param, source);
      outcomes.push({ seq: step.seq, commandId: step.command_id, ok: results.every((r) => r.ok), error: null, results });
    } catch (err) {
      outcomes.push({
        seq: step.seq,
        commandId: step.command_id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        results: null,
      });
      break;
    }

    const isLastStep = i === steps.length - 1;
    if (!isLastStep && step.delay_ms_after > 0) await sleep(step.delay_ms_after);
  }

  return { macroId, ok: outcomes.length === steps.length && outcomes.every((o) => o.ok), steps: outcomes };
}

/** Turns a MacroRunResult into a one-line summary for scheduled_tasks.last_result / trigger fire logging. */
export function summarizeMacroRun(result: MacroRunResult): string {
  const succeeded = result.steps.filter((s) => s.ok).length;
  const summary = `Macro: ${succeeded}/${result.steps.length} steps completed`;
  const firstFailure = result.steps.find((s) => !s.ok);
  return firstFailure ? `${summary} (step ${firstFailure.seq} failed: ${firstFailure.error ?? 'device failure'})` : summary;
}
