import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import { z } from 'zod';
import { matchDeviceName, type BulkCreateDeviceResult, type TelemetryMetric, type TelemetrySample } from '@ppc/shared';
import { setDeviceCredentials } from '../credentials/store.js';
import { asyncHandler } from '../http/async-handler.js';
import { BadRequestError, NotFoundError, isUniqueConstraintError } from '../http/errors.js';
import { parseIpRange } from './ip-range.js';
import type { Poller } from '../poller/poller.js';
import { getNameVerificationThreshold } from '../settings/name-verification-threshold.js';
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

const verifyNameSchema = z.object({
  detectedText: z.string().nullable(),
  confidence: z.number().min(0).max(100).nullable().optional(),
});

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

/**
 * Names have no DB-level UNIQUE constraint — unlike host:port, adding one
 * retroactively risks a migration that fails outright on any install that
 * already has duplicate names (e.g. from testing before this check
 * existed), since SQLite can't create a unique index over pre-existing
 * duplicate values. Checked here instead, at the same point every creation
 * path already goes through.
 */
function assertNameAvailable(db: DatabaseSync, name: string, excludeDeviceId?: number): void {
  const row =
    excludeDeviceId === undefined
      ? db.prepare('SELECT 1 FROM devices WHERE name = ?').get(name)
      : db.prepare('SELECT 1 FROM devices WHERE name = ? AND id != ?').get(name, excludeDeviceId);
  if (row) throw new BadRequestError(`A device named "${name}" already exists`);
}

/** Shared by the single-device and bulk-by-IP-range create routes — the only difference between them is how each handles a thrown BadRequestError (fail the whole request vs. record it per-IP and continue). */
function insertDevice(db: DatabaseSync, input: InsertDeviceInput): number {
  assertNameAvailable(db, input.name);
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

  /**
   * Add multiple devices at once from an IP range, e.g.
   * 192.168.1.10-192.168.1.20. With a name prefix, each device is numbered
   * by its position in the range ("Projector 1", "Projector 2", ...:
   * NextSteps.md Phase 4 item 1) rather than named after its IP — the
   * numbering is positional, not success-based, so a mid-range failure
   * (e.g. a duplicate host:port) doesn't shift the numbers of the IPs
   * after it.
   */
  router.post(
    '/bulk',
    asyncHandler(async (req, res) => {
      const body = bulkCreateSchema.parse(req.body);
      const ips = parseIpRange(body.startIp, body.endIp);
      const port = body.port ?? 1024;
      const prefix = body.namePrefix?.trim();

      const results: BulkCreateDeviceResult[] = [];
      const createdIds: number[] = [];

      for (const [index, ip] of ips.entries()) {
        try {
          const deviceId = insertDevice(db, {
            name: prefix ? `${prefix} ${index + 1}` : ip,
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
      if (body.name !== undefined) assertNameAvailable(db, body.name, deviceId);

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

  // Vision-based name verification (docs/vision-name-verification-plan.md),
  // Milestone 2. The browser already ran OCR on its own live preview frame
  // (Milestone 1) — this just receives that result, owns the actual
  // match/mismatch decision (one definition of "counts as a match",
  // regardless of which tab/device triggered the check), and persists it.
  // Per the plan's answered open question #2: a mismatch is informational
  // only — it does not affect device health, and (per the same answer)
  // nothing is written to `events`/the CSV log here.
  router.post(
    '/:id/verify-name',
    asyncHandler(async (req, res) => {
      const deviceId = Number(req.params.id);
      const device = requireDevice(db, deviceId);
      const body = verifyNameSchema.parse(req.body);
      const threshold = getNameVerificationThreshold(db);
      const status = matchDeviceName(device.name, body.detectedText, { similarityThreshold: threshold });

      db.prepare(
        `INSERT INTO device_name_verification (device_id, status, detected_text, confidence, checked_at)
         VALUES (@deviceId, @status, @detectedText, @confidence, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(device_id) DO UPDATE SET
           status = excluded.status,
           detected_text = excluded.detected_text,
           confidence = excluded.confidence,
           checked_at = excluded.checked_at`,
      ).run({ deviceId, status, detectedText: body.detectedText, confidence: body.confidence ?? null });

      res.json(requireDevice(db, deviceId).nameVerification);
    }),
  );

  router.get(
    '/:id/verify-name',
    asyncHandler(async (req, res) => {
      const deviceId = Number(req.params.id);
      const device = requireDevice(db, deviceId);
      res.json(device.nameVerification);
    }),
  );

  return router;
}
