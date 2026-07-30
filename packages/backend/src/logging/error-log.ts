import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from '../config.js';

/**
 * Re-reads PPC_DATA_DIR at call time rather than importing config.ts's frozen
 * DATA_DIR directly — config.ts resolves that constant once, the moment
 * anything first imports it, which (per ES module evaluation order) happens
 * before a test file's own top-level statements run. Tests that want an
 * isolated scratch directory (see error-log.test.ts, poller.test.ts,
 * dispatch.test.ts) set `process.env.PPC_DATA_DIR` and rely on it being read
 * fresh here — same idea as db/crypto.ts's lazy `getKey()`.
 */
function logsDir(): string {
  return process.env.PPC_DATA_DIR ? resolve(process.env.PPC_DATA_DIR, 'logs') : resolve(DATA_DIR, 'logs');
}

/**
 * Per-device CSV error log (NextSteps.md phase 1 item 1): one file per
 * device under `<data>/logs/`, appended on every health-transition or failed
 * dispatch. Deliberately a plain file on disk, separate from the `events`
 * SQLite table the UI's log viewer reads — the ask was specifically for
 * something that "drops straight into a spreadsheet", which a live database
 * file doesn't give you.
 *
 * Timestamps use the *local* Date accessors (getFullYear/getHours/...), never
 * toISOString() — the projector's own clock is frequently wrong, and the
 * whole point here is a timestamp anchored to this PC, not the device.
 */

export interface DeviceErrorLogEntry {
  deviceId: number;
  deviceName: string;
  host: string;
  severity: string;
  code: string;
  message: string;
  detail?: string | null;
}

const HEADER = 'timestamp,device_id,device_name,host,severity,code,message,detail\n';

function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function localTimestamp(d = new Date()): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'device';
}

function logFilePath(entry: DeviceErrorLogEntry): string {
  return resolve(logsDir(), `device-${entry.deviceId}-${sanitizeForFilename(entry.host)}.csv`);
}

export function logDeviceError(entry: DeviceErrorLogEntry): void {
  mkdirSync(logsDir(), { recursive: true });
  const path = logFilePath(entry);

  const row =
    [
      localTimestamp(),
      entry.deviceId,
      entry.deviceName,
      entry.host,
      entry.severity,
      entry.code,
      entry.message,
      entry.detail ?? '',
    ]
      .map(csvField)
      .join(',') + '\n';

  if (!existsSync(path)) appendFileSync(path, HEADER, 'utf8');
  appendFileSync(path, row, 'utf8');
}
