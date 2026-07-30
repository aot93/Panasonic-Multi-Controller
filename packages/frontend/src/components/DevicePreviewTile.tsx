import { usePreviewSocket } from '../hooks/usePreviewSocket';

interface DevicePreviewTileProps {
  host: string;
  name: string;
  enabled: boolean;
  /** Omitted in the expanded modal — opening/closing the modal is what starts/stops that instance's connection. */
  onToggle?: () => void;
  onExpand?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Live',
  error: 'Connection failed',
  closed: 'Disconnected',
};

/** One device's live preview — the projector's own image, streamed over its undocumented preview WebSocket (see usePreviewSocket). Reused at thumbnail size (grid, via `onExpand`) and full size (expanded modal, without it). */
export function DevicePreviewTile({ host, name, enabled, onToggle, onExpand }: DevicePreviewTileProps) {
  const preview = usePreviewSocket(host, enabled);
  const canExpand = Boolean(onExpand) && preview.status === 'connected';

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{name}</span>
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
    </div>
  );
}
