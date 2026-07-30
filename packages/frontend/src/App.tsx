import { useState } from 'react';
import { AnalyticsPane } from './components/AnalyticsPane';
import { BatchActionBar } from './components/BatchActionBar';
import { CommandCatalogueManager } from './components/CommandCatalogueManager';
import { DeviceCredentialsModal } from './components/DeviceCredentialsModal';
import { DeviceGrid } from './components/DeviceGrid';
import { EventLogViewer } from './components/EventLogViewer';
import { GlobalCredentialsForm } from './components/GlobalCredentialsForm';
import { GroupsManager } from './components/GroupsManager';
import { MacroBuilder } from './components/MacroBuilder';
import { NameVerificationSettingsForm } from './components/NameVerificationSettingsForm';
import { PreviewGrid } from './components/PreviewGrid';
import { ProjectFileManager } from './components/ProjectFileManager';
import { useDevices } from './hooks/useDevices';
import { useDeviceSocket } from './hooks/useDeviceSocket';
import { useGroups } from './hooks/useGroups';
import { usePollerStatus, useSetPollerPaused } from './hooks/usePollerStatus';
import { useServerInfo } from './hooks/useServerInfo';

type Tab = 'devices' | 'macros' | 'preview' | 'logs' | 'settings';
const TABS: Tab[] = ['devices', 'macros', 'preview', 'logs', 'settings'];

export function App() {
  const [tab, setTab] = useState<Tab>('devices');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [analyticsDeviceId, setAnalyticsDeviceId] = useState<number | null>(null);
  const [credentialsDeviceId, setCredentialsDeviceId] = useState<number | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);

  const { connected } = useDeviceSocket();
  const { data: devices = [], isPending, isError, error } = useDevices();
  const { data: groups = [] } = useGroups();
  const { data: serverInfo } = useServerInfo();
  const { data: pollerStatus } = usePollerStatus();
  const setPollerPaused = useSetPollerPaused();

  function toggleSelected(deviceId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 pb-28">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projector Control</h1>
          <p className="text-sm text-slate-400">Panasonic fleet monitoring and control</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-status-ok' : 'bg-status-error'}`} />
            {connected ? 'Live' : 'Disconnected'}
            <button
              type="button"
              onClick={() => setPollerPaused.mutate(!pollerStatus?.paused)}
              disabled={setPollerPaused.isPending}
              title="Dispatching commands still works while paused"
              className={`ml-2 rounded-full border px-2 py-0.5 text-xs disabled:opacity-50 ${
                pollerStatus?.paused
                  ? 'border-amber-500 bg-amber-950/40 text-amber-200'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {pollerStatus?.paused ? 'Polling paused — Resume' : 'Pause polling'}
            </button>
          </div>
          {serverInfo && serverInfo.lanAddresses.length > 0 && (
            <span>Server: {serverInfo.lanAddresses.map((addr) => `${addr}:${serverInfo.port}`).join(', ')}</span>
          )}
        </div>
      </header>

      <nav className="mb-6 flex gap-1 border-b border-slate-800">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`border-b-2 px-3 py-2 text-sm capitalize transition-colors ${
              tab === t ? 'border-sky-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'devices' && (
        <>
          {isPending && <p className="text-slate-400">Loading…</p>}
          {isError && <p className="text-status-error">{(error as Error).message}</p>}
          {!isPending && !isError && (
            <DeviceGrid
              devices={devices}
              groups={groups}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
              onSelectIds={(ids) => setSelectedIds(new Set(ids))}
              onOpenAnalytics={setAnalyticsDeviceId}
              onOpenCredentials={setCredentialsDeviceId}
              activeGroupId={activeGroupId}
              onSetActiveGroupId={setActiveGroupId}
            />
          )}
        </>
      )}

      {tab === 'macros' && <MacroBuilder />}

      {tab === 'preview' && <PreviewGrid />}

      {tab === 'logs' && <EventLogViewer devices={devices} />}

      {tab === 'settings' && (
        <div className="flex flex-col gap-4">
          <GlobalCredentialsForm />
          <NameVerificationSettingsForm />
          <GroupsManager />
          <CommandCatalogueManager />
          <ProjectFileManager />
        </div>
      )}

      {tab === 'devices' && <BatchActionBar selectedIds={selectedIds} onClear={() => setSelectedIds(new Set())} />}
      {analyticsDeviceId !== null && (
        <AnalyticsPane deviceId={analyticsDeviceId} onClose={() => setAnalyticsDeviceId(null)} />
      )}
      {credentialsDeviceId !== null && (
        <DeviceCredentialsModal deviceId={credentialsDeviceId} onClose={() => setCredentialsDeviceId(null)} />
      )}
    </div>
  );
}
