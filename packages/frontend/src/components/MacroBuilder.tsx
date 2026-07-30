import { useState } from 'react';
import type { CommandTarget, Macro, TargetKind } from '@ppc/shared';
import { MacroEditor } from './MacroEditor';
import { useDevices } from '../hooks/useDevices';
import { useGroups } from '../hooks/useGroups';
import { useDeleteMacro, useMacros, useRunMacro } from '../hooks/useMacros';

function RunMacroControl({ macro }: { macro: Macro }) {
  const { data: devices = [] } = useDevices();
  const { data: groups = [] } = useGroups();
  const runMacro = useRunMacro();

  const [kind, setKind] = useState<TargetKind>('all');
  const [id, setId] = useState<string>('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const stepsHaveOwnTargets = macro.steps.every((s) => s.targetKind !== null);

  async function handleRun() {
    setFeedback(null);
    let target: CommandTarget | undefined;
    if (kind === 'all') {
      target = { kind: 'all' };
    } else if (id) {
      target = { kind, ids: [Number(id)] };
    } else if (!stepsHaveOwnTargets) {
      setFeedback('Choose a target, or set a target override on every step.');
      return;
    }

    try {
      const result = await runMacro.mutateAsync({ id: macro.id, target });
      const ok = result.steps.filter((s) => s.ok).length;
      setFeedback(`${ok}/${result.steps.length} steps completed`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={kind}
        onChange={(e) => {
          setKind(e.target.value as TargetKind);
          setId('');
        }}
        className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
      >
        <option value="all">All devices</option>
        <option value="device">Device…</option>
        <option value="group">Group…</option>
      </select>
      {kind === 'device' && (
        <select value={id} onChange={(e) => setId(e.target.value)} className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs">
          <option value="">Choose…</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
      {kind === 'group' && (
        <select value={id} onChange={(e) => setId(e.target.value)} className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs">
          <option value="">Choose…</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={handleRun}
        disabled={runMacro.isPending}
        className="rounded-md bg-violet-600 px-3 py-1 text-xs font-medium hover:bg-violet-500 disabled:opacity-50"
      >
        Run
      </button>
      {feedback && <span className="text-xs text-slate-400">{feedback}</span>}
    </div>
  );
}

/** Custom button/macro builder (spec §5). */
export function MacroBuilder() {
  const { data: macros = [], isPending } = useMacros();
  const deleteMacro = useDeleteMacro();
  const [editing, setEditing] = useState<Macro | 'new' | null>(null);

  if (editing) {
    return (
      <MacroEditor
        macro={editing === 'new' ? undefined : editing}
        onDone={() => setEditing(null)}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Macros {macros.length > 0 && `(${macros.length})`}</h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800"
        >
          + New macro
        </button>
      </div>

      {isPending && <p className="text-slate-400">Loading…</p>}

      {!isPending && macros.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-800 p-8 text-center text-slate-500">
          No macros yet. Build one to bind a sequence of actions to a single button.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {macros.map((macro) => (
          <div key={macro.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium">{macro.name}</div>
                {macro.description && <div className="text-sm text-slate-400">{macro.description}</div>}
                <div className="mt-1 text-xs text-slate-500">{macro.steps.length} step{macro.steps.length === 1 ? '' : 's'}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => setEditing(macro)} className="text-sm text-slate-400 hover:text-slate-200">
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => deleteMacro.mutate(macro.id)}
                  className="text-sm text-status-error hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="mt-3">
              <RunMacroControl macro={macro} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
