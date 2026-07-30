import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DeviceState, DeviceWithState } from '@ppc/shared';
import { getSocket } from '../lib/socket';
import { queryKeys } from '../lib/queryKeys';

/**
 * Subscribes to live device state on the shared socket and patches the
 * `queryKeys.devices` cache directly as updates arrive — no polling needed
 * once the initial `GET /api/devices` (via useDevices()) has loaded. This is
 * what makes the grid view "live" (spec §2: "Real-time dashboard").
 */
export function useDeviceSocket(): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => {
      setConnected(true);
      socket.emit('devices:subscribe');
    };
    const onDisconnect = () => setConnected(false);
    const onDeviceState = (state: DeviceState) => {
      queryClient.setQueryData<DeviceWithState[]>(queryKeys.devices, (devices) =>
        devices?.map((d) => (d.id === state.deviceId ? { ...d, state } : d)),
      );
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('device:state', onDeviceState);
    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('device:state', onDeviceState);
    };
  }, [queryClient]);

  return { connected };
}

/** Forces an immediate re-poll of specific devices (or everything, if omitted). */
export function requestDeviceRefresh(deviceIds?: number[]): void {
  getSocket().emit('devices:refresh', deviceIds ? { deviceIds } : {});
}
