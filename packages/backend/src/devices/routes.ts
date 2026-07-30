import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import { z } from 'zod';
import type { BulkCreateDeviceResult, TelemetryMetric, TelemetrySample } from '@ppc/shared';
import { setDeviceCredentials } from '../credentials/store.js';
import { asyncHandler } from '../http/async-handler.js';
import { BadRequestError, NotFoundError, isUniqueConstraintError } from '../http/errors.js';
import { parseIpRange } from './ip-range.js';
import type { Poller } from '../poller/poller.js';
import { getDeviceWithState, listDevicesWithState } from './read-model.js';

const TELEMETRY_METRICS = ['temp_intake', 'temp_exhaust', 'lamp_hours', 'projector_runtime', 'latency_ms'] as const;

const telemetryQuerySchema = z.object({
  metric: z.enum(TELEMETRY_METRICS).optional(),
  idx: z.coerce.number().int().min(0).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

interface TelemetryRow {
  device_id: number;
  metric: TelemetryMetric;
  idx: number;
  value: number;
  recorded_at: string;
}

function toSample(row: TelemetryRow): TelemetrySample {
  return { deviceId: row.device_id, metric: row.metric, idx: row.idx, value: row.value, recordedAt: row.recorded_at };
}

const createDeviceSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  location: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  profileId: z.number().int().nullable().optional(),
  pollIntervalSec: z.number().int().positive().nullable().optional(),
});

const updateDeviceSchema = createDeviceSchema.partial().extend({
  enabled: z.boolean().optional(),
});

const credentialsSchema = z.object({
  username: z.string().min(1).nullable().optional(),
  password: z.string().min(1).nullable().optional(),
});

const groupIdsSchema = z.object({ groupIds: z.array(z.number().int()) });

const bulkCreateSchema = z.object({
  namePrefix: z.string().nullable().optional(),
  startIp: z.string().min(1),
  endIp: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  pollIntervalSec: z.number().int().positive().nullable().optional(),
});

const UPDATE_COLUMN_MAP: Record<string, string> = {
  name: 'name',
  host: 'host',
  port: 'port',
  location: 'location',
  notes: 'notes',
  profileId: 'profile_id',
  pollIntervalSec: 'poll_interval_sec',
  enabled: 'enabled',
};

function requireDevice(db: DatabaseSync, id: number) {
  const device = getDeviceWithState(db, id);
  if (!device) throw new NotFoundError(`No device with id ${id}`);
  return device;
}

interface InsertDeviceInput {
  name: string;
  host: string;
  port: number;
  location?: string | null;
  notes?: string | null;
  profileId?: number | null;
  pollIntervalSec?: number | null;
}

/** Shared by the single-device and bulk-by-IP-range create routes — the only difference between them is how each handles a thrown BadRequestError (fail the whole request vs. record it per-IP and continue). */
function insertDevice(db: DatabaseSync, input: InsertDeviceInput): number {
  try {
    const info = db
      .prepare(
        `INSERT INTO devices (name, host, port, location, notes, profile_id, poll_interval_sec)
         VALUES (@name, @host, @port, @location, @notes, @profileId, @pollIntervalSec)`,
      )
      .run({
        name: input.name,
        host: input.host,
        port: input.port,
        location: input.location ?? null,
        notes: input.notes ?? null,
        profileId: input.profileId ?? null,
        pollIntervalSec: input.pollIntervalSec ?? null,
      });
    return Number(info.lastInsertRowid);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new BadRequestError(`A device already exists at ${input.host}:${input.port}`);
    }
    throw err;
  }
}

/**
 * Device registration/management — phase 4. Reads are delegated to
 * devices/read-model.ts (phase 3), which already serves GET /api/devices and
 * the devices:subscribe socket snapshot with identical shape.
 *
 * Credential editing is a distinct sub-resource
 * (PUT/DELETE /:id/credentials) rather than fields on the device body: it's
 * conceptually separate (write-only, encrypted, resolved with fallback to a
 * global default — see credentials/store.ts) and deserves not to be
 * accidentally clobbered by a routine PATCH of, say, the device's location.
 */
export function devicesRouter(db: DatabaseSync, poller: Poller): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(listDevicesWithState(db));
  });

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(requireDevice(db, Number(req.params.id)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = createDeviceSchema.parse(req.body);
      const port = body.port ?? 1024;
      const deviceId = insertDevice(db, { ...body, port });

      // Give the dashboard a result within moments instead of waiting for
      // the next scheduled poll tick. Fire-and-forget, but caught: if the
      // device gets deleted before this in-flight poll resolves, the write
      // it attempts will fail its foreign key and must not become an
      // unhandled rejection.
      poller.pollNow([deviceId]).catch((err: unknown) => {
        console.error(`[devices] post-create poll of device ${deviceId} failed:`, err);
      });

      res.status(201).json(requireDevice(db, deviceId));
    }),
  );

  /** Add multiple devices at once from an IP range, e.g. 192.168.1.10-192.168.1.20. */
  router.post(
    '/bulk',
    asyncHandler(async (req, res) => {
      const body = bulkCreateSchema.parse(req.body);
      const ips = parseIpRange(body.startIp, body.endIp);
      const port = body.port ?? 1024;
      const prefix = body.namePrefix?.trim();

      const results: BulkCreateDeviceResult[] = [];
      const createdIds: number[] = [];

      for (const ip of ips) {
        try {
          const deviceId = insertDevice(db, {
            name: prefix ? `${prefix} ${ip}` : ip,
            host: ip,
            port,
            pollIntervalSec: body.pollIntervalSec,
          });
          createdIds.push(deviceId);
          results.push({ ip, ok: true, device: requireDevice(db, deviceId) });
        } catch (err) {
          results.push({ ip, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }

      // One combined poll for the whole batch rather than one fire-and-forget
      // per device — same "don't make the dashboard wait for the next tick"
      // reasoning as the single-create route, just batched.
      if (createdIds.length > 0) {
        poller.pollNow(createdIds).catch((err: unknown) => {
          console.error(`[devices] post-bulk-create poll of [${createdIds.join(', ')}] failed:`, err);
        });
      }

      res.status(201).json(results);
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const deviceId = Number(req.params.id);
      requireDevice(db, deviceId);
      const body = updateDeviceSchema.parse(req.body);

      const sets: string[] = [];
      const params: Record<string, string | number | null> = { id: deviceId };

      for (const [key, column] of Object.entries(UPDATE_COLUMN_MAP)) {
        if (!(key in body)) continue;
        sets.push(`${column} = @${key}`);
        const value = (body as Record<string, unknown>)[key];
        params[key] = key === 'enabled' ? (value ? 1 : 0) : (value as string | number | null);
      }

      if (sets.length > 0) {
        sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
        try {
          db.prepare(`UPDATE devices SET ${sets.join(', ')} WHERE id = @id`).run(params);
        } catch (err) {
          if (isUniqueConstraintError(err)) {
            throw new BadRequestError('Another device already exists at that host:port');
          }
          throw err;
        }
      }

      res.json(requireDevice(db, deviceId));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const deviceId = Number(req.params.id);
      const info = db.prepare('DELETE FROM devices WHERE id = ?').run(deviceId);
      if (info.changes === 0) throw new NotFoundError(`No device with id ${deviceId}`);
      res.status(204).end();
    }),
  );

  router.put(
    '/:id/groups',
    asyncHandler(async (req, res) => {
      const deviceId = Number(req.params.id);
      requireDevice(db, deviceId);
      const { groupIds } = groupIdsSchema.parse(req.body);

      db.prepare('DELETE FROM device_groups WHERE device_id = ?').run(deviceId);
      const insert = db.prepare('INSERT INTO device_groups (device_id, group_id) VALUES (?, ?)');
      try {
        for (const groupId of groupIds) insert.run(deviceId, groupId);
      } catch (err) {
        if (isUniqueConstraintError(err) || (err instanceof Error && /FOREIGN KEY/.test(err.message))) {
          throw new BadRequestError('groupIds must reference existing groups, with no duplicates');
        }
        throw err;
      }

      res.json(requireDevice(db, deviceId));
    }),
  );

  router.put(
    '/:id/credentials',
    asyncHandler(async (req, res) => {
      const deviceId = Number(req.params.id);
      requireDevice(db, deviceId);
      const body = credentialsSchema.parse(req.body);
      setDeviceCredentials(db, deviceId, body);
      res.json(requireDevice(db, deviceId));
    }),
  );

  router.delete(
    '/:id/credentials',
    asyncHandler(async (req, res) => {
      const deviceId = Number(req.params.id);
      requireDevice(db, deviceId);
      setDeviceCredentials(db, deviceId, { username: null, password: null });
      res.json(requireDevice(db, deviceId));
    }),
  );

  // Analytics pane data (spec §5): temperature and lamp-hour history. Populated
  // by the poller since phase 3 but never exposed over HTTP until now.
  router.get(
    '/:id/telemetry',
    asyncHandler(async (req, res) => {
      const deviceId = Number(req.params.id);
      requireDevice(db, deviceId);
      const query = telemetryQuerySchema.parse(req.query);

      const conditions = ['device_id = @deviceId'];
      const params: Record<string, string | number> = { deviceId, limit: query.limit };
      if (query.metric) {
        conditions.push('metric = @metric');
        params.metric = query.metric;
      }
      if (query.idx !== undefined) {
        conditions.push('idx = @idx');
        params.idx = query.idx;
      }
      if (query.since) {
        conditions.push('recorded_at >= @since');
        params.since = query.since;
      }

      const rows = db
        .prepare(
          `SELECT device_id, metric, idx, value, recorded_at FROM telemetry
           WHERE ${conditions.join(' AND ')}
           ORDER BY recorded_at ASC
           LIMIT @limit`,
        )
        .all(params) as unknown as TelemetryRow[];

      res.json(rows.map(toSample));
    }),
  );

  return router;
}
