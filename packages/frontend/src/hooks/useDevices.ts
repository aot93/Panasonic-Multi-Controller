import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TelemetryMetric } from '@ppc/shared';
import { devicesApi, type BulkCreateDevicesInput, type CreateDeviceInput, type UpdateDeviceInput } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

export function useDevices() {
  return useQuery({ queryKey: queryKeys.devices, queryFn: devicesApi.list });
}

export function useDeviceTelemetry(deviceId: number, metric?: TelemetryMetric, since?: string) {
  return useQuery({
    queryKey: queryKeys.deviceTelemetry(deviceId, metric),
    queryFn: () => devicesApi.telemetry(deviceId, { metric, since, limit: 2000 }),
    enabled: deviceId > 0,
  });
}

export function useCreateDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDeviceInput) => devicesApi.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });
}

export function useBulkCreateDevices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkCreateDevicesInput) => devicesApi.createBulk(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });
}

export function useUpdateDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateDeviceInput }) => devicesApi.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });
}

export function useDeleteDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => devicesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });
}

export function useSetDeviceGroups() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, groupIds }: { id: number; groupIds: number[] }) => devicesApi.setGroups(id, groupIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });
}

export function useSetDeviceCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, username, password }: { id: number; username?: string | null; password?: string | null }) =>
      devicesApi.setCredentials(id, { username, password }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });
}

export function useClearDeviceCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => devicesApi.clearCredentials(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });
}
