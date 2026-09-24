import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import { z } from 'zod';
import type { ProjectFile } from '@ppc/shared';
import { asyncHandler } from '../http/async-handler.js';
import { BadRequestError } from '../http/errors.js';
import type { Poller } from '../poller/poller.js';
import { exportProject, importProject } from './export-import.js';

const targetRefSchema = z.union([
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('group'), groupName: z.string().min(1) }),
  z.object({ kind: z.literal('device'), host: z.string().min(1), port: z.number().int() }),
]);

const actionRefSchema = z.union([
  z.object({ kind: z.literal('command'), commandKey: z.string().min(1) }),
  z.object({ kind: z.literal('macro'), macroName: z.string().min(1) }),
]);

const paramOptionSchema = z.object({ label: z.string(), value: z.string() });

/**
 * A macro step's action reference used to be a bare `commandKey` (format 1
 * — every step was a command, macro-calling-macro didn't exist yet). Format
 * 2 replaced it with `action: ProjectActionRef` so a step can name a macro
 * instead. Accept both on import — files exported before this change
 * shouldn't suddenly stop loading — normalizing the legacy shape into the
 * current one so the rest of the pipeline only ever sees `action`.
 */
const macroStepSchema = z.union([
  z.object({
    action: actionRefSchema,
    param: z.string().nullable(),
    delayMsAfter: z.number().int().min(0),
    target: targetRefSchema.nullable(),
  }),
  z
    .object({
      commandKey: z.string().min(1),
      param: z.string().nullable(),
      delayMsAfter: z.number().int().min(0),
      target: targetRefSchema.nullable(),
    })
    .transform(({ commandKey, ...rest }) => ({ ...rest, action: { kind: 'command' as const, commandKey } })),
]);

const projectFileSchema = z.object({
  formatVersion: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string(),
  appName: z.literal('panasonic-multi-controller'),
  devices: z.array(
    z.object({
      name: z.string().min(1),
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      location: z.string().nullable(),
      notes: z.string().nullable(),
      pollIntervalSec: z.number().int().nullable(),
      groupNames: z.array(z.string()),
    }),
  ),
  groups: z.array(z.object({ name: z.string().min(1), description: z.string().nullable(), sortOrder: z.number().int() })),
  commands: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      category: z.string().min(1),
      body: z.string().min(1),
      isQuery: z.boolean(),
      paramKind: z.enum(['none', 'enum', 'integer', 'string']),
      paramOptions: z.array(paramOptionSchema).nullable(),
      paramMin: z.number().int().nullable(),
      paramMax: z.number().int().nullable(),
      favourite: z.boolean(),
      sortOrder: z.number().int(),
      description: z.string().nullable(),
    }),
  ),
  macros: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().nullable(),
      colour: z.string().nullable(),
      icon: z.string().nullable(),
      sortOrder: z.number().int(),
      steps: z.array(macroStepSchema),
    }),
  ),
  schedules: z.array(
    z.object({
      name: z.string().min(1),
      cron: z.string().min(1),
      timezone: z.string().nullable(),
      enabled: z.boolean(),
      target: targetRefSchema,
      action: actionRefSchema,
      param: z.string().nullable(),
    }),
  ),
  triggers: z.array(
    z.object({
      triggerKey: z.string().min(1),
      description: z.string().nullable(),
      enabled: z.boolean(),
      target: targetRefSchema,
      action: actionRefSchema,
      param: z.string().nullable(),
    }),
  ),
});

/**
 * Save/load a whole configuration (NextSteps.md phase 1 item 3). Export
 * streams the current config as a downloadable JSON file; import applies one
 * back, additively (existing rows are never modified or deleted — see
 * project/export-import.ts for the create-vs-skip rules per resource type).
 */
export function projectRouter(db: DatabaseSync, poller: Poller): Router {
  const router = Router();

  router.get('/export', (_req, res) => {
    const file = exportProject(db);
    res.setHeader('Content-Disposition', `attachment; filename="ppc-project-${Date.now()}.json"`);
    res.json(file);
  });

  router.post(
    '/import',
    asyncHandler(async (req, res) => {
      const parsed = projectFileSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError(`Not a valid project file: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      }
      const result = importProject(db, { ...parsed.data, formatVersion: 2 } as ProjectFile);
      if (result.createdDeviceIds.length > 0) {
        poller.pollNow(result.createdDeviceIds).catch((err: unknown) => {
          console.error('[project] post-import poll failed:', err);
        });
      }
      res.json(result);
    }),
  );

  return router;
}
