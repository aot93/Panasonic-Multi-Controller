import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { CommandResult, CommandTarget, DeviceEvent, PanasonicErrorCode } from '@ppc/shared';
import { getDeviceCredentials } from '../credentials/store.js';
import { BadRequestError, NotFoundError } from '../http/errors.js';
import { logDeviceError } from '../logging/error-log.js';
import { getNumberSetting } from '../poller/settings.js';
import { sendOnce } from '../protocol/client.js';
import { createLimiter } from '../util/limiter.js';

/** The minimum surface dispatch needs to broadcast — see poller.ts's Broadcaster for why this is narrow rather than the full Socket.io type. */
export interface DispatchBroadcaster {
  emit(event: 'dispatch:result', payload: { dispatchId: string; results: CommandResult[] }): void;
  emit(event: 'event:new', payload: DeviceEvent): void;
}

/** Just enough of Poller's surface for dispatch to trigger a follow-up poll — the real Poller satisfies this structurally. */
export interface PollTrigger {
  pollNow(deviceIds?: number[]): Promise<void>;
}

export interface DispatchCommandRef {
  commandId?: number;
  commandKey?: string;
}

interface CommandRow {
  id: number;
  key: string;
  body: string;
  is_query: number;
  param_kind: 'none' | 'enum' | 'integer' | 'string';
  param_options: string | null;
  param_min: number | null;
  param_max: number | null;
}

interface TargetDeviceRow {
  id: number;
  name: string;
  host: string;
  port: number;
}

export type Dispatch = (
  target: CommandTarget,
  ref: DispatchCommandRef,
  param: string | null | undefined,
  source: string,
) => Promise<{ dispatchId: string; results: CommandResult[] }>;

/**
 * Builds the dispatch function used by both the HTTP `/api/dispatch` route
 * and the external trigger listener (phase 4's two ways to fire a command).
 * Kept as one function so both paths share validation, logging, broadcast,
 * and the "poll affected devices right after a state-changing command"
 * behaviour rather than duplicating it.
 */
export function createDispatcher(db: DatabaseSync, io: DispatchBroadcaster | null, poller: PollTrigger): Dispatch {
  return async function dispatch(target, ref, param, source) {
    const command = resolveCommand(db, ref);
    const resolvedParam = validateParam(command, param);
    const devices = resolveTargetDevices(db, target);
    if (devices.length === 0) {
      throw new BadRequestError('Target resolved to zero enabled devices');
    }

    const body = formatCommandBody(command.body, resolvedParam);
    const limit = createLimiter(getNumberSetting(db, 'dispatch_concurrency', 8));
    const connectTimeoutMs = getNumberSetting(db, 'connect_timeout_ms', 5000);
    const commandTimeoutMs = getNumberSetting(db, 'command_timeout_ms', 5000);

    const results = await Promise.all(
      devices.map((device) =>
        limit(() => dispatchOne(db, device, body, command.key, source, connectTimeoutMs, commandTimeoutMs)),
      ),
    );

    logFailures(db, io, devices, command.key, results);

    const dispatchId = randomUUID();
    io?.emit('dispatch:result', { dispatchId, results });

    // A query (QPW, QTM:0, ...) doesn't change device state, so there's
    // nothing for a follow-up poll to pick up. A command that DOES change
    // state (PON, OSH:1, ...) gets its affected devices polled immediately
    // rather than waiting for the next scheduled tick — see poller.pollNow.
    if (!command.is_query) {
      const succeededIds = results.filter((r) => r.ok).map((r) => r.deviceId);
      if (succeededIds.length > 0) {
        // Fire-and-forget, but caught: a device deleted while this in-flight
        // poll is still running would otherwise surface as an unhandled
        // rejection rather than a merely-missed follow-up refresh.
        poller.pollNow(succeededIds).catch((err: unknown) => {
          console.error('[dispatch] post-command poll failed:', err);
        });
      }
    }

    return { dispatchId, results };
  };
}

/**
 * Dispatch previously wrote command_log on every attempt but never surfaced a
 * failure to the `events` table or the CSV error log — only the poller did,
 * and only on a health *transition* (to stay quiet under repeated background
 * polling failures). A dispatched command is a one-shot, user- or
 * schedule/trigger-initiated action rather than a 30-second polling loop, so
 * every failure is logged here, not just the first of a run.
 */
function logFailures(
  db: DatabaseSync,
  io: DispatchBroadcaster | null,
  devices: TargetDeviceRow[],
  commandKey: string,
  results: CommandResult[],
): void {
  const nowIso = new Date().toISOString();
  for (const result of results) {
    if (result.ok) continue;
    const device = devices.find((d) => d.id === result.deviceId);
    if (!device) continue;

    const code = result.errorCode ?? 'dispatch.failed';
    const message = result.error ?? `Command "${commandKey}" failed`;

    const info = db
      .prepare('INSERT INTO events (device_id, severity, code, message, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(device.id, 'error', code, message, result.response, nowIso);

    const event: DeviceEvent = {
      id: Number(info.lastInsertRowid),
      deviceId: device.id,
      severity: 'error',
      code,
      message,
      detail: result.response,
      acknowledgedAt: null,
      createdAt: nowIso,
    };
    io?.emit('event:new', event);

    logDeviceError({
      deviceId: device.id,
      deviceName: device.name,
      host: device.host,
      severity: 'error',
      code,
      message,
      detail: result.response,
    });
  }
}

function resolveCommand(db: DatabaseSync, ref: DispatchCommandRef): CommandRow {
  if (ref.commandId === undefined && !ref.commandKey) {
    throw new BadRequestError('Either commandId or commandKey must be provided');
  }
  const row = (
    ref.commandId !== undefined
      ? db.prepare('SELECT * FROM commands WHERE id = ?').get(ref.commandId)
      : db.prepare('SELECT * FROM commands WHERE key = ?').get(ref.commandKey!)
  ) as CommandRow | undefined;
  if (!row) throw new NotFoundError('No matching command found');
  return row;
}

/** Validates `param` against the command's paramKind and returns the exact string to substitute into the body. */
function validateParam(command: CommandRow, param: string | null | undefined): string | null {
  switch (command.param_kind) {
    case 'none':
      return null;

    case 'enum': {
      const options = (command.param_options ? JSON.parse(command.param_options) : []) as { value: string }[];
      if (typeof param !== 'string' || !options.some((o) => o.value === param)) {
        throw new BadRequestError(`param must be one of: ${options.map((o) => o.value).join(', ')}`);
      }
      return param;
    }

    case 'integer': {
      if (param === null || param === undefined || param === '') {
        throw new BadRequestError('param is required for this command');
      }
      const n = Number(param);
      if (!Number.isInteger(n)) throw new BadRequestError('param must be an integer');
      if (command.param_min !== null && n < command.param_min) {
        throw new BadRequestError(`param must be >= ${command.param_min}`);
      }
      if (command.param_max !== null && n > command.param_max) {
        throw new BadRequestError(`param must be <= ${command.param_max}`);
      }
      return String(n);
    }

    case 'string': {
      if (typeof param !== 'string' || param.length === 0) {
        throw new BadRequestError('param must be a non-empty string for this command');
      }
      return param;
    }
  }
}

function formatCommandBody(body: string, param: string | null): string {
  return param !== null ? body.replaceAll('{p}', param) : body;
}

function resolveTargetDevices(db: DatabaseSync, target: CommandTarget): TargetDeviceRow[] {
  if (target.kind === 'all') {
    return db.prepare('SELECT id, name, host, port FROM devices WHERE enabled = 1').all() as unknown as TargetDeviceRow[];
  }

  const ids = target.ids ?? [];
  if (ids.length === 0) {
    throw new BadRequestError('target.ids must be non-empty for target.kind "device" or "group"');
  }
  const placeholders = ids.map(() => '?').join(',');

  if (target.kind === 'device') {
    return db
      .prepare(`SELECT id, name, host, port FROM devices WHERE enabled = 1 AND id IN (${placeholders})`)
      .all(...ids) as unknown as TargetDeviceRow[];
  }

  return db
    .prepare(
      `SELECT DISTINCT d.id, d.name, d.host, d.port
       FROM devices d
       JOIN device_groups dg ON dg.device_id = d.id
       WHERE d.enabled = 1 AND dg.group_id IN (${placeholders})`,
    )
    .all(...ids) as unknown as TargetDeviceRow[];
}

async function dispatchOne(
  db: DatabaseSync,
  device: TargetDeviceRow,
  body: string,
  commandKey: string,
  source: string,
  connectTimeoutMs: number,
  commandTimeoutMs: number,
): Promise<CommandResult> {
  const start = Date.now();
  const credentials = getDeviceCredentials(db, device.id);

  let ok = false;
  let response: string | null = null;
  let errorCode: PanasonicErrorCode | null = null;
  let lockoutSeconds: number | null = null;
  let error: string | null = null;

  try {
    const result = await sendOnce(
      { host: device.host, port: device.port, credentials: credentials ?? undefined, connectTimeoutMs, commandTimeoutMs },
      body,
    );
    if (result.ok) {
      ok = true;
      response = result.payload;
    } else {
      errorCode = result.code;
      lockoutSeconds = result.lockoutSeconds;
      error = result.message;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const latencyMs = Date.now() - start;

  db.prepare(
    `INSERT INTO command_log (device_id, command_key, sent, response, ok, error, latency_ms, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(device.id, commandKey, body, response, ok ? 1 : 0, error, latencyMs, source);

  return { deviceId: device.id, deviceName: device.name, ok, response, errorCode, lockoutSeconds, error, latencyMs };
}
