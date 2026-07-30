import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { groupsApi } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

export function useGroups() {
  return useQuery({ queryKey: queryKeys.groups, queryFn: groupsApi.list });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string | null }) => groupsApi.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => groupsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
    },
  });
}
