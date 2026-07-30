import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commandsApi, type CommandInput, type UpdateCommandInput } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

export function useCommands() {
  return useQuery({ queryKey: queryKeys.commands, queryFn: commandsApi.list, staleTime: 5 * 60_000 });
}

export function useCreateCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CommandInput) => commandsApi.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.commands }),
  });
}

export function useUpdateCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateCommandInput }) => commandsApi.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.commands }),
  });
}

export function useDeleteCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => commandsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.commands }),
  });
}
