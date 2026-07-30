import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import { validate as isValidCron } from 'node-cron';
import { z } from 'zod';
import type { ScheduledTask } from '@ppc/shared';
import type { Dispatch } from '../dispatch/dispatch.js';
import { asyncHandler } from '../http/async-handler.js';
import { BadRequestError, NotFoundError, isCheckConstraintError } from '../http/errors.js';
import type { Scheduler } from './scheduler.js';
import { runScheduledTask } from './run-task.js';

const targetKindSchema = z.enum(['device', 'group', 'all']);

const createScheduleSchema = z
  .object({
    name: z.string().min(1),
    cron: z.string().min(1).refine(isValidCron, { message: 'Not a valid cron expression' }),
    timezone: z.string().nullable().optional(),
    enabled: z.boolean().default(true),
    targetKind: targetKindSchema,
    targetId: z.number().int().nullable().optional(),
    actionKind: z.enum(['command', 'macro']),
    actionId: z.number().int(),
    param: z.string().nullable().optional(),
  })
  .refine((v) => (v.targetKind === 'all' ? v.targetId == null : v.targetId != null), {
    message: '"all" targets must omit targetId; "device"/"group" targets must set it',
    path: ['targetId'],
  });

const updateScheduleSchema = z.object({
  name: z.string().min(1).optional(),
  cron: z
    .string()
    .min(1)
    .refine(isValidCron, { message: 'Not a valid cron expression' })
    .optional(),
  timezone: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  targetKind: targetKindSchema.optional(),
  targetId: z.number().int().nullable().optional(),
  actionKind: z.enum(['command', 'macro']).optional(),
  actionId: z.number().int().optional(),
  param: z.string().nullable().optional(),
});

interface ScheduleRow {
  id: number;
  name: string;
  cron: string;
  timezone: string | null;
  enabled: number;
  target_kind: 'device' | 'group' | 'all';
  target_id: number | null;
  action_kind: 'command' | 'macro';
  action_id: number;
  param: string | null;
  last_run_at: string | null;
  last_result: string | null;
  created_at: string;
}

function toSchedule(row: ScheduleRow): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    timezone: row.timezone,
    enabled: row.enabled === 1,
    targetKind: row.target_kind,
    targetId: row.target_id,
    actionKind: row.action_kind,
    actionId: row.action_id,
    param: row.param,
    lastRunAt: row.last_run_at,
    lastResult: row.last_result,
    createdAt: row.created_at,
  };
}

function requireSchedule(db: DatabaseSync, id: number): ScheduledTask {
  const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduleRow | undefined;
  if (!row) throw new NotFoundError(`No scheduled task with id ${id}`);
  return toSchedule(row);
}

const SCHEDULE_COLUMN_MAP: Record<string, string> = {
  name: 'name',
  cron: 'cron',
  timezone: 'timezone',
  enabled: 'enabled',
  targetKind: 'target_kind',
  targetId: 'target_id',
  actionKind: 'action_kind',
  actionId: 'action_id',
  param: 'param',
};

/**
 * CRUD for scheduled_tasks, plus POST /:id/run to fire a task immediately —
 * lets a technician confirm a schedule does what they expect without
 * waiting for its actual cron time. Every mutating route calls
 * `scheduler.reload()` so the change takes effect without a process
 * restart, same pattern as triggers/routes.ts.
 */
export function schedulesRouter(db: DatabaseSync, scheduler: Scheduler, dispatch: Dispatch): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const rows = db.prepare('SELECT * FROM scheduled_tasks ORDER BY name').all() as unknown as ScheduleRow[];
    res.json(rows.map(toSchedule));
  });

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(requireSchedule(db, Number(req.params.id)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = createScheduleSchema.parse(req.body);
      let id: number;
      try {
        const info = db
          .prepare(
            `INSERT INTO scheduled_tasks
               (name, cron, timezone, enabled, target_kind, target_id, action_kind, action_id, param)
             VALUES
               (@name, @cron, @timezone, @enabled, @targetKind, @targetId, @actionKind, @actionId, @param)`,
          )
          .run({
            name: body.name,
            cron: body.cron,
            timezone: body.timezone ?? null,
            enabled: body.enabled ? 1 : 0,
            targetKind: body.targetKind,
            targetId: body.targetId ?? null,
            actionKind: body.actionKind,
            actionId: body.actionId,
            param: body.param ?? null,
          });
        id = Number(info.lastInsertRowid);
      } catch (err) {
        if (isCheckConstraintError(err)) {
          throw new BadRequestError('Invalid target/action combination for this scheduled task');
        }
        throw err;
      }

      scheduler.reload();
      res.status(201).json(requireSchedule(db, id));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      requireSchedule(db, id);
      const body = updateScheduleSchema.parse(req.body);

      const sets: string[] = [];
      const params: Record<string, string | number | null> = { id };
      for (const [key, column] of Object.entries(SCHEDULE_COLUMN_MAP)) {
        if (!(key in body)) continue;
        const value = (body as Record<string, unknown>)[key];
        sets.push(`${column} = @${key}`);
        params[key] = key === 'enabled' ? (value ? 1 : 0) : (value as string | number | null);
      }

      if (sets.length > 0) {
        try {
          db.prepare(`UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = @id`).run(params);
        } catch (err) {
          if (isCheckConstraintError(err)) {
            throw new BadRequestError('Invalid target/action combination for this scheduled task');
          }
          throw err;
        }
      }

      scheduler.reload();
      res.json(requireSchedule(db, id));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const info = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
      if (info.changes === 0) throw new NotFoundError(`No scheduled task with id ${id}`);
      scheduler.reload();
      res.status(204).end();
    }),
  );

  router.post(
    '/:id/run',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      requireSchedule(db, id);
      const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as unknown as ScheduleRow;
      await runScheduledTask(db, dispatch, row);
      res.json(requireSchedule(db, id));
    }),
  );

  return router;
}
