import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import { z } from 'zod';
import type { DeviceEvent, EventSeverity } from '@ppc/shared';

const SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;

const eventsQuerySchema = z.object({
  deviceId: z.coerce.number().int().optional(),
  severity: z.enum(SEVERITIES).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
});

interface EventRow {
  id: number;
  device_id: number | null;
  severity: EventSeverity;
  code: string;
  message: string;
  detail: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

function toEvent(row: EventRow): DeviceEvent {
  return {
    id: row.id,
    deviceId: row.device_id,
    severity: row.severity,
    code: row.code,
    message: row.message,
    detail: row.detail,
    acknowledgedAt: row.acknowledged_at,
    createdAt: row.created_at,
  };
}

/**
 * Read-only surface over the `events` table (already written by the poller's
 * health transitions and, as of NextSteps.md phase 1, dispatch failures too)
 * for the log viewer added to the main UI. The parallel per-device CSV files
 * under `<data>/logs/` (logging/error-log.ts) exist specifically for
 * spreadsheet import — this endpoint is for looking at the same events
 * in-app without leaving the browser.
 */
export function eventsRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const query = eventsQuerySchema.parse(req.query);

    const conditions: string[] = [];
    const params: Record<string, string | number> = { limit: query.limit };
    if (query.deviceId !== undefined) {
      conditions.push('device_id = @deviceId');
      params.deviceId = query.deviceId;
    }
    if (query.severity) {
      conditions.push('severity = @severity');
      params.severity = query.severity;
    }
    if (query.since) {
      conditions.push('created_at >= @since');
      params.since = query.since;
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `SELECT id, device_id, severity, code, message, detail, acknowledged_at, created_at
         FROM events
         ${where}
         ORDER BY created_at DESC
         LIMIT @limit`,
      )
      .all(params) as unknown as EventRow[];

    res.json(rows.map(toEvent));
  });

  return router;
}
