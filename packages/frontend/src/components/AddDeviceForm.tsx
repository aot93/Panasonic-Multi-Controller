import { useState } from 'react';
import { useCreateDevice } from '../hooks/useDevices';

/**
 * A minimal way to get a device into the grid at all. Not explicitly called
 * out in the phase 6 brief (grid/batch bar/macro builder/analytics), but the
 * grid view is useless without some UI path to register a device — the
 * alternative (curl or the phase-3 CLI helper) isn't a real option for the
 * AV technicians this app is for.
 */
export function AddDeviceForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const createDevice = useCreateDevice();

  function reset() {
    setName('');
    setHost('');
    setPort('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !host.trim()) return;
    await createDevice.mutateAsync({
      name: name.trim(),
      host: host.trim(),
      port: port.trim() ? Number(port.trim()) : undefined,
    });
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800"
      >
        + Add device
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-2 rounded-md border border-slate-700 bg-slate-900 p-3"
    >
      <label className="flex flex-col text-xs text-slate-400">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Foyer"
          required
          className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
        />
      </label>
      <label className="flex flex-col text-xs text-slate-400">
        Host
        <input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="192.168.0.131"
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
        disabled={createDevice.isPending}
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
      >
        {createDevice.isPending ? 'Adding…' : 'Add'}
      </button>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(false);
        }}
        className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        Cancel
      </button>
      {createDevice.isError && <p className="w-full text-xs text-status-error">{createDevice.error.message}</p>}
    </form>
  );
}
