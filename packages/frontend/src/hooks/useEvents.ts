import { useQuery } from '@tanstack/react-query';
import type { EventSeverity } from '@ppc/shared';
import { eventsApi } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

/** Backs the error log viewer (NextSteps.md phase 1 item 2) — polls rather than pushing live, since events are already broadcast over the socket for anyone who wants that; this just needs to render on open/filter-change. */
export function useEvents(deviceId?: number, severity?: EventSeverity) {
  return useQuery({
    queryKey: queryKeys.events(deviceId, severity),
    queryFn: () => eventsApi.list({ deviceId, severity, limit: 500 }),
    refetchInterval: 15_000,
  });
}
