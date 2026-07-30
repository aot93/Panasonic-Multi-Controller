import type { DatabaseSync } from 'node:sqlite';
import { getNumberSetting } from '../poller/settings.js';

/**
 * Single source of truth for the `name_verification_threshold` setting's
 * default and lookup, shared by `settings/routes.ts` (the tuning UI) and
 * `devices/routes.ts` (where the check actually runs) so the two can never
 * drift to different fallback values (docs/vision-name-verification-plan.md
 * §6/§11). Migration 005 seeds this row on every install, so the fallback
 * mainly guards a corrupted or hand-edited settings row, same as every
 * other use of getNumberSetting.
 */
export const NAME_VERIFICATION_THRESHOLD_DEFAULT = 0.8;

export function getNameVerificationThreshold(db: DatabaseSync): number {
  return getNumberSetting(db, 'name_verification_threshold', NAME_VERIFICATION_THRESHOLD_DEFAULT);
}
