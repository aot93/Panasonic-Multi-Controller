import { useState } from 'react';
import type { ExternalTrigger, TargetKind } from '@ppc/shared';
import { ApiError, type TriggerInput } from '../lib/api';
import { CommandParamInput } from './CommandParamInput';
import { CommandPicker } from './CommandPicker';
import { useCommands } from '../hooks/useCommands';
import { useDevices } from '../hooks/useDevices';
import { useGroups } from '../hooks/useGroups';
import { useMacros } from '../hooks/useMacros';
import { useCreateTrigger, useUpdateTrigger } from '../hooks/useTriggers';

interface TriggerEditorProps {
  /** Undefined means "creating a new trigger". */
  trigger?: ExternalTrigger;
  onDone: () => void;
  onCancel: () => void;
}

/** Editor for a single external TCP/UDP trigger — fires a command or macro when its triggerKey is received. */
export function TriggerEditor({ trigger, onDone, onCancel }: TriggerEditorProps) {
  const { data: commands = [] } = useCommands();
  const { data: macros = [] } = useMacros();
  const { data: devices = [] } = useDevices();
  const { data: groups = [] } = useGroups();
  const createTrigger = useCreateTrigger();
  const updateTrigger = useUpdateTrigger();

  const [triggerKey, setTriggerKey] = useState(trigger?.triggerKey ?? '');
  const [description, setDescription] = useState(trigger?.description ?? '');
  const [enabled, setEnabled] = useState(trigger?.enabled ?? true);
  const [targetKind, setTargetKind] = useState<TargetKind>(trigger?.targetKind ?? 'all');
  const [targetId, setTargetId] = useState<string>(trigger?.targetId != null ? String(trigger.targetId) : '');
  const [actionKind, setActionKind] = useState<'command' | 'macro'>(trigger?.actionKind ?? 'command');
  const [actionId, setActionId] = useState<number | ''>(trigger?.actionId ?? '');
  const [param, setParam] = useState(trigger?.param ?? '');
  const [error, setError] = useState<string | null>(null);

  const saving = createTrigger.isPending || updateTrigger.isPending;
  const command = commands.find((c) => c.id === actionId);

  async function handleSave() {
    setError(null);
    if (!trigger && !triggerKey.trim()) {
      setError('Trigger key is required');
      return;
    }
    if (targetKind !== 'all' && !targetId) {
      setError('Choose a target device or group');
      return;
    }
    if (!actionId) {
      setError(actionKind === 'command' ? 'Choose a command' : 'Choose a macro');
      return;
    }

    const shared = {
      description: description.trim() || null,
      targetKind,
      targetId: targetKind === 'all' ? null : Number(targetId),
      actionKind,
      actionId,
      param: actionKind === 'command' ? param.trim() || null : null,
    };

    try {
      if (trigger) {
        await updateTrigger.mutateAsync({ id: trigger.id, input: { ...shared, enabled } });
      } else {
        const input: TriggerInput = { triggerKey: triggerKey.trim(), ...shared };
        await createTrigger.mutateAsync(input);
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col text-xs text-slate-400">
          Trigger key
          {trigger ? (
            <span className="mt-1 rounded border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-300">{trigger.triggerKey}</span>
          ) : (
            <input
              value={triggerKey}
              onChange={(e) => setTriggerKey(e.target.value)}
              placeholder="e.g. lights-on"
              className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-100"
            />
          )}
        </label>
        <label className="flex flex-1 flex-col text-xs text-slate-400">
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-1 text-xs text-slate-400">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Target</span>
        <select
          value={targetKind}
          onChange={(e) => {
            setTargetKind(e.target.value as TargetKind);
            setTargetId('');
          }}
          className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm"
        >
          <option value="all">All devices</option>
          <option value="device">Device…</option>
          <option value="group">Group…</option>
        </select>
        {targetKind === 'device' && (
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm">
            <option value="">Choose…</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        {targetKind === 'group' && (
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm">
            <option value="">Choose…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Action</span>
        <select
          value={actionKind}
          onChange={(e) => {
            setActionKind(e.target.value as 'command' | 'macro');
            setActionId('');
            setParam('');
          }}
          className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm"
        >
          <option value="command">Run command</option>
          <option value="macro">Run macro</option>
        </select>

        {actionKind === 'command' ? (
          <>
            <CommandPicker commands={commands} value={actionId} onChange={setActionId} placeholder="Choose a command…" />
            <CommandParamInput command={command} value={param} onChange={setParam} />
          </>
        ) : (
          <select value={actionId} onChange={(e) => setActionId(e.target.value ? Number(e.target.value) : '')} className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm">
            <option value="">Choose a macro…</option>
            {macros.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="text-sm text-status-error">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save trigger'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200">
          Cancel
        </button>
      </div>
    </div>
  );
}
