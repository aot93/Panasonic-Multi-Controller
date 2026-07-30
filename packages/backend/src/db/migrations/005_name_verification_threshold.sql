-- 005_name_verification_threshold.sql — vision-based projector name
-- verification (docs/vision-name-verification-plan.md), Milestone 3: make
-- the similarity threshold (§6) tunable instead of the hardcoded default
-- baked into packages/shared/src/name-verification.ts, since the plan
-- always expected this would need adjusting once tried against real
-- signage.

INSERT INTO settings (key, value) VALUES ('name_verification_threshold', '0.8');
