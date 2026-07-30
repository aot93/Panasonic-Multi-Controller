import type {
  BulkCreateDeviceResult,
  CommandDef,
  CommandParamKind,
  CommandParamOption,
  CommandResult,
  CommandTarget,
  DeviceEvent,
  DeviceWithState,
  EventSeverity,
  GlobalCredentialsStatus,
  GroupWithCount,
  Macro,
  MacroRunResult,
  ProjectFile,
  ProjectImportResult,
  TelemetryMetric,
  TelemetrySample,
} from '@ppc/shared';

/**
 * Thin fetch wrapper — same-origin in production, proxied by Vite in dev
 * (see vite.config.ts). No client-side caching or retry logic here; that's
 * TanStack Query's job (see hooks/ and each component).
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, (body as { issues?: unknown } | null)?.issues);
  }
  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const put = <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

export interface CreateDeviceInput {
  name: string;
  host: string;
  port?: number;
  location?: string | null;
  notes?: string | null;
  pollIntervalSec?: number | null;
}
export type UpdateDeviceInput = Partial<CreateDeviceInput> & { enabled?: boolean };

export interface BulkCreateDevicesInput {
  namePrefix?: string | null;
  startIp: string;
  endIp: string;
  port?: number;
  pollIntervalSec?: number | null;
}

export const devicesApi = {
  list: () => get<DeviceWithState[]>('/api/devices'),
  get: (id: number) => get<DeviceWithState>(`/api/devices/${id}`),
  create: (input: CreateDeviceInput) => post<DeviceWithState>('/api/devices', input),
  createBulk: (input: BulkCreateDevicesInput) => post<BulkCreateDeviceResult[]>('/api/devices/bulk', input),
  update: (id: number, input: UpdateDeviceInput) => patch<DeviceWithState>(`/api/devices/${id}`, input),
  remove: (id: number) => del<void>(`/api/devices/${id}`),
  setGroups: (id: number, groupIds: number[]) => put<DeviceWithState>(`/api/devices/${id}/groups`, { groupIds }),
  setCredentials: (id: number, input: { username?: string | null; password?: string | null }) =>
    put<DeviceWithState>(`/api/devices/${id}/credentials`, input),
  clearCredentials: (id: number) => del<DeviceWithState>(`/api/devices/${id}/credentials`),
  telemetry: (id: number, params?: { metric?: TelemetryMetric; since?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.metric) qs.set('metric', params.metric);
    if (params?.since) qs.set('since', params.since);
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return get<TelemetrySample[]>(`/api/devices/${id}/telemetry${suffix}`);
  },
};

/* ------------------------------------------------------------------ */
/* Groups                                                              */
/* ------------------------------------------------------------------ */

export const groupsApi = {
  list: () => get<GroupWithCount[]>('/api/groups'),
  create: (input: { name: string; description?: string | null; sortOrder?: number }) =>
    post<GroupWithCount>('/api/groups', input),
  update: (id: number, input: { name?: string; description?: string | null; sortOrder?: number }) =>
    patch<GroupWithCount>(`/api/groups/${id}`, input),
  remove: (id: number) => del<void>(`/api/groups/${id}`),
};

/* ------------------------------------------------------------------ */
/* Commands                                                             */
/* ------------------------------------------------------------------ */

export interface CommandInput {
  key: string;
  label: string;
  category?: string;
  body: string;
  isQuery?: boolean;
  paramKind?: CommandParamKind;
  paramOptions?: CommandParamOption[] | null;
  paramMin?: number | null;
  paramMax?: number | null;
  favourite?: boolean;
  sortOrder?: number;
  description?: string | null;
}

export type UpdateCommandInput = Partial<Omit<CommandInput, 'key'>>;

export const commandsApi = {
  list: () => get<CommandDef[]>('/api/commands'),
  create: (input: CommandInput) => post<CommandDef>('/api/commands', input),
  update: (id: number, input: UpdateCommandInput) => patch<CommandDef>(`/api/commands/${id}`, input),
  remove: (id: number) => del<void>(`/api/commands/${id}`),
};

/* ------------------------------------------------------------------ */
/* Events (error log viewer)                                           */
/* ------------------------------------------------------------------ */

export const eventsApi = {
  list: (params?: { deviceId?: number; severity?: EventSeverity; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.deviceId !== undefined) qs.set('deviceId', String(params.deviceId));
    if (params?.severity) qs.set('severity', params.severity);
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return get<DeviceEvent[]>(`/api/events${suffix}`);
  },
};

/* ------------------------------------------------------------------ */
/* Project files (save/load configuration)                             */
/* ------------------------------------------------------------------ */

export const projectApi = {
  export: () => get<ProjectFile>('/api/project/export'),
  import: (file: ProjectFile) => post<ProjectImportResult>('/api/project/import', file),
};

/* ------------------------------------------------------------------ */
/* Dispatch                                                             */
/* ------------------------------------------------------------------ */

export interface DispatchInput {
  target: CommandTarget;
  commandId?: number;
  commandKey?: string;
  param?: string | null;
}

export const dispatchApi = {
  run: (input: DispatchInput) => post<{ dispatchId: string; results: CommandResult[] }>('/api/dispatch', input),
};

/* ------------------------------------------------------------------ */
/* Macros                                                               */
/* ------------------------------------------------------------------ */

export interface MacroStepInput {
  commandId: number;
  param?: string | null;
  delayMsAfter?: number;
  targetKind?: CommandTarget['kind'] | null;
  targetId?: number | null;
}

export interface MacroInput {
  name: string;
  description?: string | null;
  colour?: string | null;
  icon?: string | null;
  sortOrder?: number;
  steps: MacroStepInput[];
}

export const macrosApi = {
  list: () => get<Macro[]>('/api/macros'),
  get: (id: number) => get<Macro>(`/api/macros/${id}`),
  create: (input: MacroInput) => post<Macro>('/api/macros', input),
  update: (id: number, input: Partial<MacroInput>) => patch<Macro>(`/api/macros/${id}`, input),
  remove: (id: number) => del<void>(`/api/macros/${id}`),
  run: (id: number, target?: CommandTarget) => post<MacroRunResult>(`/api/macros/${id}/run`, target ? { target } : {}),
};

/* ------------------------------------------------------------------ */
/* Settings (global credentials)                                       */
/* ------------------------------------------------------------------ */

export const settingsApi = {
  getGlobalCredentials: () => get<GlobalCredentialsStatus>('/api/settings/credentials'),
  setGlobalCredentials: (username: string, password: string) =>
    put<GlobalCredentialsStatus>('/api/settings/credentials', { username, password }),
  clearGlobalCredentials: () => del<GlobalCredentialsStatus>('/api/settings/credentials'),
};

/* ------------------------------------------------------------------ */
/* Server info (NextSteps.md phase 3 item 12)                          */
/* ------------------------------------------------------------------ */

export interface ServerHealth {
  ok: boolean;
  version: string;
  devices: number;
  uptimeSec: number;
  port: number;
  lanAddresses: string[];
}

export const serverApi = {
  health: () => get<ServerHealth>('/api/health'),
};

/* ------------------------------------------------------------------ */
/* Poller pause/resume (NextSteps.md phase 3 item 13)                   */
/* ------------------------------------------------------------------ */

export const pollerApi = {
  getStatus: () => get<{ paused: boolean }>('/api/poller/status'),
  setPaused: (paused: boolean) => put<{ paused: boolean }>('/api/poller/status', { paused }),
};
