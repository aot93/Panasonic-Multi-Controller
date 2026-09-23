import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { triggersApi, type TriggerInput, type UpdateTriggerInput } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

export function useTriggers() {
  return useQuery({ queryKey: queryKeys.triggers, queryFn: triggersApi.list });
}

export function useCreateTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TriggerInput) => triggersApi.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.triggers }),
  });
}

export function useUpdateTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateTriggerInput }) => triggersApi.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.triggers }),
  });
}

export function useDeleteTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => triggersApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.triggers }),
  });
}

export function useTriggerSettings() {
  return useQuery({ queryKey: queryKeys.triggerSettings, queryFn: triggersApi.getSettings });
}

export function useUpdateTriggerSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { enabled: boolean; tcpPort: number; udpPort: number }) => triggersApi.putSettings(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.triggerSettings }),
  });
}
