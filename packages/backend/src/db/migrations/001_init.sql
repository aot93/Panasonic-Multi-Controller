-- 001_init.sql — initial schema.
--
-- Conventions:
--   * Timestamps are ISO-8601 UTC strings ("2026-07-28T09:15:00.000Z"). SQLite
--     has no date type; text sorts correctly in this format and survives the
--     round-trip to JSON without a conversion layer.
--   * Booleans are INTEGER 0/1 with CHECK constraints.
--   * Enum-ish columns use CHECK constraints rather than lookup tables — the
--     value sets are fixed by the protocol, not by the operator.

PRAGMA foreign_keys = ON;

/* ------------------------------------------------------------------ */
/* Command profiles — a family of projectors sharing a command set.    */
/* ------------------------------------------------------------------ */
CREATE TABLE command_profiles (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL UNIQUE,
  -- Regex matched against the QID (model name) response to auto-assign a
  -- profile when a device is first polled.
  model_pattern TEXT,
  -- How many light sources to walk when querying Q$L. The older 20K lamp
  -- units have four; the laser RQ35/RZ34 units report a single light source.
  lamp_count    INTEGER NOT NULL DEFAULT 1 CHECK (lamp_count >= 0),
  description   TEXT,
  built_in      INTEGER NOT NULL DEFAULT 0 CHECK (built_in IN (0, 1))
);

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */
CREATE TABLE devices (
  id                INTEGER PRIMARY KEY,
  name              TEXT    NOT NULL,
  host              TEXT    NOT NULL,
  port              INTEGER NOT NULL DEFAULT 1024 CHECK (port BETWEEN 1 AND 65535),
  -- NULL falls back to the global default in `settings`. Fleets are rarely
  -- uniform, so per-device overrides are first-class.
  username          TEXT,
  -- Encrypted at rest (see db/crypto.ts); never leaves the server.
  password_enc      BLOB,
  model             TEXT,
  serial            TEXT,
  profile_id        INTEGER REFERENCES command_profiles(id) ON DELETE SET NULL,
  location          TEXT,
  notes             TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  -- NULL uses the global poll interval.
  poll_interval_sec INTEGER CHECK (poll_interval_sec IS NULL OR poll_interval_sec > 0),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (host, port)
);

CREATE INDEX idx_devices_enabled ON devices(enabled);

/* ------------------------------------------------------------------ */
/* Groups (many-to-many: a projector can be in "Building A" and "Foyer") */
/* ------------------------------------------------------------------ */
CREATE TABLE groups (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE device_groups (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  group_id  INTEGER NOT NULL REFERENCES groups(id)  ON DELETE CASCADE,
  PRIMARY KEY (device_id, group_id)
);

CREATE INDEX idx_device_groups_group ON device_groups(group_id);

/* ------------------------------------------------------------------ */
/* Current device state — exactly one row per device.                  */
/* Kept separate from `devices` so the poller's high-frequency writes   */
/* never contend with configuration reads.                             */
/* ------------------------------------------------------------------ */
CREATE TABLE device_state (
  device_id      INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  health         TEXT    NOT NULL DEFAULT 'unknown'
                   CHECK (health IN ('ok', 'warning', 'error', 'unreachable', 'unknown')),
  power          TEXT    NOT NULL DEFAULT 'unknown'
                   CHECK (power IN ('on', 'off', 'warming', 'cooling', 'unknown')),
  input          TEXT,
  shutter        INTEGER CHECK (shutter IS NULL OR shutter IN (0, 1)),
  temp_intake_c  REAL,
  temp_exhaust_c REAL,
  -- JSON array of hours, index 0 = lamp 1. JSON rather than a child table
  -- because it is always read and written as a whole.
  lamp_hours     TEXT    NOT NULL DEFAULT '[]',
  aspect         TEXT,
  screen_setting TEXT,
  self_diagnosis TEXT,
  latency_ms     INTEGER,
  last_seen_at   TEXT,
  last_error     TEXT,
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_device_state_health ON device_state(health);

/* ------------------------------------------------------------------ */
/* Time-series telemetry (spec §3: "time-series logging of lamp hours   */
/* /errors", spec §5 analytics pane).                                  */
/*                                                                     */
/* Narrow metric/value shape so new metrics need no migration. `idx`    */
/* disambiguates multi-lamp units.                                     */
/* ------------------------------------------------------------------ */
CREATE TABLE telemetry (
  id          INTEGER PRIMARY KEY,
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  metric      TEXT    NOT NULL
                CHECK (metric IN ('temp_intake', 'temp_exhaust', 'lamp_hours',
                                  'projector_runtime', 'latency_ms')),
  idx         INTEGER NOT NULL DEFAULT 0,
  value       REAL    NOT NULL,
  recorded_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Covers the analytics query shape: one metric, one device, over a time range.
CREATE INDEX idx_telemetry_lookup ON telemetry(device_id, metric, recorded_at);
-- Covers retention pruning, which sweeps by age across all devices.
CREATE INDEX idx_telemetry_recorded ON telemetry(recorded_at);

/* ------------------------------------------------------------------ */
/* Events / alerting (spec §2)                                         */
/* ------------------------------------------------------------------ */
CREATE TABLE events (
  id              INTEGER PRIMARY KEY,
  -- NULL for server-level events (startup, scheduler failures).
  device_id       INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  severity        TEXT    NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  code            TEXT    NOT NULL,
  message         TEXT    NOT NULL,
  detail          TEXT,
  acknowledged_at TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_events_created ON events(created_at);
CREATE INDEX idx_events_device ON events(device_id, created_at);
-- Partial index: the alert banner only ever queries unacknowledged rows.
CREATE INDEX idx_events_open ON events(created_at) WHERE acknowledged_at IS NULL;

/* ------------------------------------------------------------------ */
/* Command catalogue — data, not code, so operators can extend it       */
/* without a rebuild (spec §4: "allow the user to add commands").      */
/* ------------------------------------------------------------------ */
CREATE TABLE commands (
  id           INTEGER PRIMARY KEY,
  key          TEXT    NOT NULL UNIQUE,
  label        TEXT    NOT NULL,
  category     TEXT    NOT NULL DEFAULT 'General',
  -- NTCONTROL body without the "00" prefix, auth hash or trailing CR.
  -- "{p}" is replaced with the parameter value.
  body         TEXT    NOT NULL,
  is_query     INTEGER NOT NULL DEFAULT 0 CHECK (is_query IN (0, 1)),
  param_kind   TEXT    NOT NULL DEFAULT 'none'
                 CHECK (param_kind IN ('none', 'enum', 'integer', 'string')),
  -- JSON array of {label, value} when param_kind = 'enum'.
  param_options TEXT,
  param_min    INTEGER,
  param_max    INTEGER,
  -- NULL means the command applies to every profile.
  profile_id   INTEGER REFERENCES command_profiles(id) ON DELETE CASCADE,
  built_in     INTEGER NOT NULL DEFAULT 0 CHECK (built_in IN (0, 1)),
  favourite    INTEGER NOT NULL DEFAULT 0 CHECK (favourite IN (0, 1)),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  description  TEXT,
  CHECK (param_kind <> 'enum' OR param_options IS NOT NULL)
);

CREATE INDEX idx_commands_category ON commands(category, sort_order);

/* ------------------------------------------------------------------ */
/* Macros — custom buttons bound to a sequence of actions (spec §5).   */
/* ------------------------------------------------------------------ */
CREATE TABLE macros (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT,
  colour      TEXT,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE macro_steps (
  id             INTEGER PRIMARY KEY,
  macro_id       INTEGER NOT NULL REFERENCES macros(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  command_id     INTEGER NOT NULL REFERENCES commands(id) ON DELETE RESTRICT,
  param          TEXT,
  -- Projectors need settling time between commands; the reference scripts
  -- sleep 200ms between sends.
  delay_ms_after INTEGER NOT NULL DEFAULT 200 CHECK (delay_ms_after >= 0),
  -- NULL targets whatever selection invoked the macro.
  target_kind    TEXT CHECK (target_kind IS NULL OR target_kind IN ('device', 'group', 'all')),
  target_id      INTEGER,
  UNIQUE (macro_id, seq)
);

/* ------------------------------------------------------------------ */
/* Scheduled tasks (spec §2, phase 5)                                  */
/* ------------------------------------------------------------------ */
CREATE TABLE scheduled_tasks (
  id           INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL,
  cron         TEXT    NOT NULL,
  timezone     TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  target_kind  TEXT    NOT NULL CHECK (target_kind IN ('device', 'group', 'all')),
  target_id    INTEGER,
  action_kind  TEXT    NOT NULL CHECK (action_kind IN ('command', 'macro')),
  action_id    INTEGER NOT NULL,
  param        TEXT,
  last_run_at  TEXT,
  last_result  TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- "all" needs no target; device/group must name one.
  CHECK ((target_kind = 'all' AND target_id IS NULL) OR
         (target_kind <> 'all' AND target_id IS NOT NULL))
);

CREATE INDEX idx_scheduled_tasks_enabled ON scheduled_tasks(enabled);

/* ------------------------------------------------------------------ */
/* External TCP/UDP command triggers (spec §6, phase 4)                */
/* ------------------------------------------------------------------ */
CREATE TABLE external_triggers (
  id            INTEGER PRIMARY KEY,
  trigger_key   TEXT    NOT NULL UNIQUE,
  description   TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  target_kind   TEXT    NOT NULL CHECK (target_kind IN ('device', 'group', 'all')),
  target_id     INTEGER,
  action_kind   TEXT    NOT NULL CHECK (action_kind IN ('command', 'macro')),
  action_id     INTEGER NOT NULL,
  param         TEXT,
  last_fired_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((target_kind = 'all' AND target_id IS NULL) OR
         (target_kind <> 'all' AND target_id IS NOT NULL))
);

/* ------------------------------------------------------------------ */
/* Audit log of every dispatched command.                              */
/* ------------------------------------------------------------------ */
CREATE TABLE command_log (
  id          INTEGER PRIMARY KEY,
  device_id   INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  command_key TEXT,
  -- Exactly what went on the wire, minus the auth hash.
  sent        TEXT,
  response    TEXT,
  ok          INTEGER NOT NULL CHECK (ok IN (0, 1)),
  error       TEXT,
  latency_ms  INTEGER,
  -- Who or what triggered it: 'ui', 'schedule', 'trigger', 'poller'.
  source      TEXT    NOT NULL DEFAULT 'ui',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_command_log_created ON command_log(created_at);
CREATE INDEX idx_command_log_device ON command_log(device_id, created_at);

/* ------------------------------------------------------------------ */
/* Key/value settings                                                  */
/* ------------------------------------------------------------------ */
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO settings (key, value) VALUES
  ('poll_interval_sec',      '30'),
  ('poll_concurrency',       '8'),
  ('connect_timeout_ms',     '5000'),
  ('command_timeout_ms',     '5000'),
  ('default_username',       'admin1'),
  ('telemetry_retention_days', '365'),
  ('temp_warning_c',         '45'),
  ('temp_critical_c',        '55'),
  ('external_trigger_tcp_port', '5000'),
  ('external_trigger_udp_port', '5000'),
  ('external_trigger_enabled',  '0');
