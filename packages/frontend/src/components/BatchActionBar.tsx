import { useMemo, useState } from 'react';
import { formatQueryResponse, type CommandDef, type CommandResult, type CommandTarget } from '@ppc/shared';
import { CommandParamInput } from './CommandParamInput';
import { CommandPicker } from './CommandPicker';
import { useCommands } from '../hooks/useCommands';
import { useDeleteDevice, useDevices, useSetDeviceGroups } from '../hooks/useDevices';
import { useDispatch } from '../hooks/useDispatch';
import { useGroups } from '../hooks/useGroups';
import { useMacros, useRunMacro } from '../hooks/useMacros';

interface BatchActionBarProps {
  selectedIds: Set<number>;
  onClear: () => void;
}

/** Fixed footer appearing upon multi-selection, to trigger group commands (spec §5). */
export function BatchActionBar({ selectedIds, onClear }: BatchActionBarProps) {
  const { data: commands = [] } = useCommands();
  const { data: macros = [] } = useMacros();
  const { data: groups = [] } = useGroups();
  const { data: devices = [] } = useDevices();
  const dispatch = useDispatch();
  const runMacro = useRunMacro();
  const setDeviceGroups = useSetDeviceGroups();
  const deleteDevice = useDeleteDevice();

  const [commandId, setCommandId] = useState<number | ''>('');
  const [param, setParam] = useState('');
  const [macroId, setMacroId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [queryResult, setQueryResult] = useState<{ label: string; commandKey: string; results: CommandResult[] } | null>(
    null,
  );

  // One-click quick buttons only make sense for commands that need no param —
  // a favourite like "Select Input" (enum) still needs the picker below, so
  // it's excluded here rather than silently dispatching with param: null.
  const favourites = useMemo(
    () => commands.filter((c) => c.favourite && !c.isQuery && c.paramKind === 'none'),
    [commands],
  );
  const selectedCommand = commands.find((c) => c.id === commandId);

  if (selectedIds.size === 0) return null;

  const target: CommandTarget = { kind: 'device', ids: [...selectedIds] };

  async function sendCommand(command: CommandDef, paramValue: string | null) {
    // Powering off is the one quick-button action with a real consequence
    // (unlike e.g. a test pattern) — guard it here rather than per entry
    // point, since both the favourites button and the generic Send button
    // funnel through this same function.
    if (command.key === 'power.off') {
      const count = selectedIds.size;
      if (!window.confirm(`Turn off ${count} device${count === 1 ? '' : 's'}?`)) return;
    }
    setFeedback(null);
    setQueryResult(null);
    try {
      const { results } = await dispatch.mutateAsync({ target, commandId: command.id, param: paramValue });
      if (command.isQuery) {
        // A query's whole point is the returned value per device — a bare
        // success count throws that away (NextSteps.md phase 1 item 10).
        setQueryResult({ label: command.label, commandKey: command.key, results });
      } else {
        const okCount = results.filter((r) => r.ok).length;
        setFeedback(`${command.label}: ${okCount}/${results.length} succeeded`);
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRunMacro() {
    if (!macroId) return;
    setFeedback(null);
    try {
      const result = await runMacro.mutateAsync({ id: Number(macroId), target });
      const okSteps = result.steps.filter((s) => s.ok).length;
      setFeedback(`Macro: ${okSteps}/${result.steps.length} steps completed`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddToGroup() {
    if (!groupId) return;
    setFeedback(null);
    const gid = Number(groupId);
    try {
      await Promise.all(
        [...selectedIds].map((deviceId) => {
          const device = devices.find((d) => d.id === deviceId);
          const nextGroupIds = Array.from(new Set([...(device?.groupIds ?? []), gid]));
          return setDeviceGroups.mutateAsync({ id: deviceId, groupIds: nextGroupIds });
        }),
      );
      setFeedback(`Added ${selectedIds.size} device${selectedIds.size === 1 ? '' : 's'} to the group`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemoveFromGroup() {
    if (!groupId) return;
    const gid = Number(groupId);
    const groupName = groups.find((g) => g.id === gid)?.name ?? 'this group';
    const count = selectedIds.size;
    if (!window.confirm(`Remove ${count} device${count === 1 ? '' : 's'} from "${groupName}"?`)) return;
    setFeedback(null);
    try {
      await Promise.all(
        [...selectedIds].map((deviceId) => {
          const device = devices.find((d) => d.id === deviceId);
          const nextGroupIds = (device?.groupIds ?? []).filter((id) => id !== gid);
          return setDeviceGroups.mutateAsync({ id: deviceId, groupIds: nextGroupIds });
        }),
      );
      setFeedback(`Removed ${selectedIds.size} device${selectedIds.size === 1 ? '' : 's'} from the group`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteSelected() {
    const count = selectedIds.size;
    if (!window.confirm(`Remove ${count} device${count === 1 ? '' : 's'} from the application? This cannot be undone.`)) {
      return;
    }
    setFeedback(null);
    try {
      await Promise.all([...selectedIds].map((deviceId) => deleteDevice.mutateAsync(deviceId)));
      onClear();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-800 bg-slate-900/95 backdrop-blur">
      {queryResult && (
        <div className="mx-auto max-w-6xl px-4 pt-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wider text-slate-400">{queryResult.label} results</h3>
            <button type="button" onClick={() => setQueryResult(null)} className="text-xs text-slate-400 hover:text-slate-200">
              Dismiss
            </button>
          </div>
          <ul className="mt-1 max-h-40 overflow-y-auto text-sm">
            {queryResult.results.map((r) => (
              <li key={r.deviceId} className="flex justify-between gap-4 border-b border-slate-800/60 py-1 last:border-0">
                <span className="text-slate-300">{r.deviceName}</span>
                <span
                  className={r.ok ? 'text-slate-100' : 'text-status-error'}
                  title={r.ok && r.response !== null ? `Raw: ${r.response}` : undefined}
                >
                  {r.ok
                    ? r.response !== null
                      ? formatQueryResponse(queryResult.commandKey, r.response)
                      : '—'
                    : (r.error ?? r.errorCode ?? 'failed')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <span className="text-sm font-medium">
          {selectedIds.size} device{selectedIds.size === 1 ? '' : 's'} selected
        </span>
        <button type="button" onClick={onClear} className="text-sm text-slate-400 hover:text-slate-200">
          Clear
        </button>

        <div className="mx-2 h-6 w-px bg-slate-700" />

        {favourites.map((command) => (
          <button
            key={command.id}
            type="button"
            onClick={() => sendCommand(command, null)}
            disabled={dispatch.isPending}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-50"
          >
            {command.label}
          </button>
        ))}

        <div className="mx-2 h-6 w-px bg-slate-700" />

        <CommandPicker
          commands={commands}
          value={commandId}
          onChange={(id) => {
            setCommandId(id);
            setParam('');
          }}
        />

        <CommandParamInput command={selectedCommand} value={param} onChange={setParam} />

        {selectedCommand && (
          <button
            type="button"
            onClick={() => sendCommand(selectedCommand, selectedCommand.paramKind === 'none' ? null : param)}
            disabled={dispatch.isPending || (selectedCommand.paramKind !== 'none' && !param)}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
          >
            Send
          </button>
        )}

        <div className="mx-2 h-6 w-px bg-slate-700" />

        <select value={macroId} onChange={(e) => setMacroId(e.target.value)} className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm">
          <option value="">Run macro…</option>
          {macros.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {macroId && (
          <button
            type="button"
            onClick={handleRunMacro}
            disabled={runMacro.isPending}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium hover:bg-violet-500 disabled:opacity-50"
          >
            Run
          </button>
        )}

        <div className="mx-2 h-6 w-px bg-slate-700" />

        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm">
          <option value="">Group…</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        {groupId && (
          <>
            <button
              type="button"
              onClick={handleAddToGroup}
              disabled={setDeviceGroups.isPending}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={handleRemoveFromGroup}
              disabled={setDeviceGroups.isPending}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-50"
            >
              Remove
            </button>
          </>
        )}

        <div className="mx-2 h-6 w-px bg-slate-700" />

        <button
          type="button"
          onClick={handleDeleteSelected}
          disabled={deleteDevice.isPending}
          className="rounded-md border border-status-error/40 px-3 py-1.5 text-sm text-status-error hover:bg-status-error/10 disabled:opacity-50"
        >
          Delete selected
        </button>

        {feedback && <span className="ml-auto max-w-sm truncate text-sm text-slate-300">{feedback}</span>}
      </div>
    </div>
  );
}
