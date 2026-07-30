import { useState } from 'react';
import { ApiError } from '../lib/api';
import { useDevices, useSetDeviceCredentials } from '../hooks/useDevices';

interface DeviceCredentialsModalProps {
  deviceId: number;
  onClose: () => void;
}

/**
 * Per-device username/password override — most devices should just use the
 * global default (GlobalCredentialsForm, in Settings), but a minority run a
 * different admin account (this repo's own reference scripts use two), and
 * until now there was no UI path to set that, only the raw API.
 */
export function DeviceCredentialsModal({ deviceId, onClose }: DeviceCredentialsModalProps) {
  const { data: devices = [] } = useDevices();
  const device = devices.find((d) => d.id === deviceId);
  const setCredentials = useSetDeviceCredentials();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save(fields: { username?: string; password?: string }) {
    setError(null);
    try {
      await setCredentials.mutateAsync({ id: deviceId, ...fields });
      setUsername('');
      setPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function clearField(field: 'username' | 'password') {
    setError(null);
    try {
      await setCredentials.mutateAsync({ id: deviceId, [field]: null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  const override = device?.credentialOverride ?? { username: false, password: false };

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-medium">{device?.name ?? `Device #${deviceId}`}</h2>
            <p className="text-sm text-slate-400">Login credentials</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs text-slate-400">
                Username — {override.username ? 'custom for this device' : 'using global default'}
              </label>
              {override.username && (
                <button type="button" onClick={() => clearField('username')} className="text-xs text-sky-400 hover:underline">
                  Use global default
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="leave blank to keep current"
                className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
              />
              <button
                type="button"
                disabled={!username.trim() || setCredentials.isPending}
                onClick={() => save({ username: username.trim() })}
                className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs text-slate-400">
                Password — {override.password ? 'custom for this device' : 'using global default'}
              </label>
              {override.password && (
                <button type="button" onClick={() => clearField('password')} className="text-xs text-sky-400 hover:underline">
                  Use global default
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="leave blank to keep current"
                className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
              />
              <button
                type="button"
                disabled={!password || setCredentials.isPending}
                onClick={() => save({ password })}
                className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-status-error">{error}</p>}
      </div>
    </div>
  );
}
