import type { HealthState } from '@ppc/shared';

const HEALTH_LABEL: Record<HealthState, string> = {
  ok: 'OK',
  warning: 'Warning',
  error: 'Error',
  unreachable: 'Unreachable',
  unknown: 'Unknown',
};

const HEALTH_DOT_CLASS: Record<HealthState, string> = {
  ok: 'bg-status-ok',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  unreachable: 'bg-status-unreachable',
  unknown: 'bg-status-unknown',
};

/** The color-coded dot spec §5 calls for (green/yellow/red), extended with grey states for unreachable/unknown. */
export function StatusDot({ health, className = '' }: { health: HealthState; className?: string }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${HEALTH_DOT_CLASS[health]} ${className}`}
      title={HEALTH_LABEL[health]}
      aria-label={HEALTH_LABEL[health]}
    />
  );
}
