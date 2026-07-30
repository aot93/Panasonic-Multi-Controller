import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pollerApi } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

/** NextSteps.md phase 3 item 13 — pause/resume the automatic poll cycle; dispatching commands is unaffected either way. */
export function usePollerStatus() {
  return useQuery({ queryKey: queryKeys.pollerStatus, queryFn: pollerApi.getStatus, refetchInterval: 15_000 });
}

export function useSetPollerPaused() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paused: boolean) => pollerApi.setPaused(paused),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.pollerStatus }),
  });
}
