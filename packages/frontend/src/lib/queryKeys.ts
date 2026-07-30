/** Central query key factory so cache keys stay consistent across hooks/components. */
export const queryKeys = {
  devices: ['devices'] as const,
  device: (id: number) => ['devices', id] as const,
  deviceTelemetry: (id: number, metric?: string) => ['devices', id, 'telemetry', metric ?? 'all'] as const,
  groups: ['groups'] as const,
  commands: ['commands'] as const,
  macros: ['macros'] as const,
  macro: (id: number) => ['macros', id] as const,
  globalCredentials: ['settings', 'credentials'] as const,
  events: (deviceId?: number, severity?: string) => ['events', deviceId ?? 'all', severity ?? 'all'] as const,
  serverHealth: ['server', 'health'] as const,
  pollerStatus: ['poller', 'status'] as const,
};
