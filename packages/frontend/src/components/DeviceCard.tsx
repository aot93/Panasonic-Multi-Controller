import { useRef, useState } from 'react';
import { ASPECT_OPTIONS, INPUT_OPTIONS, SCREEN_SETTING_OPTIONS } from '@ppc/shared';
import type { DeviceWithState } from '@ppc/shared';
import { useDeleteDevice, useUpdateDevice } from '../hooks/useDevices';
import { StatusDot } from './StatusDot';

const POWER_LABEL: Record<string, string> = {
  on: 'On',
  off: 'Off',
  warming: 'Warming up',
  cooling: 'Cooling down',
  unknown: 'Unknown',
};

const HEALTH_LABEL: Record<string, string> = {
  ok: 'OK',
  warning: 'Warning',
  error: 'Error',
  unreachable: 'Unreachable',
  unknown: 'Unknown',
};

/** docs/vision-name-verification-plan.md §9 — badge next to the name once a device has ever had "Verify Name" run against it (Preview tab). */
const NAME_VERIFICATION_BADGE: Record<string, { label: string; className: string }> = {
  match: { label: '✓ Name', className: 'text-status-ok' },
  mismatch: { label: '⚠ Name mismatch', className: 'text-status-error' },
  error: { label: '⚠ Name unverified', className: 'text-status-warning' },
};

const inputLabel = (value: string) => INPUT_OPTIONS.find((o) => o.value === value)?.label ?? value;
const aspectLabel = (value: string) => ASPECT_OPTIONS.find((o) => o.value === value)?.label ?? value;
const screenLabel = (value: string) => SCREEN_SETTING_OPTIONS.find((o) => o.value === value)?.label ?? value;

interface DeviceCardProps {
  device: DeviceWithState;
  selected: boolean;
  /** `shiftKey` lets the caller (DeviceGrid) select the whole range between this card and the last one clicked, instead of just toggling this one. */
  onToggleSelected: (deviceId: number, shiftKey: boolean) => void;
  onOpenAnalytics: (deviceId: number) => void;
  onOpenCredentials: (deviceId: number) => void;
}

export function DeviceCard({ device, selected, onToggleSelected, onOpenAnalytics, onOpenCredentials }: DeviceCardProps) {
  const state = device.state;
  const health = state?.health ?? 'unknown';
  const deleteDevice = useDeleteDevice();
  const updateDevice = useUpdateDevice();

  const [isRenaming, setIsRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(device.name);

  // Shift-click range select (DeviceGrid.tsx) needs to know whether shift
  // was held for this click, but reading it here — rather than intercepting
  // onClick with preventDefault — lets the checkbox keep its native,
  // instantly-painted toggle for the common case. mousedown fires before
  // click/change and doesn't touch the checkbox's default behaviour at all.
  const shiftHeldRef = useRef(false);

  function handleDelete() {
    if (!window.confirm(`Remove "${device.name}" from the application? This cannot be undone.`)) return;
    deleteDevice.mutate(device.id);
  }

  function startRename() {
    setNameDraft(device.name);
    setIsRenaming(true);
  }

  function cancelRename() {
    setIsRenaming(false);
  }

  function saveRename() {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== device.name) {
      updateDevice.mutate({ id: device.id, input: { name: trimmed } });
    }
    setIsRenaming(false);
  }

  // NextSteps.md phase 3 item 1: double-click (or the icon button) opens the
  // projector's own built-in web interface — a separate login from NTCONTROL,
  // not something this app manages, so a plain new tab is all that's needed.
  function openWebInterface() {
    window.open(`http://${device.host}/`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div
      className={`relative flex flex-col gap-2 rounded-lg border p-4 transition-colors ${
        selected ? 'border-sky-500 bg-sky-950/30' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
      }`}
    >
      <label className="absolute right-3 top-3 flex cursor-pointer items-center">
        <input
          type="checkbox"
          checked={selected}
          onMouseDown={(e) => {
            shiftHeldRef.current = e.shiftKey;
          }}
          onChange={() => onToggleSelected(device.id, shiftHeldRef.current)}
          className="h-4 w-4 rounded border-slate-600 bg-slate-800 accent-sky-500"
          aria-label={`Select ${device.name}`}
        />
      </label>

      {isRenaming ? (
        <div className="flex items-start gap-2 pr-6">
          <StatusDot health={health} className="mt-1.5" />
          <div className="flex flex-1 items-center gap-1">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRename();
                if (e.key === 'Escape') cancelRename();
              }}
              className="w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-sm font-medium text-slate-100"
            />
            <button
              type="button"
              onClick={saveRename}
              disabled={!nameDraft.trim() || updateDevice.isPending}
              className="text-xs text-sky-400 hover:underline disabled:opacity-50"
              aria-label="Save name"
            >
              Save
            </button>
            <button type="button" onClick={cancelRename} className="text-xs text-slate-400 hover:underline" aria-label="Cancel rename">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 pr-6">
          <button
            type="button"
            onClick={() => onOpenAnalytics(device.id)}
            onDoubleClick={openWebInterface}
            className="flex flex-1 items-start gap-2 text-left"
            title="Click: temperature and lamp-hour history. Double-click: open the projector's own web interface."
          >
            <StatusDot health={health} className="mt-1.5" />
            <div>
              <div className="font-medium leading-tight">{device.name}</div>
              {device.location && <div className="text-xs text-slate-400">{device.location}</div>}
            </div>
          </button>
          <button
            type="button"
            onClick={openWebInterface}
            className="shrink-0 text-xs text-slate-500 hover:text-slate-300"
            title="Open the projector's own web interface"
            aria-label={`Open ${device.name}'s web interface`}
          >
            ↗
          </button>
          <button
            type="button"
            onClick={startRename}
            className="shrink-0 text-xs text-slate-500 hover:text-slate-300"
            title="Rename"
            aria-label={`Rename ${device.name}`}
          >
            ✎
          </button>
        </div>
      )}

      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-400">Power</dt>
        <dd>{state ? (POWER_LABEL[state.power] ?? state.power) : '—'}</dd>

        <dt className="text-slate-400">Status</dt>
        <dd>{HEALTH_LABEL[health] ?? health}</dd>

        <dt className="text-slate-400">Input</dt>
        <dd>{state?.input ? inputLabel(state.input) : '—'}</dd>

        <dt className="text-slate-400">Shutter</dt>
        <dd>{state?.shutter === null || state?.shutter === undefined ? '—' : state.shutter ? 'Closed' : 'Open'}</dd>

        <dt className="text-slate-400">Aspect ratio</dt>
        <dd>{state?.aspect ? aspectLabel(state.aspect) : '—'}</dd>

        <dt className="text-slate-400">Screen setting</dt>
        <dd>{state?.screenSetting ? screenLabel(state.screenSetting) : '—'}</dd>
      </dl>

      {state?.lastError && (
        <p className="mt-1 truncate text-xs text-status-error" title={state.lastError}>
          {state.lastError}
        </p>
      )}

      {state?.selfDiagnosis && (
        <p
          className={`mt-1 truncate text-xs ${health === 'error' ? 'text-status-error' : health === 'warning' ? 'text-status-warning' : 'text-slate-400'}`}
          title={state.selfDiagnosis}
        >
          {state.selfDiagnosis}
        </p>
      )}

      {device.nameVerification && (
        <p
          className={`mt-1 truncate text-xs ${NAME_VERIFICATION_BADGE[device.nameVerification.status]?.className ?? 'text-slate-400'}`}
          title={
            device.nameVerification.detectedText
              ? `Detected: "${device.nameVerification.detectedText.trim()}" (checked ${new Date(device.nameVerification.checkedAt).toLocaleString()})`
              : `Checked ${new Date(device.nameVerification.checkedAt).toLocaleString()}, nothing legible detected`
          }
        >
          {NAME_VERIFICATION_BADGE[device.nameVerification.status]?.label ?? device.nameVerification.status}
        </p>
      )}

      <div className="mt-1 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpenCredentials(device.id)}
          className="text-xs text-slate-400 hover:text-slate-200 hover:underline"
        >
          {device.credentialOverride.username || device.credentialOverride.password ? 'Custom login' : 'Login (using global default)'}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleteDevice.isPending}
          className="text-xs text-status-error hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
