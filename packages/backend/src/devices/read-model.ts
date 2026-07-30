import type { DatabaseSync } from 'node:sqlite';
import type {
  Device,
  DeviceState,
  DeviceWithState,
  HealthState,
  NameVerificationResult,
  NameVerificationStatus,
  PowerState,
} from '@ppc/shared';

interface DeviceStateRow {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string | null;
  model: string | null;
  serial: string | null;
  profile_id: number | null;
  location: string | null;
  notes: string | null;
  enabled: number;
  poll_interval_sec: number | null;
  created_at: string;
  updated_at: string;
  has_password_override: number;
  health: HealthState | null;
  power: PowerState | null;
  input: string | null;
  shutter: number | null;
  temp_intake_c: number | null;
  temp_exhaust_c: number | null;
  lamp_hours: string | null;
  aspect: string | null;
  screen_setting: string | null;
  self_diagnosis: string | null;
  latency_ms: number | null;
  last_seen_at: string | null;
  last_error: string | null;
  state_updated_at: string | null;
  nv_status: NameVerificationStatus | null;
  nv_detected_text: string | null;
  nv_confidence: number | null;
  nv_checked_at: string | null;
}

interface GroupLinkRow {
  device_id: number;
  group_id: number;
}

/**
 * The read side of device data — everything the dashboard needs to render a
 * grid card: the device row, its current state (LEFT JOINed, so a
 * never-polled device still appears with `state: null`), and its group
 * memberships. Shared between the `GET /api/devices` route and the
 * `devices:subscribe` socket handler so both serve identically-shaped data.
 *
 * Read-only — device management (create/update/delete, grouping, credential
 * editing) is phase 4's `devices/routes.ts`.
 */

const SELECT_DEVICE_STATE = `
  SELECT d.id, d.name, d.host, d.port, d.username, d.model, d.serial, d.profile_id,
         d.location, d.notes, d.enabled, d.poll_interval_sec, d.created_at, d.updated_at,
         (d.password_enc IS NOT NULL) AS has_password_override,
         ds.health, ds.power, ds.input, ds.shutter, ds.temp_intake_c, ds.temp_exhaust_c,
         ds.lamp_hours, ds.aspect, ds.screen_setting, ds.self_diagnosis, ds.latency_ms,
         ds.last_seen_at, ds.last_error, ds.updated_at AS state_updated_at,
         nv.status AS nv_status, nv.detected_text AS nv_detected_text,
         nv.confidence AS nv_confidence, nv.checked_at AS nv_checked_at
  FROM devices d
  LEFT JOIN device_state ds ON ds.device_id = d.id
  LEFT JOIN device_name_verification nv ON nv.device_id = d.id
`;

/**
 * NextSteps.md Phase 4 item 2: plain SQL `ORDER BY name` puts "Projector 10"
 * before "Projector 2" (lexicographic). `localeCompare`'s `numeric` option
 * treats embedded digit runs as numbers instead, giving 1, 2, ... 10, 11
 * without needing zero-padded names — sorted here, in the one place every
 * device listing (grid, preview, group displays) draws from, rather than
 * per-component.
 */
function compareDeviceNames(a: DeviceWithState, b: DeviceWithState): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

export function listDevicesWithState(db: DatabaseSync): DeviceWithState[] {
  const rows = db.prepare(SELECT_DEVICE_STATE).all() as unknown as DeviceStateRow[];
  const groupIdsByDevice = loadGroupIds(db);
  return rows.map((row) => toDeviceWithState(row, groupIdsByDevice.get(row.id) ?? [])).sort(compareDeviceNames);
}

export function getDeviceWithState(db: DatabaseSync, deviceId: number): DeviceWithState | null {
  const row = db.prepare(`${SELECT_DEVICE_STATE} WHERE d.id = ?`).get(deviceId) as
    | DeviceStateRow
    | undefined;
  if (!row) return null;
  const groupIds = (db.prepare('SELECT group_id FROM device_groups WHERE device_id = ?').all(deviceId) as unknown as {
    group_id: number;
  }[]).map((r) => r.group_id);
  return toDeviceWithState(row, groupIds);
}

function loadGroupIds(db: DatabaseSync): Map<number, number[]> {
  const groupLinks = db.prepare('SELECT device_id, group_id FROM device_groups').all() as unknown as GroupLinkRow[];
  const groupIdsByDevice = new Map<number, number[]>();
  for (const link of groupLinks) {
    const list = groupIdsByDevice.get(link.device_id) ?? [];
    list.push(link.group_id);
    groupIdsByDevice.set(link.device_id, list);
  }
  return groupIdsByDevice;
}

function toDeviceWithState(row: DeviceStateRow, groupIds: number[]): DeviceWithState {
  const device: Device = {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    model: row.model,
    serial: row.serial,
    profileId: row.profile_id,
    location: row.location,
    notes: row.notes,
    enabled: row.enabled === 1,
    pollIntervalSec: row.poll_interval_sec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  // A LEFT JOIN with no matching device_state row surfaces every joined
  // column as null — `health` is NOT NULL in the schema whenever a row
  // exists, so null here specifically means "never polled".
  const state: DeviceState | null =
    row.health === null
      ? null
      : {
          deviceId: row.id,
          health: row.health,
          power: row.power ?? 'unknown',
          input: row.input,
          shutter: row.shutter === null ? null : row.shutter === 1,
          tempIntakeC: row.temp_intake_c,
          tempExhaustC: row.temp_exhaust_c,
          lampHours: row.lamp_hours ? JSON.parse(row.lamp_hours) : [],
          aspect: row.aspect,
          screenSetting: row.screen_setting,
          selfDiagnosis: row.self_diagnosis,
          latencyMs: row.latency_ms,
          lastSeenAt: row.last_seen_at,
          lastError: row.last_error,
          updatedAt: row.state_updated_at ?? row.updated_at,
        };

  const nameVerification: NameVerificationResult | null =
    row.nv_status === null
      ? null
      : {
          deviceId: row.id,
          status: row.nv_status,
          detectedText: row.nv_detected_text,
          confidence: row.nv_confidence,
          checkedAt: row.nv_checked_at!,
        };

  return {
    ...device,
    state,
    groupIds,
    credentialOverride: { username: row.username !== null, password: row.has_password_override === 1 },
    nameVerification,
  };
}
