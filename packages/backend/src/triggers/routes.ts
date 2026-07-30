import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import { z } from 'zod';
import type { ExternalTrigger } from '@ppc/shared';
import { asyncHandler } from '../http/async-handler.js';
import { BadRequestError, NotFoundError, isUniqueConstraintError } from '../http/errors.js';
import { getBooleanSetting, getNumberSetting, setSetting } from '../poller/settings.js';
import type { ExternalTriggerServer } from './external-trigger-server.js';

const targetKindSchema = z.enum(['device', 'group', 'all']);

const createTriggerSchema = z
  .object({
    triggerKey: z.string().min(1),
    description: z.string().nullable().optional(),
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

const updateTriggerSchema = z.object({
  description: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  targetKind: targetKindSchema.optional(),
  targetId: z.number().int().nullable().optional(),
  actionKind: z.enum(['command', 'macro']).optional(),
  actionId: z.number().int().optional(),
  param: z.string().nullable().optional(),
});

const triggerSettingsSchema = z.object({
  enabled: z.boolean(),
  tcpPort: z.number().int().min(1).max(65535),
  udpPort: z.number().int().min(1).max(65535),
});

interface TriggerRow {
  id: number;
  trigger_key: string;
  description: string | null;
  enabled: number;
  target_kind: 'device' | 'group' | 'all';
  target_id: number | null;
  action_kind: 'command' | 'macro';
  action_id: number;
  param: string | null;
  last_fired_at: string | null;
  created_at: string;
}

function toTrigger(row: TriggerRow): ExternalTrigger {
  return {
    id: row.id,
    triggerKey: row.trigger_key,
    description: row.description,
    enabled: row.enabled === 1,
    targetKind: row.target_kind,
    targetId: row.target_id,
    actionKind: row.action_kind,
    actionId: row.action_id,
    param: row.param,
    lastFiredAt: row.last_fired_at,
    createdAt: row.created_at,
  };
}

function requireTrigger(db: DatabaseSync, id: number): ExternalTrigger {
  const row = db.prepare('SELECT * FROM external_triggers WHERE id = ?').get(id) as TriggerRow | undefined;
  if (!row) throw new NotFoundError(`No trigger with id ${id}`);
  return toTrigger(row);
}

const TRIGGER_COLUMN_MAP: Record<string, string> = {
  description: 'description',
  enabled: 'enabled',
  targetKind: 'target_kind',
  targetId: 'target_id',
  actionKind: 'action_kind',
  actionId: 'action_id',
  param: 'param',
};

/** CRUD for external_triggers, plus a settings sub-route for the listener itself (enabled/ports) — spec §6. */
export function triggersRouter(db: DatabaseSync, triggerServer: ExternalTriggerServer): Router {
  const router = Router();

  // Registered before "/:id" so "settings" is never swallowed as an id.
  router.get('/settings', (_req, res) => {
    res.json({
      enabled: getBooleanSetting(db, 'external_trigger_enabled', false),
      tcpPort: getNumberSetting(db, 'external_trigger_tcp_port', 5000),
      udpPort: getNumberSetting(db, 'external_trigger_udp_port', 5000),
      running: triggerServer.isRunning,
    });
  });

  router.put(
    '/settings',
    asyncHandler(async (req, res) => {
      const body = triggerSettingsSchema.parse(req.body);
      setSetting(db, 'external_trigger_enabled', body.enabled ? '1' : '0');
      setSetting(db, 'external_trigger_tcp_port', String(body.tcpPort));
      setSetting(db, 'external_trigger_udp_port', String(body.udpPort));
      await triggerServer.restart();
      res.json({ enabled: body.enabled, tcpPort: body.tcpPort, udpPort: body.udpPort, running: triggerServer.isRunning });
    }),
  );

  router.get('/', (_req, res) => {
    const rows = db.prepare('SELECT * FROM external_triggers ORDER BY trigger_key').all() as unknown as TriggerRow[];
    res.json(rows.map(toTrigger));
  });

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(requireTrigger(db, Number(req.params.id)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = createTriggerSchema.parse(req.body);
      let id: number;
      try {
        const info = db
          .prepare(
            `INSERT INTO external_triggers
               (trigger_key, description, target_kind, target_id, action_kind, action_id, param)
             VALUES (@triggerKey, @description, @targetKind, @targetId, @actionKind, @actionId, @param)`,
          )
          .run({
            triggerKey: body.triggerKey,
            description: body.description ?? null,
            targetKind: body.targetKind,
            targetId: body.targetId ?? null,
            actionKind: body.actionKind,
            actionId: body.actionId,
            param: body.param ?? null,
          });
        id = Number(info.lastInsertRowid);
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          throw new BadRequestError(`A trigger with key "${body.triggerKey}" already exists`);
        }
        throw err;
      }
      res.status(201).json(requireTrigger(db, id));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      requireTrigger(db, id);
      const body = updateTriggerSchema.parse(req.body);

      const sets: string[] = [];
      const params: Record<string, string | number | null> = { id };
      for (const [key, column] of Object.entries(TRIGGER_COLUMN_MAP)) {
        if (!(key in body)) continue;
        const value = (body as Record<string, unknown>)[key];
        sets.push(`${column} = @${key}`);
        params[key] = key === 'enabled' ? (value ? 1 : 0) : (value as string | number | null);
      }
      if (sets.length > 0) {
        db.prepare(`UPDATE external_triggers SET ${sets.join(', ')} WHERE id = @id`).run(params);
      }

      res.json(requireTrigger(db, id));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const info = db.prepare('DELETE FROM external_triggers WHERE id = ?').run(id);
      if (info.changes === 0) throw new NotFoundError(`No trigger with id ${id}`);
      res.status(204).end();
    }),
  );

  return router;
}
