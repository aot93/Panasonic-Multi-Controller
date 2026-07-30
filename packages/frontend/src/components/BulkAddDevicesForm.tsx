import { useState } from 'react';
import type { BulkCreateDeviceResult } from '@ppc/shared';
import { ApiError } from '../lib/api';
import { useBulkCreateDevices } from '../hooks/useDevices';

/** Add multiple devices at once from an IP range, e.g. 192.168.1.10-192.168.1.20 — for racking up a whole room in one pass instead of one-at-a-time. */
export function BulkAddDevicesForm() {
  const [open, setOpen] = useState(false);
  const [namePrefix, setNamePrefix] = useState('');
  const [startIp, setStartIp] = useState('');
  const [endIp, setEndIp] = useState('');
  const [port, setPort] = useState('');
  const [results, setResults] = useState<BulkCreateDeviceResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bulkCreate = useBulkCreateDevices();

  function reset() {
    setNamePrefix('');
    setStartIp('');
    setEndIp('');
    setPort('');
    setResults(null);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startIp.trim() || !endIp.trim()) return;
    setError(null);
    setResults(null);
    try {
      const res = await bulkCreate.mutateAsync({
        namePrefix: namePrefix.trim() || null,
        startIp: startIp.trim(),
        endIp: endIp.trim(),
        port: port.trim() ? Number(port.trim()) : undefined,
      });
      setResults(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800"
      >
        + Add range
      </button>
    );
  }

  const succeeded = results?.filter((r) => r.ok).length ?? 0;
  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-2 rounded-md border border-slate-700 bg-slate-900 p-3"
    >
      <label className="flex flex-col text-xs text-slate-400">
        Name prefix (optional)
        <input
          value={namePrefix}
          onChange={(e) => setNamePrefix(e.target.value)}
          placeholder="Room"
          className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
        />
      </label>
      <label className="flex flex-col text-xs text-slate-400">
        Start IP
        <input
          value={startIp}
          onChange={(e) => setStartIp(e.target.value)}
          placeholder="192.168.0.10"
          required
          className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
        />
      </label>
      <label className="flex flex-col text-xs text-slate-400">
        End IP
        <input
          value={endIp}
          onChange={(e) => setEndIp(e.target.value)}
          placeholder="192.168.0.20"
          required
          className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
        />
      </label>
      <label className="flex flex-col text-xs text-slate-400">
        Port
        <input
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder="1024"
          inputMode="numeric"
          className="mt-1 w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
        />
      </label>
      <button
        type="submit"
        disabled={bulkCreate.isPending}
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
      >
        {bulkCreate.isPending ? 'Adding…' : 'Add range'}
      </button>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(false);
        }}
        className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        Close
      </button>

      {error && <p className="w-full text-xs text-status-error">{error}</p>}
      {results && (
        <p className="w-full text-xs text-slate-300">
          {succeeded}/{results.length} added.
          {failed.length > 0 && (
            <>
              {' '}
              Failed: {failed.map((f) => `${f.ip} (${f.error})`).join(', ')}
            </>
          )}
        </p>
      )}
    </form>
  );
}
