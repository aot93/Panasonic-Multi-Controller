import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

export function useGlobalCredentials() {
  return useQuery({ queryKey: queryKeys.globalCredentials, queryFn: settingsApi.getGlobalCredentials });
}

export function useSetGlobalCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      settingsApi.setGlobalCredentials(username, password),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.globalCredentials }),
  });
}

export function useClearGlobalCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => settingsApi.clearGlobalCredentials(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.globalCredentials }),
  });
}
