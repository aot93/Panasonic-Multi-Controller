import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dispatchApi, type DispatchInput } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

/** Fires a command at a device/group/all target. The poller re-polls affected devices server-side, and Socket.io pushes the result — but invalidating here too covers the case where a query command's response is only visible via a fresh fetch. */
export function useDispatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DispatchInput) => dispatchApi.run(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });
}
