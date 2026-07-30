-- 003_self_diagnosis.sql — health/alerting now driven by the projector's own
-- self-diagnosis reporting (QVX:ERRS1/ERRS2), confirmed against real
-- hardware, rather than configurable temperature thresholds. Those settings
-- are no longer read anywhere (see poller/health.ts) — removed rather than
-- left as dead rows an operator might mistake for still having an effect.

DELETE FROM settings WHERE key IN ('temp_warning_c', 'temp_critical_c');
