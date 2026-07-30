import type { EventSeverity, HealthState } from '@ppc/shared';

export interface HealthTransitionEvent {
  severity: EventSeverity;
  code: string;
  message: string;
}

/**
 * Maps a health change into an alert (spec §2: "Error Alerting ... logging
 * for critical failures"), or null if the change isn't alert-worthy.
 *
 * A brand-new device (no prior `device_state` row) is treated as
 * transitioning from 'unknown' — so a device that's already broken the very
 * first time it's polled still raises an alert instead of silently starting
 * "healthy" by default.
 *
 * `cause` is a human-readable summary of whatever self-diagnosis finding(s)
 * are currently active (e.g. "U201: Intake air temperature warning"), or
 * null if none could be identified — passed through into the event message
 * so it says what's actually wrong instead of a generic "warning"/"error".
 */
export function describeHealthTransition(
  deviceName: string,
  from: HealthState,
  to: HealthState,
  cause: string | null,
): HealthTransitionEvent | null {
  if (from === to) return null;

  if (to === 'unreachable') {
    return { severity: 'error', code: 'comms.lost', message: `${deviceName} is unreachable` };
  }
  if (from === 'unreachable') {
    return { severity: 'info', code: 'comms.restored', message: `${deviceName} is reachable again` };
  }
  if (to === 'error') {
    return {
      severity: 'critical',
      code: 'selfdiag.error',
      message: cause ? `${deviceName}: ${cause}` : `${deviceName} self-diagnosis reports an error`,
    };
  }
  if (to === 'warning') {
    return {
      severity: 'warning',
      code: 'selfdiag.warning',
      message: cause ? `${deviceName}: ${cause}` : `${deviceName} self-diagnosis reports a warning`,
    };
  }
  if (to === 'ok' && (from === 'warning' || from === 'error')) {
    return { severity: 'info', code: 'selfdiag.normal', message: `${deviceName} self-diagnosis is back to normal` };
  }
  return null;
}
