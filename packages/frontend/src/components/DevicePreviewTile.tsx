import { forwardRef, useImperativeHandle, useState } from 'react';
import { useUpdateDevice } from '../hooks/useDevices';
import { useNameVerification } from '../hooks/useNameVerification';
import { usePreviewSocket } from '../hooks/usePreviewSocket';

interface DevicePreviewTileProps {
  deviceId: number;
  host: string;
  name: string;
  enabled: boolean;
  /** Omitted in the expanded modal — opening/closing the modal is what starts/stops that instance's connection. */
  onToggle?: () => void;
  onExpand?: () => void;
}

/**
 * Imperative escape hatch for PreviewGrid's "Verify all" bulk action
 * (docs/vision-name-verification-plan.md §9/§11): lets it reuse a tile's
 * already-open connection instead of opening a redundant second one to the
 * same device (see lib/previewCapture.ts for the standalone path used when
 * no tile is open). Not attached to the expanded-modal instance — see
 * PreviewGrid.tsx — since that would collide with the grid tile's own
 * handle for the same device id.
 */
export interface DevicePreviewTileHandle {
  /** True whenever this tile has its own open preview connection, busy or not — "Verify all" must never open a second connection while this is true. */
  isConnected: () => boolean;
  /** True only when this tile's connection has a frame ready and isn't already mid-check. */
  canVerify: () => boolean;
  /** Runs this tile's own "Verify Name" flow over its already-open connection. */
  verifyName: () => Promise<void>;
  /** Sets this tile's Pre-Show mode to a specific state, if it has an open connection — used by PreviewGrid's "Pre-Show: All on/off". */
  setPreshow: (active: boolean) => void;
}

const STATUS_LABEL: Record<string, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Live',
  error: 'Connection failed',
  closed: 'Disconnected',
};

/** docs/vision-name-verification-plan.md — OCR runs client-side; the match decision and persistence are the backend's (Milestone 2). */
const NAME_CHECK_LABEL: Record<string, string> = {
  running: 'Checking…',
  match: '✓ Name matches',
  mismatch: '⚠ Name mismatch',
  error: "⚠ Couldn't read text",
};

const NAME_CHECK_CLASS: Record<string, string> = {
  running: 'text-slate-400',
  match: 'text-status-ok',
  mismatch: 'text-status-error',
  error: 'text-status-warning',
};

/** One device's live preview — the projector's own image, streamed over its undocumented preview WebSocket (see usePreviewSocket). Reused at thumbnail size (grid, via `onExpand`) and full size (expanded modal, without it). */
export const DevicePreviewTile = forwardRef<DevicePreviewTileHandle, DevicePreviewTileProps>(function DevicePreviewTile(
  { deviceId, host, name, enabled, onToggle, onExpand },
  ref,
) {
  const preview = usePreviewSocket(host, enabled);
  const nameCheck = useNameVerification();
  const updateDevice = useUpdateDevice();
  const canExpand = Boolean(onExpand) && preview.status === 'connected';
  // imageUrl and the frame captureFrame() would return are set together in
  // usePreviewSocket, so this doubles as "is there a frame to check right now".
  const canVerifyName = preview.status === 'connected' && preview.imageUrl !== null && nameCheck.runState !== 'running';

  async function verifyNow(): Promise<void> {
    const frame = preview.captureFrame();
    if (frame) await nameCheck.verify(deviceId, frame);
  }

  useImperativeHandle(ref, () => ({
    isConnected: () => preview.status === 'connected',
    canVerify: () => canVerifyName,
    verifyName: verifyNow,
    setPreshow: preview.setPreshow,
  }));

  // Milestone 3 (docs/vision-name-verification-plan.md §11): edit the name
  // right where a mismatch is discovered, rather than needing the Devices
  // tab — requested from real-hardware testing of "Verify Name".
  const [isRenaming, setIsRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);

  function startRename() {
    setNameDraft(name);
    setIsRenaming(true);
  }

  function cancelRename() {
    setIsRenaming(false);
  }

  function saveRename() {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== name) {
      updateDevice.mutate({ id: deviceId, input: { name: trimmed } });
      nameCheck.reset();
    }
    setIsRenaming(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        {isRenaming ? (
          <div className="flex flex-1 items-center gap-1">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRename();
                if (e.key === 'Escape') cancelRename();
              }}
              className="w-full min-w-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-sm font-medium text-slate-100"
            />
            <button
              type="button"
              onClick={saveRename}
              disabled={!nameDraft.trim() || updateDevice.isPending}
              className="shrink-0 text-xs text-sky-400 hover:underline disabled:opacity-50"
              aria-label="Save name"
            >
              Save
            </button>
            <button
              type="button"
              onClick={cancelRename}
              className="shrink-0 text-xs text-slate-400 hover:underline"
              aria-label="Cancel rename"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startRename}
            title="Rename this device"
            className="truncate text-left text-sm font-medium hover:underline"
          >
            {name}
          </button>
        )}
        <span className="whitespace-nowrap text-xs text-slate-400">{STATUS_LABEL[preview.status]}</span>
      </div>

      <button
        type="button"
        onClick={onExpand}
        disabled={!canExpand}
        title={canExpand ? 'Expand' : undefined}
        className="flex aspect-video w-full items-center justify-center overflow-hidden rounded bg-black disabled:cursor-default"
      >
        {preview.imageUrl ? (
          <img src={preview.imageUrl} alt={`${name} live preview`} className="h-full w-full object-contain" />
        ) : preview.hdcp ? (
          <span className="px-2 text-center text-xs text-slate-400">HDCP-protected content</span>
        ) : (
          <span className="px-2 text-center text-xs text-slate-600">
            {enabled ? (preview.status === 'error' ? 'Preview unavailable' : '…') : 'Preview off'}
          </span>
        )}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700"
            >
              {enabled ? 'Stop' : 'Start'}
            </button>
          )}
          {enabled && (preview.status === 'error' || preview.status === 'closed') && (
            <button type="button" onClick={preview.reconnect} className="text-xs text-status-error hover:underline">
              Reconnect
            </button>
          )}
        </div>
        {preview.status === 'connected' && (
          <button
            type="button"
            onClick={preview.togglePreshow}
            disabled={preview.preshowBusy}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700 disabled:opacity-50"
          >
            {preview.preshowBusy ? 'Pre-Show…' : preview.preshowActive ? 'Pre-Show: On' : 'Pre-Show: Off'}
          </button>
        )}
      </div>

      {preview.status === 'connected' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
          <button
            type="button"
            onClick={() => void verifyNow()}
            disabled={!canVerifyName}
            title="Runs OCR on the current frame and checks it against this device's configured name"
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700 disabled:opacity-50"
          >
            {nameCheck.runState === 'running' ? 'Checking…' : 'Verify Name'}
          </button>
          {nameCheck.runState !== 'idle' && nameCheck.runState !== 'running' && (
            <span
              className={`truncate text-xs ${NAME_CHECK_CLASS[nameCheck.runState] ?? 'text-slate-400'}`}
              title={nameCheck.detectedText ? `Detected: "${nameCheck.detectedText.trim()}"` : nameCheck.error ?? undefined}
            >
              {NAME_CHECK_LABEL[nameCheck.runState] ?? nameCheck.runState}
            </span>
          )}
        </div>
      )}
    </div>
  );
});
