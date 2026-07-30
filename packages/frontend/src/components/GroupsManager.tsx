import { useState } from 'react';
import { ApiError } from '../lib/api';
import { useCreateGroup, useDeleteGroup, useGroups } from '../hooks/useGroups';

/**
 * Create/rename/delete groups — the "selection groups" mechanism: a named,
 * saved set of devices (device_groups) that the grid's group chips let you
 * reselect in one click, and the batch action bar lets you assign devices
 * into. This is just the CRUD side; selecting/assigning lives in
 * DeviceGrid.tsx and BatchActionBar.tsx.
 */
export function GroupsManager() {
  const { data: groups = [], isPending } = useGroups();
  const createGroup = useCreateGroup();
  const deleteGroup = useDeleteGroup();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      await createGroup.mutateAsync({ name: name.trim() });
      setName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Groups</h2>
      <p className="mt-1 text-sm text-slate-400">
        Saved sets of devices — click a group's chip above the device grid to select all of its devices at once, or
        select devices manually and assign them to a group from the batch action bar.
      </p>

      {isPending && <p className="mt-2 text-sm text-slate-400">Loading…</p>}

      {!isPending && (
        <ul className="mt-3 flex flex-col gap-1">
          {groups.length === 0 && <li className="text-sm text-slate-500">No groups yet.</li>}
          {groups.map((group) => (
            <li key={group.id} className="flex items-center justify-between rounded border border-slate-800 px-3 py-1.5 text-sm">
              <span>
                {group.name} <span className="text-slate-500">({group.deviceCount} device{group.deviceCount === 1 ? '' : 's'})</span>
              </span>
              <button
                type="button"
                onClick={() => deleteGroup.mutate(group.id)}
                disabled={deleteGroup.isPending}
                className="text-xs text-status-error hover:underline disabled:opacity-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleCreate} className="mt-3 flex items-end gap-2">
        <label className="flex flex-col text-xs text-slate-400">
          New group name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ground Floor"
            className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          />
        </label>
        <button
          type="submit"
          disabled={createGroup.isPending || !name.trim()}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
        >
          Create
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-status-error">{error}</p>}
    </section>
  );
}
