-- 006_macro_step_calls.sql — a macro step can now invoke another macro
-- instead of a command, so a "Full Startup" macro can call "Power On" then
-- "Set Inputs" rather than duplicating their steps. SQLite can't add a CHECK
-- constraint or relax a NOT NULL in place, so the table is rebuilt (same
-- pattern as 002_phase1.sql).
--
-- Loop prevention is layered:
--  1. The CHECK below blocks a step from naming its own macro directly.
--  2. The API (macros/routes.ts) walks the call graph before saving a step
--     that calls a macro, and rejects any edit that would close a cycle
--     through some longer chain (A -> B -> A).
--  3. run-macro.ts tracks the chain of macro ids currently executing and
--     refuses to re-enter one, as a last-resort guard against a loop that
--     somehow made it past #1/#2 (e.g. rows written directly to the db).
-- child_macro_id uses ON DELETE RESTRICT, like command_id already did for
-- commands, so deleting a macro that's still called by another macro's step
-- fails loudly instead of leaving a dangling reference.

CREATE TABLE macro_steps_new (
  id             INTEGER PRIMARY KEY,
  macro_id       INTEGER NOT NULL REFERENCES macros(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  step_kind      TEXT    NOT NULL DEFAULT 'command' CHECK (step_kind IN ('command', 'macro')),
  command_id     INTEGER REFERENCES commands(id) ON DELETE RESTRICT,
  child_macro_id INTEGER REFERENCES macros(id) ON DELETE RESTRICT,
  param          TEXT,
  delay_ms_after INTEGER NOT NULL DEFAULT 200 CHECK (delay_ms_after >= 0),
  target_kind    TEXT CHECK (target_kind IS NULL OR target_kind IN ('device', 'group', 'all')),
  target_id      INTEGER,
  UNIQUE (macro_id, seq),
  CHECK (
    (step_kind = 'command' AND command_id IS NOT NULL AND child_macro_id IS NULL) OR
    (step_kind = 'macro' AND child_macro_id IS NOT NULL AND command_id IS NULL)
  ),
  CHECK (child_macro_id IS NULL OR child_macro_id <> macro_id)
);

INSERT INTO macro_steps_new (id, macro_id, seq, step_kind, command_id, child_macro_id, param, delay_ms_after, target_kind, target_id)
  SELECT id, macro_id, seq, 'command', command_id, NULL, param, delay_ms_after, target_kind, target_id FROM macro_steps;

DROP TABLE macro_steps;
ALTER TABLE macro_steps_new RENAME TO macro_steps;
