import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommandTarget } from '@ppc/shared';
import { macrosApi, type MacroInput } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

export function useMacros() {
  return useQuery({ queryKey: queryKeys.macros, queryFn: macrosApi.list });
}

export function useCreateMacro() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MacroInput) => macrosApi.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.macros }),
  });
}

export function useUpdateMacro() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: Partial<MacroInput> }) => macrosApi.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.macros }),
  });
}

export function useDeleteMacro() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => macrosApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.macros }),
  });
}

export function useRunMacro() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, target }: { id: number; target?: CommandTarget }) => macrosApi.run(id, target),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });
}
