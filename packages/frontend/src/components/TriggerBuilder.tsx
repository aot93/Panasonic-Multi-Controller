import { useEffect, useState } from 'react';
import type { ExternalTrigger } from '@ppc/shared';
import { ApiError } from '../lib/api';
import { TriggerEditor } from './TriggerEditor';
import { useCommands } from '../hooks/useCommands';
import { useDevices } from '../hooks/useDevices';
import { useGroups } from '../hooks/useGroups';
import { useMacros } from '../hooks/useMacros';
import { useDeleteTrigger, useTriggerSettings, useTriggers, useUpdateTrigger, useUpdateTriggerSettings } from '../hooks/useTriggers';

function TriggerSettingsPanel() {
  const { data: settings, isPending } = useTriggerSettings();
  const updateSettings = useUpdateTriggerSettings();

  const [enabled, setEnabled] = useState(false);
  const [tcpPort, setTcpPort] = useState('5000');
  const [udpPort, setUdpPort] = useState('5000');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled);
      setTcpPort(String(settings.tcpPort));
      setUdpPort(String(settings.udpPort));
    }
  }, [settings]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateSettings.mutateAsync({ enabled, tcpPort: Number(tcpPort), udpPort: Number(udpPort) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Trigger listener</h2>
        {!isPending && (
          <span className={`rounded-full border px-2 py-0.5 text-xs ${settings?.running ? 'border-status-ok text-status-ok' : 'border-slate-700 text-slate-400'}`}>
            {settings?.running ? 'Running' : 'Stopped'}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-400">
        Lets an external system fire a command or macro by sending its trigger key over TCP or UDP.
      </p>

      <form onSubmit={handleSave} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 pb-1 text-xs text-slate-400">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <label className="flex flex-col text-xs text-slate-400">
          UDP port
          <input
            type="number"
            min={1}
            max={65535}
            value={udpPort}
            onChange={(e) => setUdpPort(e.target.value)}
            className="mt-1 w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          />
        </label>
        <label className="flex flex-col text-xs text-slate-400">
          TCP port
          <input
            type="number"
            min={1}
            max={65535}
            value={tcpPort}
            onChange={(e) => setTcpPort(e.target.value)}
            className="mt-1 w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          />
        </label>
        <button
          type="submit"
          disabled={updateSettings.isPending}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
        >
          {updateSettings.isPending ? 'Saving…' : 'Save'}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-status-error">{error}</p>}
    </section>
  );
}

function TriggerCard({ trigger }: { trigger: ExternalTrigger }) {
  const { data: devices = [] } = useDevices();
  const { data: groups = [] } = useGroups();
  const { data: commands = [] } = useCommands();
  const { data: macros = [] } = useMacros();
  const updateTrigger = useUpdateTrigger();
  const deleteTrigger = useDeleteTrigger();
  const [editing, setEditing] = useState(false);

  const targetLabel =
    trigger.targetKind === 'all'
      ? 'All devices'
      : trigger.targetKind === 'device'
        ? (devices.find((d) => d.id === trigger.targetId)?.name ?? `Device #${trigger.targetId}`)
        : (groups.find((g) => g.id === trigger.targetId)?.name ?? `Group #${trigger.targetId}`);

  const actionLabel =
    trigger.actionKind === 'command'
      ? (commands.find((c) => c.id === trigger.actionId)?.label ?? `Command #${trigger.actionId}`)
      : (macros.find((m) => m.id === trigger.actionId)?.name ?? `Macro #${trigger.actionId}`);

  if (editing) {
    return <TriggerEditor trigger={trigger} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded border border-slate-800 bg-slate-950 px-2 py-0.5 font-mono text-sm text-slate-200">{trigger.triggerKey}</span>
            {!trigger.enabled && <span className="text-xs text-slate-500">disabled</span>}
          </div>
          {trigger.description && <div className="mt-1 text-sm text-slate-400">{trigger.description}</div>}
          <div className="mt-1 text-xs text-slate-500">
            {trigger.actionKind === 'macro' ? 'Runs macro' : 'Runs command'} <span className="text-slate-300">{actionLabel}</span> on{' '}
            <span className="text-slate-300">{targetLabel}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">{trigger.lastFiredAt ? `Last fired ${new Date(trigger.lastFiredAt).toLocaleString()}` : 'Never fired'}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => updateTrigger.mutate({ id: trigger.id, input: { enabled: !trigger.enabled } })}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            {trigger.enabled ? 'Disable' : 'Enable'}
          </button>
          <button type="button" onClick={() => setEditing(true)} className="text-sm text-slate-400 hover:text-slate-200">
            Edit
          </button>
          <button type="button" onClick={() => deleteTrigger.mutate(trigger.id)} className="text-sm text-status-error hover:underline">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/** Manages external TCP/UDP triggers (spec §6) that fire a command or macro when their trigger key is received. */
export function TriggerBuilder() {
  const { data: triggers = [], isPending } = useTriggers();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <TriggerSettingsPanel />

      {creating ? (
        <TriggerEditor onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Triggers {triggers.length > 0 && `(${triggers.length})`}</h2>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800"
            >
              + New trigger
            </button>
          </div>

          {isPending && <p className="text-slate-400">Loading…</p>}

          {!isPending && triggers.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-800 p-8 text-center text-slate-500">
              No triggers yet. Add one to let an external system fire a command or macro over TCP/UDP.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {triggers.map((trigger) => (
              <TriggerCard key={trigger.id} trigger={trigger} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
