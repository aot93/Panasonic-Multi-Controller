import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DeviceWithState } from '@ppc/shared';
import { devicesApi } from '../lib/api';
import { runNameVerification } from '../lib/nameVerification';
import { captureOnePreviewFrame } from '../lib/previewCapture';
import { queryKeys } from '../lib/queryKeys';
import { useDevices } from '../hooks/useDevices';
import { useGroups } from '../hooks/useGroups';
import { DevicePreviewTile, type DevicePreviewTileHandle } from './DevicePreviewTile';

/**
 * NextSteps.md phase 2: live preview of each projector's actual projected
 * image — thumbnail multiview here, a larger single view via the expand
 * modal. Talks to each device directly from the browser over its own
 * undocumented preview WebSocket (see hooks/usePreviewSocket.ts); no backend
 * involvement, since the protocol needs no NTCONTROL credentials and the
 * browser already has direct LAN access to every projector.
 *
 * Nothing here auto-connects. A thumbnail per enabled device times a
 * persistent binary-streaming connection each is a materially heavier load
 * than anything else in this app (see docs/PROGRESS.md's Phase 2 write-up),
 * so starting a preview — one at a time, or all at once — is always an
 * explicit click.
 *
 * Group chips mirror DeviceGrid's: selecting one hides every device not in
 * it, same as the Devices tab (NextSteps.md phase 1 item 6) — its own local
 * `activeGroupId`, not shared with the Devices tab's, since this component
 * already manages its own independent selection-like state.
 */
export function PreviewGrid() {
  const { data: devices = [] } = useDevices();
  const { data: groups = [] } = useGroups();
  const queryClient = useQueryClient();
  const [enabledIds, setEnabledIds] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [bulkVerifyProgress, setBulkVerifyProgress] = useState<{ done: number; total: number } | null>(null);
  // Grid-tile handles only, keyed by device id — never the expanded modal's
  // instance (see its DevicePreviewTile below), which would collide with
  // the same device's grid-tile entry here.
  const tileHandles = useRef(new Map<number, DevicePreviewTileHandle>());

  const enabledDevices = devices.filter((d) => d.enabled);
  const visibleDevices =
    activeGroupId === null ? enabledDevices : enabledDevices.filter((d) => d.groupIds.includes(activeGroupId));

  function toggle(id: number) {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const expandedDevice = enabledDevices.find((d) => d.id === expandedId) ?? null;

  /**
   * Post-v1 feedback: "Pre-show" all on/off buttons. Sets every visible
   * tile's Pre-Show mode to the same explicit state rather than toggling
   * (a toggle would leave tiles in whatever state they each already had) —
   * a no-op for any tile with no open connection (DevicePreviewTileHandle.
   * setPreshow guards on that itself, same as the per-tile button only
   * appearing once connected).
   */
  function setPreshowAll(active: boolean) {
    for (const device of visibleDevices) {
      tileHandles.current.get(device.id)?.setPreshow(active);
    }
  }

  /**
   * "Verify all" (docs/vision-name-verification-plan.md §9/§11) — sequential,
   * not parallel, and never opens a second connection to a device whose
   * tile already has one open (see DevicePreviewTileHandle.isConnected and
   * lib/previewCapture.ts's own doc comment for why). One device's failure
   * doesn't stop the rest of the batch.
   */
  async function verifyAll() {
    setBulkVerifyProgress({ done: 0, total: visibleDevices.length });
    for (let i = 0; i < visibleDevices.length; i++) {
      const device: DeviceWithState = visibleDevices[i]!;
      try {
        const handle = tileHandles.current.get(device.id);
        if (handle?.isConnected()) {
          if (handle.canVerify()) await handle.verifyName();
          // else: already mid-check on its own (e.g. a manual click) —
          // skip rather than race it or open a second connection.
        } else {
          const frame = await captureOnePreviewFrame(device.host);
          if (frame) await runNameVerification(device.id, frame);
          else await devicesApi.verifyName(device.id, { detectedText: null });
          await queryClient.invalidateQueries({ queryKey: queryKeys.devices });
        }
      } catch (err) {
        console.error(`[preview] "Verify all" failed for device ${device.id}:`, err);
      }
      setBulkVerifyProgress({ done: i + 1, total: visibleDevices.length });
    }
    setBulkVerifyProgress(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
          Live preview{' '}
          {visibleDevices.length > 0 &&
            `(${visibleDevices.filter((d) => enabledIds.has(d.id)).length}/${visibleDevices.length} connected${
              activeGroupId !== null ? `, ${enabledDevices.length} total` : ''
            })`}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEnabledIds((prev) => new Set([...prev, ...visibleDevices.map((d) => d.id)]))}
            disabled={visibleDevices.length === 0}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            Start all
          </button>
          <button
            type="button"
            onClick={() =>
              setEnabledIds((prev) => {
                const visibleIds = new Set(visibleDevices.map((d) => d.id));
                return new Set([...prev].filter((id) => !visibleIds.has(id)));
              })
            }
            disabled={visibleDevices.every((d) => !enabledIds.has(d.id))}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            Stop all
          </button>
          <button
            type="button"
            onClick={() => setPreshowAll(true)}
            disabled={visibleDevices.every((d) => !enabledIds.has(d.id))}
            title="Turns Pre-Show mode on for every connected preview"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            Pre-Show: All on
          </button>
          <button
            type="button"
            onClick={() => setPreshowAll(false)}
            disabled={visibleDevices.every((d) => !enabledIds.has(d.id))}
            title="Turns Pre-Show mode off for every connected preview"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            Pre-Show: All off
          </button>
          <button
            type="button"
            onClick={() => void verifyAll()}
            disabled={visibleDevices.length === 0 || bulkVerifyProgress !== null}
            title="Checks every visible device's configured name against its live preview, one at a time"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {bulkVerifyProgress ? `Verifying ${bulkVerifyProgress.done}/${bulkVerifyProgress.total}…` : 'Verify all'}
          </button>
        </div>
      </div>

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Groups:</span>
          {groups.map((group) => {
            const memberCount = enabledDevices.filter((d) => d.groupIds.includes(group.id)).length;
            const isActive = activeGroupId === group.id;
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => setActiveGroupId(isActive ? null : group.id)}
                title={`Show only the ${memberCount} device(s) in "${group.name}"`}
                className={`rounded-full border px-3 py-1 text-xs ${
                  isActive
                    ? 'border-violet-500 bg-violet-950/40 text-violet-200'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {group.name} ({memberCount})
              </button>
            );
          })}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Uses the projector's own undocumented preview interface, reverse-engineered from its web UI — not the
        NTCONTROL protocol, so results may vary by model/firmware. Each connected preview is a persistent connection
        directly from this browser to that projector on port 8080.
      </p>

      {visibleDevices.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-800 p-8 text-center text-slate-500">
          {enabledDevices.length === 0 ? 'No enabled devices registered yet.' : 'No devices in this group.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleDevices.map((device) => (
            <DevicePreviewTile
              key={device.id}
              ref={(handle) => {
                if (handle) tileHandles.current.set(device.id, handle);
                else tileHandles.current.delete(device.id);
              }}
              deviceId={device.id}
              host={device.host}
              name={device.name}
              enabled={enabledIds.has(device.id) && expandedId !== device.id}
              onToggle={() => toggle(device.id)}
              onExpand={() => setExpandedId(device.id)}
            />
          ))}
        </div>
      )}

      {expandedDevice && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/80 p-4"
          onClick={() => setExpandedId(null)}
        >
          <div className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-lg font-medium text-slate-100">{expandedDevice.name}</h3>
              <button
                type="button"
                onClick={() => setExpandedId(null)}
                className="text-slate-400 hover:text-slate-200"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <DevicePreviewTile deviceId={expandedDevice.id} host={expandedDevice.host} name={expandedDevice.name} enabled />
          </div>
        </div>
      )}
    </div>
  );
}
