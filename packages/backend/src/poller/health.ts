import type { HealthState } from '@ppc/shared';
import type { PollReading } from './poll-device.js';

/**
 * Derives the grid-card colour (spec §5: green/yellow/red) from one poll
 * reading. Previously driven by configurable temperature thresholds; now
 * driven entirely by the projector's own self-diagnosis reporting
 * (QVX:ERRS1/ERRS2 — see poll-device.ts and shared/src/self-diagnosis.ts),
 * since real-hardware testing confirmed those codes and made the
 * thresholds redundant guesswork by comparison. An `info`-severity finding
 * (e.g. a routine maintenance reminder) does not affect health — only
 * `warning`/`error` do.
 */
export function computeHealth(reading: PollReading): HealthState {
  if (!reading.ok) return 'unreachable';

  const severities = reading.selfDiagnosis.map((f) => f.severity);
  if (severities.includes('error')) return 'error';
  if (severities.includes('warning')) return 'warning';
  return 'ok';
}
