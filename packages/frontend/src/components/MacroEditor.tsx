import { useMemo, useState } from 'react';
import type { Macro } from '@ppc/shared';
import { CommandParamInput } from './CommandParamInput';
import { CommandPicker } from './CommandPicker';
import { useCommands } from '../hooks/useCommands';
import { useCreateMacro, useMacros, useUpdateMacro } from '../hooks/useMacros';
import type { MacroInput, MacroStepInput } from '../lib/api';

interface DraftStep extends MacroStepInput {
  /** Client-only key for React list rendering — a new step has no server id yet. */
  key: string;
}

let nextKey = 0;
function draftKey(): string {
  nextKey += 1;
  return `draft-${nextKey}`;
}

function toDraftSteps(macro?: Macro): DraftStep[] {
  if (!macro) return [];
  return macro.steps.map((s) => ({
    key: draftKey(),
    kind: s.kind,
    commandId: s.commandId,
    childMacroId: s.childMacroId,
    param: s.param,
    delayMsAfter: s.delayMsAfter,
    targetKind: s.targetKind,
    targetId: s.targetId,
  }));
}

/** True if calling `childId` from `ownerId` would (transitively) call back into `ownerId` — a client-side mirror of the server's loop gate, used only to grey out choices that would obviously be rejected. */
function wouldLoop(allMacros: Macro[], ownerId: number | undefined, childId: number): boolean {
  if (ownerId === undefined) return false; // a brand-new macro has no id yet, so nothing can call back into it
  const seen = new Set<number>([ownerId]);
  const queue = [childId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === ownerId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const macro = allMacros.find((m) => m.id === current);
    for (const step of macro?.steps ?? []) {
      if (step.kind === 'macro' && step.childMacroId !== null) queue.push(step.childMacroId);
    }
  }
  return false;
}

interface MacroEditorProps {
  /** Undefined means "creating a new macro". */
  macro?: Macro;
  onDone: () => void;
  onCancel: () => void;
}

/** Custom button/macro builder (spec §5): program a sequence of actions and bind them to a custom button. */
export function MacroEditor({ macro, onDone, onCancel }: MacroEditorProps) {
  const { data: commands = [] } = useCommands();
  const { data: allMacros = [] } = useMacros();
  const createMacro = useCreateMacro();
  const updateMacro = useUpdateMacro();

  const [name, setName] = useState(macro?.name ?? '');
  const [description, setDescription] = useState(macro?.description ?? '');
  const [steps, setSteps] = useState<DraftStep[]>(() => toDraftSteps(macro));
  const [error, setError] = useState<string | null>(null);

  const saving = createMacro.isPending || updateMacro.isPending;

  /** Other macros this one can call without an obvious loop — the server has the final say (it also sees in-flight edits to other macros), this just keeps the picker from offering choices that would always be rejected. */
  const callableMacros = useMemo(
    () => allMacros.filter((m) => m.id !== macro?.id && !wouldLoop(allMacros, macro?.id, m.id)),
    [allMacros, macro?.id],
  );

  function addStep() {
    const first = commands[0];
    if (!first) return;
    setSteps((prev) => [...prev, { key: draftKey(), kind: 'command', commandId: first.id, childMacroId: null, param: null, delayMsAfter: 200, targetKind: null, targetId: null }]);
  }

  function updateStep(key: string, patch: Partial<DraftStep>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function removeStep(key: string) {
    setSteps((prev) => prev.filter((s) => s.key !== key));
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (steps.length === 0) {
      setError('A macro needs at least one step');
      return;
    }

    const input: MacroInput = {
      name: name.trim(),
      description: description.trim() || null,
      steps: steps.map(({ key: _key, ...step }) => step),
    };

    try {
      if (macro) {
        await updateMacro.mutateAsync({ id: macro.id, input });
      } else {
        await createMacro.mutateAsync(input);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col text-xs text-slate-400">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          />
        </label>
        <label className="flex flex-1 flex-col text-xs text-slate-400">
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-slate-400">Steps</h3>
        {steps.length === 0 && <p className="text-sm text-slate-500">No steps yet — add one below.</p>}
        {steps.map((step, index) => {
          const command = commands.find((c) => c.id === step.commandId);
          return (
            <div key={step.key} className="flex flex-wrap items-center gap-2 rounded border border-slate-800 bg-slate-950/60 p-2">
              <span className="w-5 text-center text-xs text-slate-500">{index + 1}</span>

              <select
                value={step.kind ?? 'command'}
                onChange={(e) => {
                  const kind = e.target.value as 'command' | 'macro';
                  updateStep(step.key, kind === 'command' ? { kind, childMacroId: null, commandId: commands[0]?.id ?? null } : { kind, commandId: null, param: null, childMacroId: callableMacros[0]?.id ?? null });
                }}
                className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm"
              >
                <option value="command">Command</option>
                <option value="macro">Run macro</option>
              </select>

              {step.kind === 'macro' ? (
                <select
                  value={step.childMacroId ?? ''}
                  onChange={(e) => updateStep(step.key, { childMacroId: Number(e.target.value) })}
                  className="max-w-[14rem] rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm"
                >
                  <option value="">Choose a macro…</option>
                  {callableMacros.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <CommandPicker
                    commands={commands}
                    value={step.commandId ?? ''}
                    onChange={(commandId) => updateStep(step.key, { commandId, param: null })}
                    placeholder="Choose a command…"
                  />

                  <CommandParamInput command={command} value={step.param ?? ''} onChange={(v) => updateStep(step.key, { param: v })} />
                </>
              )}

              <label className="flex items-center gap-1 text-xs text-slate-400">
                Delay after (ms)
                <input
                  type="number"
                  min={0}
                  value={step.delayMsAfter ?? 200}
                  onChange={(e) => updateStep(step.key, { delayMsAfter: Number(e.target.value) })}
                  className="w-20 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                />
              </label>

              <div className="ml-auto flex gap-1">
                <button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0} className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30">
                  ↑
                </button>
                <button type="button" onClick={() => moveStep(index, 1)} disabled={index === steps.length - 1} className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30">
                  ↓
                </button>
                <button type="button" onClick={() => removeStep(step.key)} className="rounded px-2 py-1 text-xs text-status-error hover:underline">
                  Remove
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          onClick={addStep}
          disabled={commands.length === 0}
          className="self-start rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50"
        >
          + Add step
        </button>
      </div>

      {error && <p className="text-sm text-status-error">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save macro'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200">
          Cancel
        </button>
      </div>
    </div>
  );
}
