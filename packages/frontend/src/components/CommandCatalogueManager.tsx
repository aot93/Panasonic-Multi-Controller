import { useState } from 'react';
import type { CommandParamKind } from '@ppc/shared';
import { ApiError } from '../lib/api';
import { useCommands, useCreateCommand, useDeleteCommand } from '../hooks/useCommands';

const PARAM_KINDS: CommandParamKind[] = ['none', 'enum', 'integer', 'string'];

/**
 * NextSteps.md phase 1 item 7: UI for operators to add their own control
 * codes on top of the built-in set (backend CRUD already existed from phase
 * 4 — commands/routes.ts — this was the missing frontend). Built-in rows
 * can't be deleted here, matching the server-side rule.
 */
export function CommandCatalogueManager() {
  const { data: commands = [], isPending } = useCommands();
  const createCommand = useCreateCommand();
  const deleteCommand = useDeleteCommand();

  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('Custom');
  const [body, setBody] = useState('');
  const [isQuery, setIsQuery] = useState(false);
  const [paramKind, setParamKind] = useState<CommandParamKind>('none');
  const [enumOptionsText, setEnumOptionsText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!key.trim() || !label.trim() || !body.trim()) return;

    let paramOptions: { label: string; value: string }[] | undefined;
    if (paramKind === 'enum') {
      paramOptions = enumOptionsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [value, ...rest] = line.split('=');
          return { value: (value ?? '').trim(), label: (rest.join('=').trim() || value || '').trim() };
        });
      if (paramOptions.length === 0) {
        setError('Enum commands need at least one option, one per line as "value=label"');
        return;
      }
    }

    try {
      await createCommand.mutateAsync({
        key: key.trim(),
        label: label.trim(),
        category: category.trim() || 'Custom',
        body: body.trim(),
        isQuery,
        paramKind,
        paramOptions,
      });
      setKey('');
      setLabel('');
      setBody('');
      setEnumOptionsText('');
      setParamKind('none');
      setIsQuery(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  const custom = commands.filter((c) => !c.builtIn);

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Custom control codes</h2>
      <p className="mt-1 text-sm text-slate-400">
        Add your own commands on top of the built-in set — e.g. anything from the official command list this app
        doesn't already cover. <code>{'{p}'}</code> in the body is replaced with the parameter, if any.
      </p>

      {isPending && <p className="mt-2 text-sm text-slate-400">Loading…</p>}

      {!isPending && (
        <ul className="mt-3 flex flex-col gap-1">
          {custom.length === 0 && <li className="text-sm text-slate-500">No custom commands yet.</li>}
          {custom.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded border border-slate-800 px-3 py-1.5 text-sm">
              <span>
                <span className="font-medium">{c.label}</span>{' '}
                <span className="text-slate-500">
                  ({c.category} · <code>{c.body}</code>
                  {c.isQuery ? ' · query' : ''})
                </span>
              </span>
              <button
                type="button"
                onClick={() => deleteCommand.mutate(c.id)}
                disabled={deleteCommand.isPending}
                className="text-xs text-status-error hover:underline disabled:opacity-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleCreate} className="mt-3 flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col text-xs text-slate-400">
            Key
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="lens.shift.set"
              className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-400">
            Label
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Lens Shift"
              className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-400">
            Category
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-400">
            Command body
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="VXX:LSSH={p}"
              className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-slate-400">
            Parameter
            <select
              value={paramKind}
              onChange={(e) => setParamKind(e.target.value as CommandParamKind)}
              className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
            >
              {PARAM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <input type="checkbox" checked={isQuery} onChange={(e) => setIsQuery(e.target.checked)} className="accent-sky-500" />
            Query (read-only)
          </label>
          <button
            type="submit"
            disabled={createCommand.isPending || !key.trim() || !label.trim() || !body.trim()}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
          >
            Add command
          </button>
        </div>

        {paramKind === 'enum' && (
          <label className="flex flex-col text-xs text-slate-400">
            Options, one per line as <code>value=label</code>
            <textarea
              value={enumOptionsText}
              onChange={(e) => setEnumOptionsText(e.target.value)}
              rows={3}
              placeholder="1=Left&#10;2=Right"
              className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
            />
          </label>
        )}
      </form>
      {error && <p className="mt-2 text-xs text-status-error">{error}</p>}
    </section>
  );
}
