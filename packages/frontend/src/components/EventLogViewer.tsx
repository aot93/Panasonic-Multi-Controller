import { useState } from 'react';
import type { DeviceWithState, EventSeverity } from '@ppc/shared';
import { useEvents } from '../hooks/useEvents';

const SEVERITIES: EventSeverity[] = ['info', 'warning', 'error', 'critical'];

const SEVERITY_STYLE: Record<EventSeverity, string> = {
  info: 'text-slate-300',
  warning: 'text-amber-400',
  error: 'text-status-error',
  critical: 'text-red-400 font-medium',
};

interface EventLogViewerProps {
  devices: DeviceWithState[];
}

/**
 * NextSteps.md phase 1 item 2: a viewer for the error/event log in the main
 * UI, reading the same `events` table the per-device CSV files (item 1) are
 * written from — see backend/src/events/routes.ts and logging/error-log.ts.
 */
export function EventLogViewer({ devices }: EventLogViewerProps) {
  const [deviceId, setDeviceId] = useState<string>('');
  const [severity, setSeverity] = useState<string>('');

  const { data: events = [], isPending } = useEvents(
    deviceId ? Number(deviceId) : undefined,
    (severity || undefined) as EventSeverity | undefined,
  );

  const deviceName = (id: number | null) => (id === null ? 'Server' : devices.find((d) => d.id === id)?.name ?? `Device #${id}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Event log {events.length > 0 && `(${events.length})`}</h2>
        <div className="flex flex-wrap gap-2">
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm"
          >
            <option value="">All devices</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm"
          >
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Each device also has its own CSV file under the app's <code>data/logs/</code> folder, with a local-PC
        timestamp on every row — ready to open in a spreadsheet.
      </p>

      {isPending ? (
        <p className="text-slate-400">Loading…</p>
      ) : events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-800 p-8 text-center text-slate-500">No events recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-400">{new Date(event.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">{deviceName(event.deviceId)}</td>
                  <td className={`px-3 py-2 ${SEVERITY_STYLE[event.severity]}`}>{event.severity}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{event.code}</td>
                  <td className="px-3 py-2">{event.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
