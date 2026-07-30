-- 002_phase1.sql — NextSteps.md phase 1: AC voltage joins the telemetry
-- metric set. SQLite can't ALTER a CHECK constraint in place, so the table
-- is rebuilt: new table, copy rows, drop old, rename.

CREATE TABLE telemetry_new (
  id          INTEGER PRIMARY KEY,
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  metric      TEXT    NOT NULL
                CHECK (metric IN ('temp_intake', 'temp_exhaust', 'lamp_hours',
                                  'projector_runtime', 'latency_ms', 'ac_voltage')),
  idx         INTEGER NOT NULL DEFAULT 0,
  value       REAL    NOT NULL,
  recorded_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO telemetry_new (id, device_id, metric, idx, value, recorded_at)
  SELECT id, device_id, metric, idx, value, recorded_at FROM telemetry;

DROP TABLE telemetry;
ALTER TABLE telemetry_new RENAME TO telemetry;

CREATE INDEX idx_telemetry_lookup ON telemetry(device_id, metric, recorded_at);
CREATE INDEX idx_telemetry_recorded ON telemetry(recorded_at);
