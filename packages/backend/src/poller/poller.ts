import type { DatabaseSync } from 'node:sqlite';
import type { DeviceEvent, DeviceState, HealthState } from '@ppc/shared';
import { getDeviceCredentials } from '../credentials/store.js';
import { logDeviceError } from '../logging/error-log.js';
import { createLimiter } from '../util/limiter.js';
import { computeHealth } from './health.js';
import { pollDevice, type PollReading, type SelfDiagnosisFinding } from './poll-device.js';
import { getNumberSetting } from './settings.js';
import { describeHealthTransition } from './transitions.js';

/**
 * Joins active findings into one human-readable string for
 * device_state/DeviceState/event messages, e.g. "U201: Intake air
 * temperature warning; H001: Battery replacement for the internal clock".
 * Null when nothing displayable is active.
 *
 * ERRS1 findings are deliberately excluded from this text — per the user's
 * explicit call, after seeing it in practice: since the position-to-code
 * mapping is unknown, "Unidentified self-diagnosis condition (ERRS1
 * position N)" is just noise, not something an operator can act on. ERRS1
 * still fully participates in health/severity (computeHealth reads
 * `reading.selfDiagnosis` directly, not this summary) and still raises an
 * event — it just falls back to `describeHealthTransition`'s generic
 * message ("X self-diagnosis reports a warning") instead of a confusing
 * position number. ERRS2 findings always have a `code` (a real one, or the
 * literal unrecognized string) and are unaffected — that's the field users
 * said reads well.
 */
function summarizeSelfDiagnosis(findings: SelfDiagnosisFinding[]): string | null {
  const displayable = findings.filter((f) => f.source !== 'ERRS1');
  if (displayable.length === 0) return null;
  return displayable.map((f) => (f.code ? `${f.code}: ${f.description}` : f.description)).join('; ');
}

/** "Log the values from sensors related to the error" — unions whichever sensors the currently-active findings say are relevant and formats their current readings, so a temperature-related fault's log entry carries the actual intake/exhaust numbers and a voltage-related one carries the actual voltage. Null when no active finding names a tracked sensor. */
function buildSensorDetail(reading: PollReading): string | null {
  const sensors = new Set(reading.selfDiagnosis.flatMap((f) => f.relatedSensors));
  const parts: string[] = [];

  if (sensors.has('temperature')) {
    if (reading.tempIntakeC !== null) parts.push(`Intake ${reading.tempIntakeC}°C`);
    if (reading.tempExhaustC !== null) parts.push(`Exhaust ${reading.tempExhaustC}°C`);
  }
  if (sensors.has('voltage') && reading.acVoltageV !== null) {
    parts.push(`AC Voltage ${reading.acVoltageV}V`);
  }

  return parts.length > 0 ? parts.join(', ') : null;
}

/** The minimum surface the poller needs to broadcast — kept narrow so tests can pass a plain object instead of a real Socket.io server. */
export interface Broadcaster {
  emit(event: 'device:state', payload: DeviceState): void;
  emit(event: 'event:new', payload: DeviceEvent): void;
}

interface DeviceRow {
  id: number;
  name: string;
  host: string;
  port: number;
  poll_interval_sec: number | null;
  lamp_count: number;
}

interface PreviousStateRow {
  health: HealthState;
  last_seen_at: string | null;
}

const DEFAULT_TICK_MS = 5000;

/**
 * Background polling of registered devices, broadcasting status changes over
 * Socket.io — spec's phase 3 brief.
 *
 * Architecture: one repeating "tick" scans every enabled device and polls
 * whichever are due (device's own `poll_interval_sec` override, or the
 * global default), rather than one timer per device — simpler to reason
 * about and to bound concurrency for. `pollNow()` bypasses the due-check for
 * an explicit refresh request (the 'devices:refresh' socket event).
 */
export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lastPolledAt = new Map<number, number>();
  private readonly inFlight = new Set<number>();
  /**
   * NextSteps.md phase 3 item 13: pauses the automatic background cycle
   * only — `pollNow()` (manual refresh, and dispatch's post-command
   * follow-up poll) and `dispatch()` itself are both untouched, since
   * "sending of commands are still allowed" while paused was explicit.
   * In-memory only, not persisted — resets to running on restart, same as
   * `lastPolledAt`/`inFlight`.
   */
  private paused = false;

  constructor(
    private readonly db: DatabaseSync,
    private readonly io: Broadcaster | null,
    private readonly tickMs = DEFAULT_TICK_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Polls specific devices (or all enabled devices) right now, ignoring the due-check AND the pause state — an explicit request always runs. */
  async pollNow(deviceIds?: number[]): Promise<void> {
    const devices = this.loadDevices(deviceIds);
    const limit = createLimiter(getNumberSetting(this.db, 'poll_concurrency', 8));
    await Promise.all(devices.map((device) => limit(() => this.pollOne(device))));
  }

  private async tick(): Promise<void> {
    if (this.paused) return;

    const globalIntervalSec = getNumberSetting(this.db, 'poll_interval_sec', 30);
    const now = Date.now();

    const due = this.loadDevices().filter((device) => {
      if (this.inFlight.has(device.id)) return false;
      const intervalSec = device.poll_interval_sec ?? globalIntervalSec;
      const last = this.lastPolledAt.get(device.id) ?? 0;
      return now - last >= intervalSec * 1000;
    });
    if (due.length === 0) return;

    const limit = createLimiter(getNumberSetting(this.db, 'poll_concurrency', 8));
    await Promise.all(due.map((device) => limit(() => this.pollOne(device))));
  }

  private loadDevices(deviceIds?: number[]): DeviceRow[] {
    if (deviceIds && deviceIds.length === 0) return [];

    const filter = deviceIds ? `AND d.id IN (${deviceIds.map(() => '?').join(',')})` : '';
    const stmt = this.db.prepare(`
      SELECT d.id, d.name, d.host, d.port, d.poll_interval_sec,
             COALESCE(cp.lamp_count, 1) AS lamp_count
      FROM devices d
      LEFT JOIN command_profiles cp ON cp.id = d.profile_id
      WHERE d.enabled = 1
      ${filter}
    `);
    return (deviceIds ? stmt.all(...deviceIds) : stmt.all()) as unknown as DeviceRow[];
  }

  private async pollOne(device: DeviceRow): Promise<void> {
    this.inFlight.add(device.id);
    try {
      const credentials = getDeviceCredentials(this.db, device.id);
      const reading = await pollDevice({
        host: device.host,
        port: device.port,
        credentials,
        lampCount: device.lamp_count,
        connectTimeoutMs: getNumberSetting(this.db, 'connect_timeout_ms', 5000),
        commandTimeoutMs: getNumberSetting(this.db, 'command_timeout_ms', 5000),
      });
      this.lastPolledAt.set(device.id, Date.now());
      this.applyReading(device, reading);
    } finally {
      this.inFlight.delete(device.id);
    }
  }

  private applyReading(device: DeviceRow, reading: PollReading): void {
    const health = computeHealth(reading);
    const selfDiagnosisSummary = summarizeSelfDiagnosis(reading.selfDiagnosis);

    const previous = this.db.prepare('SELECT health, last_seen_at FROM device_state WHERE device_id = ?').get(
      device.id,
    ) as PreviousStateRow | undefined;

    const nowIso = new Date().toISOString();
    const lastSeenAt = reading.ok ? nowIso : (previous?.last_seen_at ?? null);

    this.db
      .prepare(
        `
      INSERT INTO device_state
        (device_id, health, power, input, shutter, temp_intake_c, temp_exhaust_c, lamp_hours,
         aspect, screen_setting, self_diagnosis, latency_ms, last_seen_at, last_error, updated_at)
      VALUES
        (@deviceId, @health, @power, @input, @shutter, @tempIntakeC, @tempExhaustC, @lampHours,
         @aspect, @screenSetting, @selfDiagnosis, @latencyMs, @lastSeenAt, @lastError, @updatedAt)
      ON CONFLICT (device_id) DO UPDATE SET
        health = @health, power = @power, input = @input, shutter = @shutter,
        temp_intake_c = @tempIntakeC, temp_exhaust_c = @tempExhaustC,
        lamp_hours = @lampHours, aspect = @aspect, screen_setting = @screenSetting,
        self_diagnosis = @selfDiagnosis,
        latency_ms = @latencyMs, last_seen_at = @lastSeenAt, last_error = @lastError, updated_at = @updatedAt
    `,
      )
      .run({
        deviceId: device.id,
        health,
        power: reading.power,
        input: reading.input,
        shutter: reading.shutter === null ? null : reading.shutter ? 1 : 0,
        tempIntakeC: reading.tempIntakeC,
        tempExhaustC: reading.tempExhaustC,
        lampHours: JSON.stringify(reading.lampHours),
        aspect: reading.aspect,
        screenSetting: reading.screenSetting,
        selfDiagnosis: selfDiagnosisSummary,
        latencyMs: reading.latencyMs,
        lastSeenAt,
        lastError: reading.error,
        updatedAt: nowIso,
      });

    this.recordTelemetry(device.id, reading, nowIso);

    const state: DeviceState = {
      deviceId: device.id,
      health,
      power: reading.power,
      input: reading.input,
      shutter: reading.shutter,
      tempIntakeC: reading.tempIntakeC,
      tempExhaustC: reading.tempExhaustC,
      lampHours: reading.lampHours,
      aspect: reading.aspect,
      screenSetting: reading.screenSetting,
      selfDiagnosis: selfDiagnosisSummary,
      latencyMs: reading.latencyMs,
      lastSeenAt,
      lastError: reading.error,
      updatedAt: nowIso,
    };
    this.io?.emit('device:state', state);

    const transition = describeHealthTransition(device.name, previous?.health ?? 'unknown', health, selfDiagnosisSummary);
    if (transition) {
      // "Log the values from sensors related to the error" — union whichever
      // sensors the currently-active findings say are relevant, and attach
      // their current readings so e.g. a temperature fault's log entry shows
      // the actual intake/exhaust numbers, not just the code.
      const detail = buildSensorDetail(reading);

      const info = this.db
        .prepare('INSERT INTO events (device_id, severity, code, message, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(device.id, transition.severity, transition.code, transition.message, detail, nowIso);

      const event: DeviceEvent = {
        id: Number(info.lastInsertRowid),
        deviceId: device.id,
        severity: transition.severity,
        code: transition.code,
        message: transition.message,
        detail,
        acknowledgedAt: null,
        createdAt: nowIso,
      };
      this.io?.emit('event:new', event);

      logDeviceError({
        deviceId: device.id,
        deviceName: device.name,
        host: device.host,
        severity: transition.severity,
        code: transition.code,
        message: transition.message,
        detail: detail ?? reading.error,
      });
    }
  }

  private recordTelemetry(deviceId: number, reading: PollReading, recordedAt: string): void {
    const insert = this.db.prepare(
      'INSERT INTO telemetry (device_id, metric, idx, value, recorded_at) VALUES (?, ?, ?, ?, ?)',
    );

    if (reading.tempIntakeC !== null) insert.run(deviceId, 'temp_intake', 0, reading.tempIntakeC, recordedAt);
    if (reading.tempExhaustC !== null) insert.run(deviceId, 'temp_exhaust', 0, reading.tempExhaustC, recordedAt);
    if (reading.acVoltageV !== null && Number.isFinite(reading.acVoltageV)) {
      insert.run(deviceId, 'ac_voltage', 0, reading.acVoltageV, recordedAt);
    }
    reading.lampHours.forEach((hours, idx) => insert.run(deviceId, 'lamp_hours', idx, hours, recordedAt));
    insert.run(deviceId, 'latency_ms', 0, reading.latencyMs, recordedAt);
  }
}
