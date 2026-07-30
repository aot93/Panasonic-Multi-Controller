import { useQuery } from '@tanstack/react-query';
import { serverApi } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

/** NextSteps.md phase 3 item 12 — the server's own LAN address(es), shown under the connection light. Rarely changes, so a long staleTime is fine. */
export function useServerInfo() {
  return useQuery({ queryKey: queryKeys.serverHealth, queryFn: serverApi.health, staleTime: 60_000 });
}
