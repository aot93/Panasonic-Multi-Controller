import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import { z } from 'zod';
import type { Macro, MacroStep } from '@ppc/shared';
import type { Dispatch } from '../dispatch/dispatch.js';
import { asyncHandler } from '../http/async-handler.js';
import {
  BadRequestError,
  NotFoundError,
  isForeignKeyConstraintError,
  isUniqueConstraintError,
} from '../http/errors.js';
import { canReach, loadMacroCallGraph } from './cycle.js';
import { runMacro } from './run-macro.js';

const targetKindSchema = z.enum(['device', 'group', 'all']);

const macroStepSchema = z
  .object({
    kind: z.enum(['command', 'macro']).optional(),
    commandId: z.number().int().nullable().optional(),
    childMacroId: z.number().int().nullable().optional(),
    param: z.string().nullable().optional(),
    delayMsAfter: z.number().int().min(0).default(200),
    targetKind: targetKindSchema.nullable().optional(),
    targetId: z.number().int().nullable().optional(),
  })
  .transform((v) => ({ ...v, kind: v.kind ?? (v.childMacroId != null ? ('macro' as const) : ('command' as const)) }))
  .refine((v) => !v.targetKind || (v.targetKind === 'all' ? v.targetId == null : v.targetId != null), {
    message: 'a step target override must satisfy: "all" omits targetId, "device"/"group" requires it',
    path: ['targetId'],
  })
  .refine((v) => (v.kind === 'command' ? v.commandId != null && v.childMacroId == null : v.childMacroId != null && v.commandId == null), {
    message: 'a "command" step needs commandId (and no childMacroId); a "macro" step needs childMacroId (and no commandId)',
    path: ['kind'],
  });

const createMacroSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  colour: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  sortOrder: z.number().int().default(0),
  steps: z.array(macroStepSchema).min(1, 'a macro needs at least one step'),
});

const updateMacroSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  colour: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  /** If provided, replaces the entire step sequence — a macro builder saves the whole thing at once. */
  steps: z.array(macroStepSchema).min(1).optional(),
});

const runMacroSchema = z.object({
  target: z.object({ kind: targetKindSchema, ids: z.array(z.number().int()).optional() }).optional(),
});

interface MacroRow {
  id: number;
  name: string;
  description: string | null;
  colour: string | null;
  icon: string | null;
  sort_order: number;
}

interface MacroStepRow {
  id: number;
  macro_id: number;
  seq: number;
  step_kind: MacroStep['kind'];
  command_id: number | null;
  child_macro_id: number | null;
  param: string | null;
  delay_ms_after: number;
  target_kind: MacroStep['targetKind'];
  target_id: number | null;
}

function toStep(row: MacroStepRow): MacroStep {
  return {
    id: row.id,
    macroId: row.macro_id,
    seq: row.seq,
    kind: row.step_kind,
    commandId: row.command_id,
    childMacroId: row.child_macro_id,
    param: row.param,
    delayMsAfter: row.delay_ms_after,
    targetKind: row.target_kind,
    targetId: row.target_id,
  };
}

function toMacro(row: MacroRow, steps: MacroStepRow[]): Macro {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    colour: row.colour,
    icon: row.icon,
    sortOrder: row.sort_order,
    steps: steps.map(toStep),
  };
}

function loadMacro(db: DatabaseSync, id: number): Macro | null {
  const row = db.prepare('SELECT * FROM macros WHERE id = ?').get(id) as MacroRow | undefined;
  if (!row) return null;
  const steps = db
    .prepare('SELECT * FROM macro_steps WHERE macro_id = ? ORDER BY seq')
    .all(id) as unknown as MacroStepRow[];
  return toMacro(row, steps);
}

function requireMacro(db: DatabaseSync, id: number): Macro {
  const macro = loadMacro(db, id);
  if (!macro) throw new NotFoundError(`No macro with id ${id}`);
  return macro;
}

function insertSteps(db: DatabaseSync, macroId: number, steps: z.infer<typeof macroStepSchema>[]): void {
  const insert = db.prepare(
    `INSERT INTO macro_steps (macro_id, seq, step_kind, command_id, child_macro_id, param, delay_ms_after, target_kind, target_id)
     VALUES (@macroId, @seq, @stepKind, @commandId, @childMacroId, @param, @delayMsAfter, @targetKind, @targetId)`,
  );
  steps.forEach((step, seq) => {
    insert.run({
      macroId,
      seq,
      stepKind: step.kind,
      commandId: step.commandId ?? null,
      childMacroId: step.childMacroId ?? null,
      param: step.param ?? null,
      delayMsAfter: step.delayMsAfter,
      targetKind: step.targetKind ?? null,
      targetId: step.targetId ?? null,
    });
  });
}

/**
 * Rejects a step that would call a macro already reachable "from below" —
 * i.e. one that (directly or transitively) already calls the macro these
 * steps belong to. `macroId` is null while creating a brand new macro,
 * where no cycle is possible: nothing can yet reference an id that doesn't
 * exist.
 */
function assertNoMacroCallCycle(db: DatabaseSync, macroId: number | null, steps: z.infer<typeof macroStepSchema>[]): void {
  if (macroId === null) return;
  const graph = loadMacroCallGraph(db);
  for (const step of steps) {
    if (step.kind !== 'macro') continue;
    const childId = step.childMacroId!;
    if (canReach(graph, childId, macroId)) {
      const childName = (db.prepare('SELECT name FROM macros WHERE id = ?').get(childId) as { name: string } | undefined)?.name ?? `#${childId}`;
      throw new BadRequestError(
        childId === macroId
          ? 'A macro step cannot call the macro it belongs to — that is an immediate loop'
          : `Calling macro "${childName}" here would create a call loop back to this macro`,
      );
    }
  }
}

/**
 * CRUD for macros (spec §5: "custom button" / "program a sequence of
 * actions"), plus POST /:id/run to execute one — the minimal execution
 * engine (run-macro.ts) built alongside this router so triggers/schedules
 * referencing a macro actually do something instead of returning
 * "not supported yet".
 */
export function macrosRouter(db: DatabaseSync, dispatch: Dispatch): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const rows = db.prepare('SELECT * FROM macros ORDER BY sort_order, name').all() as unknown as MacroRow[];
    res.json(rows.map((row) => loadMacro(db, row.id)));
  });

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(requireMacro(db, Number(req.params.id)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = createMacroSchema.parse(req.body);
      assertNoMacroCallCycle(db, null, body.steps);
      let macroId: number;
      try {
        const info = db
          .prepare(
            'INSERT INTO macros (name, description, colour, icon, sort_order) VALUES (@name, @description, @colour, @icon, @sortOrder)',
          )
          .run({
            name: body.name,
            description: body.description ?? null,
            colour: body.colour ?? null,
            icon: body.icon ?? null,
            sortOrder: body.sortOrder,
          });
        macroId = Number(info.lastInsertRowid);
        insertSteps(db, macroId, body.steps);
      } catch (err) {
        if (isUniqueConstraintError(err)) throw new BadRequestError(`A macro named "${body.name}" already exists`);
        if (isForeignKeyConstraintError(err)) throw new BadRequestError('A step references a commandId or childMacroId that does not exist');
        throw err;
      }
      res.status(201).json(requireMacro(db, macroId));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const macroId = Number(req.params.id);
      requireMacro(db, macroId);
      const body = updateMacroSchema.parse(req.body);
      if (body.steps) assertNoMacroCallCycle(db, macroId, body.steps);

      const sets: string[] = [];
      const params: Record<string, string | number | null> = { id: macroId };
      if ('name' in body) {
        sets.push('name = @name');
        params.name = body.name!;
      }
      if ('description' in body) {
        sets.push('description = @description');
        params.description = body.description ?? null;
      }
      if ('colour' in body) {
        sets.push('colour = @colour');
        params.colour = body.colour ?? null;
      }
      if ('icon' in body) {
        sets.push('icon = @icon');
        params.icon = body.icon ?? null;
      }
      if ('sortOrder' in body) {
        sets.push('sort_order = @sortOrder');
        params.sortOrder = body.sortOrder!;
      }

      try {
        if (sets.length > 0) {
          db.prepare(`UPDATE macros SET ${sets.join(', ')} WHERE id = @id`).run(params);
        }
        if (body.steps) {
          db.prepare('DELETE FROM macro_steps WHERE macro_id = ?').run(macroId);
          insertSteps(db, macroId, body.steps);
        }
      } catch (err) {
        if (isUniqueConstraintError(err)) throw new BadRequestError(`A macro named "${body.name}" already exists`);
        if (isForeignKeyConstraintError(err)) throw new BadRequestError('A step references a commandId or childMacroId that does not exist');
        throw err;
      }

      res.json(requireMacro(db, macroId));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const macroId = Number(req.params.id);
      let info;
      try {
        info = db.prepare('DELETE FROM macros WHERE id = ?').run(macroId);
      } catch (err) {
        if (isForeignKeyConstraintError(err)) {
          throw new BadRequestError('This macro is still called by a step in another macro — remove that step first');
        }
        throw err;
      }
      if (info.changes === 0) throw new NotFoundError(`No macro with id ${macroId}`);
      res.status(204).end();
    }),
  );

  router.post(
    '/:id/run',
    asyncHandler(async (req, res) => {
      const macroId = Number(req.params.id);
      requireMacro(db, macroId);
      const body = runMacroSchema.parse(req.body ?? {});
      const result = await runMacro(db, dispatch, macroId, body.target ?? null, 'ui');
      res.json(result);
    }),
  );

  return router;
}
