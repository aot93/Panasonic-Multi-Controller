import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import { z } from 'zod';
import type { CommandDef } from '@ppc/shared';
import { asyncHandler } from '../http/async-handler.js';
import { BadRequestError, NotFoundError, isUniqueConstraintError } from '../http/errors.js';

const paramOptionSchema = z.object({ label: z.string(), value: z.string() });

const createCommandSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    category: z.string().min(1).default('General'),
    body: z.string().min(1),
    isQuery: z.boolean().default(false),
    paramKind: z.enum(['none', 'enum', 'integer', 'string']).default('none'),
    paramOptions: z.array(paramOptionSchema).nullable().optional(),
    paramMin: z.number().int().nullable().optional(),
    paramMax: z.number().int().nullable().optional(),
    profileId: z.number().int().nullable().optional(),
    favourite: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
    description: z.string().nullable().optional(),
  })
  .refine((v) => v.paramKind !== 'enum' || (v.paramOptions && v.paramOptions.length > 0), {
    message: 'paramOptions is required and must be non-empty when paramKind is "enum"',
    path: ['paramOptions'],
  });

// key and paramKind are immutable post-creation — see requireNotKeyChange below.
const updateCommandSchema = z.object({
  label: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  isQuery: z.boolean().optional(),
  paramOptions: z.array(paramOptionSchema).nullable().optional(),
  paramMin: z.number().int().nullable().optional(),
  paramMax: z.number().int().nullable().optional(),
  profileId: z.number().int().nullable().optional(),
  favourite: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  description: z.string().nullable().optional(),
});

interface CommandRow {
  id: number;
  key: string;
  label: string;
  category: string;
  body: string;
  is_query: number;
  param_kind: CommandDef['paramKind'];
  param_options: string | null;
  param_min: number | null;
  param_max: number | null;
  profile_id: number | null;
  built_in: number;
  favourite: number;
  sort_order: number;
  description: string | null;
}

function toCommandDef(row: CommandRow): CommandDef {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    category: row.category,
    body: row.body,
    isQuery: row.is_query === 1,
    paramKind: row.param_kind,
    paramOptions: row.param_options ? JSON.parse(row.param_options) : null,
    paramMin: row.param_min,
    paramMax: row.param_max,
    profileId: row.profile_id,
    builtIn: row.built_in === 1,
    favourite: row.favourite === 1,
    sortOrder: row.sort_order,
    description: row.description,
  };
}

function requireCommand(db: DatabaseSync, id: number): CommandDef {
  const row = db.prepare('SELECT * FROM commands WHERE id = ?').get(id) as CommandRow | undefined;
  if (!row) throw new NotFoundError(`No command with id ${id}`);
  return toCommandDef(row);
}

/**
 * The command catalogue — data, not code, so operators can extend it beyond
 * the built-in set (spec §4: "allow the user to add commands as required").
 * Built-in rows (seeded from the verified RQ35K/RZ34K command list, see
 * db/seed.ts) can be edited but never deleted, and their `key`/`paramKind`
 * are immutable everywhere to keep dispatch logic (which switches on
 * paramKind) and any stored references to `key` from breaking underfoot.
 */
export function commandsRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const rows = db.prepare('SELECT * FROM commands ORDER BY category, sort_order').all() as unknown as CommandRow[];
    res.json(rows.map(toCommandDef));
  });

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(requireCommand(db, Number(req.params.id)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = createCommandSchema.parse(req.body);
      let commandId: number;
      try {
        const info = db
          .prepare(
            `INSERT INTO commands
               (key, label, category, body, is_query, param_kind, param_options,
                param_min, param_max, profile_id, built_in, favourite, sort_order, description)
             VALUES
               (@key, @label, @category, @body, @isQuery, @paramKind, @paramOptions,
                @paramMin, @paramMax, @profileId, 0, @favourite, @sortOrder, @description)`,
          )
          .run({
            key: body.key,
            label: body.label,
            category: body.category,
            body: body.body,
            isQuery: body.isQuery ? 1 : 0,
            paramKind: body.paramKind,
            paramOptions: body.paramOptions ? JSON.stringify(body.paramOptions) : null,
            paramMin: body.paramMin ?? null,
            paramMax: body.paramMax ?? null,
            profileId: body.profileId ?? null,
            favourite: body.favourite ? 1 : 0,
            sortOrder: body.sortOrder,
            description: body.description ?? null,
          });
        commandId = Number(info.lastInsertRowid);
      } catch (err) {
        if (isUniqueConstraintError(err)) throw new BadRequestError(`A command with key "${body.key}" already exists`);
        throw err;
      }
      res.status(201).json(requireCommand(db, commandId));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const commandId = Number(req.params.id);
      requireCommand(db, commandId);
      const body = updateCommandSchema.parse(req.body);

      const columnMap: Record<string, string> = {
        label: 'label',
        category: 'category',
        body: 'body',
        isQuery: 'is_query',
        paramMin: 'param_min',
        paramMax: 'param_max',
        profileId: 'profile_id',
        favourite: 'favourite',
        sortOrder: 'sort_order',
        description: 'description',
      };

      const sets: string[] = [];
      const params: Record<string, string | number | null> = { id: commandId };
      for (const [key, column] of Object.entries(columnMap)) {
        if (!(key in body)) continue;
        const value = (body as Record<string, unknown>)[key];
        sets.push(`${column} = @${key}`);
        params[key] = key === 'isQuery' || key === 'favourite' ? (value ? 1 : 0) : (value as string | number | null);
      }
      if ('paramOptions' in body) {
        sets.push('param_options = @paramOptions');
        params.paramOptions = body.paramOptions ? JSON.stringify(body.paramOptions) : null;
      }

      if (sets.length > 0) {
        db.prepare(`UPDATE commands SET ${sets.join(', ')} WHERE id = @id`).run(params);
      }

      res.json(requireCommand(db, commandId));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const commandId = Number(req.params.id);
      const existing = requireCommand(db, commandId);
      if (existing.builtIn) throw new BadRequestError('Built-in commands cannot be deleted, only edited');
      db.prepare('DELETE FROM commands WHERE id = ?').run(commandId);
      res.status(204).end();
    }),
  );

  return router;
}
