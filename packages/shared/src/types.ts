/**
 * Domain types shared between the backend and the browser client.
 *
 * These mirror the SQLite schema in
 * packages/backend/src/db/migrations/001_init.sql. Anything persisted is
 * expressed here so the API contract and the DB stay in step.
 */

import type { NameVerificationResult } from './name-verification.js';

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

/** Aggregate health used to colour the grid cards (spec §5). */
export type HealthState = 'ok' | 'warning' | 'error' | 'unreachable' | 'unknown';

/** Power state as reported by QPW / Q$S. */
export type PowerState = 'on' | 'off' | 'warming' | 'cooling' | 'unknown';

export interface Device {
  id: number;
  name: string;
  host: string;
  /** NTCONTROL port. Panasonic's default is 1024. */
  port: number;
  /**
   * Per-device credentials. Left null to fall back to the global default in
   * `settings`. Real fleets are not uniform — the reference scripts in this
   * repo alone use two different admin accounts.
   */
  username: string | null;
  /** Stored encrypted at rest; never serialised to the browser. */
  password?: never;
  /** Model string as reported by QID, populated on first successful poll. */
  model: string | null;
  /** Serial number as reported by QSN. */
  serial: string | null;
  /**
   * Which command profile applies to this device. Determines which commands
   * the UI offers and which queries the poller issues.
   */
  profileId: number | null;
  location: string | null;
  notes: string | null;
  enabled: boolean;
  /** Poll interval override in seconds; null uses the global default. */
  pollIntervalSec: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Latest known state of a device — one row per device, updated by the poller. */
export interface DeviceState {
  deviceId: number;
  health: HealthState;
  power: PowerState;
  /** Raw input token, e.g. "HD1", "DL1:PC1". */
  input: string | null;
  shutter: boolean | null;
  /** Intake air temperature in °C (QTM:0). */
  tempIntakeC: number | null;
  /** Exhaust air temperature in °C (QTM:1). */
  tempExhaustC: number | null;
  /** Runtime hours per light source / lamp, index 0 = lamp 1. */
  lampHours: number[];
  /** Aspect ratio token (QSE). */
  aspect: string | null;
  /** Screen setting token (QSF). */
  screenSetting: string | null;
  /** Self-diagnosis payload from QVX:ERRS1 / ERRS2, if any. */
  selfDiagnosis: string | null;
  /** Round-trip time of the last successful poll, in ms. */
  latencyMs: number | null;
  lastSeenAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

/** A device joined with its current state — the grid card payload. */
export interface DeviceWithState extends Device {
  state: DeviceState | null;
  groupIds: number[];
  /**
   * Whether this device overrides the global default username/password
   * (independently per field — see packages/backend/src/credentials/store.ts).
   * Never the credentials themselves, just whether an override exists, so
   * the UI can show "using global" vs "custom" without ever seeing a secret.
   */
  credentialOverride: { username: boolean; password: boolean };
  /** Last vision-based name-verification result (docs/vision-name-verification-plan.md), null if never checked. */
  nameVerification: NameVerificationResult | null;
}

/** Response shape for the global default credentials — never the password itself. */
export interface GlobalCredentialsStatus {
  configured: boolean;
  username: string | null;
}

/** One request body entry for POST /api/devices/bulk. */
export interface BulkCreateDevicesRequest {
  namePrefix?: string | null;
  startIp: string;
  endIp: string;
  port?: number;
  pollIntervalSec?: number | null;
}

/** Per-IP outcome from POST /api/devices/bulk — a range partially succeeding is normal, not exceptional. */
export interface BulkCreateDeviceResult {
  ip: string;
  ok: boolean;
  device?: DeviceWithState;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Groups                                                              */
/* ------------------------------------------------------------------ */

export interface Group {
  id: number;
  name: string;
  description: string | null;
  /** Display ordering in the sidebar. */
  sortOrder: number;
  createdAt: string;
}

export interface GroupWithCount extends Group {
  deviceCount: number;
}

/* ------------------------------------------------------------------ */
/* Command catalogue                                                   */
/* ------------------------------------------------------------------ */

/**
 * How a command's parameter is supplied. Drives the UI control rendered
 * next to the button and the validation applied before dispatch.
 */
export type CommandParamKind = 'none' | 'enum' | 'integer' | 'string';

export interface CommandParamOption {
  label: string;
  value: string;
}

/**
 * A single entry in the command catalogue. Catalogue rows are data, not code,
 * so operators can extend the set without a rebuild (spec §4).
 *
 * `body` is the NTCONTROL command *without* the "00" ID prefix, the auth hash
 * or the trailing CR — the transport adds those. A `{p}` placeholder is
 * substituted with the parameter value.
 *
 * Examples:
 *   power on      -> body "PON",      param none
 *   set aspect    -> body "VSE:{p}",  param enum
 *   query aspect  -> body "QSE",      param none, isQuery true
 */
export interface CommandDef {
  id: number;
  /** Stable machine key, e.g. "power.on", "aspect.set". */
  key: string;
  label: string;
  /** Grouping for the UI, e.g. "Power", "Input", "Test Pattern". */
  category: string;
  body: string;
  isQuery: boolean;
  paramKind: CommandParamKind;
  paramOptions: CommandParamOption[] | null;
  paramMin: number | null;
  paramMax: number | null;
  /** Null means "applies to every profile". */
  profileId: number | null;
  /** Built-in rows ship with the app and cannot be deleted, only hidden. */
  builtIn: boolean;
  /** Show this command as a primary button on device cards. */
  favourite: boolean;
  sortOrder: number;
  description: string | null;
}

/**
 * A named family of projectors sharing a command set (e.g. "PT-RQ35K series"
 * vs the older lamp-based 20K units). `modelPattern` is a regex matched
 * against the QID response to auto-assign on discovery.
 */
export interface CommandProfile {
  id: number;
  name: string;
  modelPattern: string | null;
  /** Number of lamps / light sources to query via Q$L. */
  lampCount: number;
  description: string | null;
  builtIn: boolean;
}

/* ------------------------------------------------------------------ */
/* Macros (custom buttons, spec §5)                                    */
/* ------------------------------------------------------------------ */

export interface Macro {
  id: number;
  name: string;
  description: string | null;
  /** Tailwind-ish colour token chosen in the UI. */
  colour: string | null;
  icon: string | null;
  sortOrder: number;
  steps: MacroStep[];
}

export interface MacroStep {
  id: number;
  macroId: number;
  seq: number;
  commandId: number;
  /** Literal parameter value substituted into the command body. */
  param: string | null;
  /** Pause after this step, in milliseconds. */
  delayMsAfter: number;
  /**
   * Optional target override. When null the macro runs against whatever
   * selection or schedule invoked it.
   */
  targetKind: TargetKind | null;
  targetId: number | null;
}

/** Response shape of POST /api/macros/:id/run — one outcome per step, in order. */
export interface MacroRunResult {
  macroId: number;
  /** True only if every step ran and every device in every step succeeded. */
  ok: boolean;
  steps: MacroStepOutcome[];
}

export interface MacroStepOutcome {
  seq: number;
  commandId: number;
  ok: boolean;
  /** Set when the step could not even be dispatched (bad target, etc) — distinct from a per-device failure inside `results`. */
  error: string | null;
  results: CommandResult[] | null;
}

/* ------------------------------------------------------------------ */
/* Targeting, dispatch and results                                     */
/* ------------------------------------------------------------------ */

export type TargetKind = 'device' | 'group' | 'all';

export interface CommandTarget {
  kind: TargetKind;
  /** Device or group ids. Ignored when kind is "all". */
  ids?: number[];
}

export interface DispatchRequest {
  target: CommandTarget;
  commandId?: number;
  /** Alternatively dispatch by stable key. */
  commandKey?: string;
  param?: string | null;
}

export interface CommandResult {
  deviceId: number;
  deviceName: string;
  ok: boolean;
  /** Raw response payload with the fixed "00" header stripped, e.g. "000" or "30/0080". */
  response: string | null;
  /** Panasonic error token when the projector rejected the command. */
  errorCode: PanasonicErrorCode | null;
  /**
   * Seconds remaining before the projector accepts another auth attempt.
   * Only set when errorCode is "ERRA" following 3 consecutive bad passwords
   * (wire form "ERRA ***").
   */
  lockoutSeconds: number | null;
  error: string | null;
  latencyMs: number;
}

/** Error tokens returned by the projector in place of a normal response. */
export type PanasonicErrorCode = 'ERR1' | 'ERR2' | 'ERR3' | 'ERR4' | 'ERR5' | 'ERRA';

/* ------------------------------------------------------------------ */
/* Telemetry and events                                                */
/* ------------------------------------------------------------------ */

/** Narrow time-series row — one metric sample for one device. */
export interface TelemetrySample {
  deviceId: number;
  metric: TelemetryMetric;
  /** Sub-index for multi-lamp units: lamp 1 -> 0, lamp 2 -> 1, ... */
  idx: number;
  value: number;
  recordedAt: string;
}

export type TelemetryMetric =
  | 'temp_intake'
  | 'temp_exhaust'
  | 'lamp_hours'
  | 'projector_runtime'
  | 'latency_ms'
  | 'ac_voltage';

export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface DeviceEvent {
  id: number;
  deviceId: number | null;
  severity: EventSeverity;
  /** Machine-readable code, e.g. "comms.lost", "temp.high", "selfdiag". */
  code: string;
  message: string;
  /** Extra JSON context. */
  detail: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Scheduling (spec §2, phase 5)                                       */
/* ------------------------------------------------------------------ */

export interface ScheduledTask {
  id: number;
  name: string;
  /** Five- or six-field cron expression understood by node-cron. */
  cron: string;
  timezone: string | null;
  enabled: boolean;
  targetKind: TargetKind;
  targetId: number | null;
  actionKind: 'command' | 'macro';
  /** Command id or macro id depending on actionKind. */
  actionId: number;
  param: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* External triggers (spec §6, phase 4)                                */
/* ------------------------------------------------------------------ */

export interface ExternalTrigger {
  id: number;
  /** Token an external system sends to fire this trigger. */
  triggerKey: string;
  description: string | null;
  enabled: boolean;
  targetKind: TargetKind;
  targetId: number | null;
  actionKind: 'command' | 'macro';
  actionId: number;
  param: string | null;
  lastFiredAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Socket.io event contract (phase 3)                                  */
/* ------------------------------------------------------------------ */

export interface ServerToClientEvents {
  'device:state': (payload: DeviceState) => void;
  'device:upserted': (payload: DeviceWithState) => void;
  'device:removed': (payload: { deviceId: number }) => void;
  'event:new': (payload: DeviceEvent) => void;
  'dispatch:result': (payload: { dispatchId: string; results: CommandResult[] }) => void;
}

export interface ClientToServerEvents {
  'devices:subscribe': () => void;
  'devices:refresh': (payload: { deviceIds?: number[] }) => void;
}

/* ------------------------------------------------------------------ */
/* Project files (save/load a whole configuration, phase 1 item 3)     */
/* ------------------------------------------------------------------ */

/**
 * Every reference in a project file is by stable natural key (device
 * host:port, group/macro name, command key) rather than numeric database id,
 * since ids are meaningless once imported into a different (or the same,
 * re-seeded) database. Credentials are never included — a project file may
 * be shared or emailed, and re-entering the admin password on import is a
 * small price for never having a plaintext (or even encrypted-with-this-
 * machine's-key) secret leave the server.
 */
export type ProjectTargetRef = { kind: 'all' } | { kind: 'group'; groupName: string } | { kind: 'device'; host: string; port: number };

export type ProjectActionRef = { kind: 'command'; commandKey: string } | { kind: 'macro'; macroName: string };

export interface ProjectDevice {
  name: string;
  host: string;
  port: number;
  location: string | null;
  notes: string | null;
  pollIntervalSec: number | null;
  groupNames: string[];
}

export interface ProjectGroup {
  name: string;
  description: string | null;
  sortOrder: number;
}

/** Custom (non-built-in) command catalogue rows only — built-ins ship with every install and are matched by key. */
export interface ProjectCommand {
  key: string;
  label: string;
  category: string;
  body: string;
  isQuery: boolean;
  paramKind: CommandParamKind;
  paramOptions: CommandParamOption[] | null;
  paramMin: number | null;
  paramMax: number | null;
  favourite: boolean;
  sortOrder: number;
  description: string | null;
}

export interface ProjectMacroStep {
  commandKey: string;
  param: string | null;
  delayMsAfter: number;
  target: ProjectTargetRef | null;
}

export interface ProjectMacro {
  name: string;
  description: string | null;
  colour: string | null;
  icon: string | null;
  sortOrder: number;
  steps: ProjectMacroStep[];
}

export interface ProjectSchedule {
  name: string;
  cron: string;
  timezone: string | null;
  enabled: boolean;
  target: ProjectTargetRef;
  action: ProjectActionRef;
  param: string | null;
}

export interface ProjectTrigger {
  triggerKey: string;
  description: string | null;
  enabled: boolean;
  target: ProjectTargetRef;
  action: ProjectActionRef;
  param: string | null;
}

export interface ProjectFile {
  formatVersion: 1;
  exportedAt: string;
  appName: 'panasonic-multi-controller';
  devices: ProjectDevice[];
  groups: ProjectGroup[];
  commands: ProjectCommand[];
  macros: ProjectMacro[];
  schedules: ProjectSchedule[];
  triggers: ProjectTrigger[];
}

/** Summary returned by POST /api/project/import — created/skipped counts plus non-fatal warnings (e.g. a macro step referencing a command that doesn't exist on this install). */
export interface ProjectImportResult {
  /** Ids of newly-created devices, so the caller can scope an immediate follow-up poll to just them. */
  createdDeviceIds: number[];
  devices: { created: number; skipped: number };
  groups: { created: number; skipped: number };
  commands: { created: number; skipped: number };
  macros: { created: number; skipped: number };
  schedules: { created: number; skipped: number };
  triggers: { created: number; skipped: number };
  warnings: string[];
}
