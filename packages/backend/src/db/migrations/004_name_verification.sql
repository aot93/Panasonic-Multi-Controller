-- 004_name_verification.sql — vision-based projector name verification
-- (docs/vision-name-verification-plan.md), Milestone 2: persistence.
--
-- Its own table, not bolted onto device_state, since it's populated
-- on-demand by a manual "Verify Name" click rather than by the regular poll
-- cycle. One row per device (upserted on each check), same shape as
-- device_state's "exactly one row per device" convention.

CREATE TABLE device_name_verification (
  device_id     INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('match', 'mismatch', 'error')),
  detected_text TEXT,
  confidence    REAL,
  checked_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
