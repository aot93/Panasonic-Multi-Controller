import { useState } from 'react';
import { ApiError } from '../lib/api';
import { useClearGlobalCredentials, useGlobalCredentials, useSetGlobalCredentials } from '../hooks/useSettings';

/**
 * The global default projector username/password most of the fleet shares
 * (per-device overrides, for the minority that differ, live on each
 * device's card instead — see DeviceCredentialsForm). Write-only: the
 * password is never fetched back, only whether one is configured.
 */
export function GlobalCredentialsForm() {
  const { data: status, isPending } = useGlobalCredentials();
  const setCredentials = useSetGlobalCredentials();
  const clearCredentials = useClearGlobalCredentials();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) return;
    try {
      await setCredentials.mutateAsync({ username: username.trim(), password });
      setPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Global default credentials</h2>
      <p className="mt-1 text-sm text-slate-400">
        Used for any device that doesn't have its own username/password set. A device's card can still override just
        one of these two fields.
      </p>

      {!isPending && (
        <p className="mt-2 text-sm">
          {status?.configured ? (
            <>
              Currently configured — username: <span className="font-medium">{status.username}</span>
            </>
          ) : (
            <span className="text-slate-400">Not configured yet.</span>
          )}
        </p>
      )}

      <form onSubmit={handleSave} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-slate-400">
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin1"
            className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          />
        </label>
        <label className="flex flex-col text-xs text-slate-400">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          />
        </label>
        <button
          type="submit"
          disabled={setCredentials.isPending || !username.trim() || !password}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
        >
          {setCredentials.isPending ? 'Saving…' : 'Save'}
        </button>
        {status?.configured && (
          <button
            type="button"
            onClick={() => clearCredentials.mutate()}
            disabled={clearCredentials.isPending}
            className="rounded-md px-3 py-1.5 text-sm text-status-error hover:underline disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </form>
      {error && <p className="mt-2 text-xs text-status-error">{error}</p>}
    </section>
  );
}
