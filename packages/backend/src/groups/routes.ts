import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import { z } from 'zod';
import type { GroupWithCount } from '@ppc/shared';
import { asyncHandler } from '../http/async-handler.js';
import { BadRequestError, NotFoundError, isUniqueConstraintError } from '../http/errors.js';

const createGroupSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const updateGroupSchema = createGroupSchema.partial();

const SELECT_GROUPS_WITH_COUNT = `
  SELECT g.id, g.name, g.description, g.sort_order, g.created_at,
         (SELECT COUNT(*) FROM device_groups dg WHERE dg.group_id = g.id) AS device_count
  FROM groups g
`;

interface GroupRow {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  device_count: number;
}

function toGroup(row: GroupRow): GroupWithCount {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    deviceCount: row.device_count,
  };
}

function requireGroup(db: DatabaseSync, id: number): GroupWithCount {
  const row = db.prepare(`${SELECT_GROUPS_WITH_COUNT} WHERE g.id = ?`).get(id) as GroupRow | undefined;
  if (!row) throw new NotFoundError(`No group with id ${id}`);
  return toGroup(row);
}

export function groupsRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const rows = db.prepare(`${SELECT_GROUPS_WITH_COUNT} ORDER BY g.sort_order, g.name`).all() as unknown as GroupRow[];
    res.json(rows.map(toGroup));
  });

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(requireGroup(db, Number(req.params.id)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = createGroupSchema.parse(req.body);
      let groupId: number;
      try {
        const info = db
          .prepare('INSERT INTO groups (name, description, sort_order) VALUES (@name, @description, @sortOrder)')
          .run({ name: body.name, description: body.description ?? null, sortOrder: body.sortOrder ?? 0 });
        groupId = Number(info.lastInsertRowid);
      } catch (err) {
        if (isUniqueConstraintError(err)) throw new BadRequestError(`A group named "${body.name}" already exists`);
        throw err;
      }
      res.status(201).json(requireGroup(db, groupId));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const groupId = Number(req.params.id);
      requireGroup(db, groupId);
      const body = updateGroupSchema.parse(req.body);

      const sets: string[] = [];
      const params: Record<string, string | number | null> = { id: groupId };
      if ('name' in body) {
        sets.push('name = @name');
        params.name = body.name!;
      }
      if ('description' in body) {
        sets.push('description = @description');
        params.description = body.description ?? null;
      }
      if ('sortOrder' in body) {
        sets.push('sort_order = @sortOrder');
        params.sortOrder = body.sortOrder!;
      }

      if (sets.length > 0) {
        try {
          db.prepare(`UPDATE groups SET ${sets.join(', ')} WHERE id = @id`).run(params);
        } catch (err) {
          if (isUniqueConstraintError(err)) throw new BadRequestError(`A group named "${body.name}" already exists`);
          throw err;
        }
      }

      res.json(requireGroup(db, groupId));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const groupId = Number(req.params.id);
      const info = db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
      if (info.changes === 0) throw new NotFoundError(`No group with id ${groupId}`);
      res.status(204).end();
    }),
  );

  return router;
}
