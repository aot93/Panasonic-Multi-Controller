import { useRef } from 'react';
import type { DeviceWithState, GroupWithCount } from '@ppc/shared';
import { AddDeviceForm } from './AddDeviceForm';
import { BulkAddDevicesForm } from './BulkAddDevicesForm';
import { DeviceCard } from './DeviceCard';

interface DeviceGridProps {
  devices: DeviceWithState[];
  groups: GroupWithCount[];
  selectedIds: Set<number>;
  onToggleSelected: (deviceId: number) => void;
  onSelectIds: (deviceIds: number[]) => void;
  onOpenAnalytics: (deviceId: number) => void;
  onOpenCredentials: (deviceId: number) => void;
  activeGroupId: number | null;
  onSetActiveGroupId: (groupId: number | null) => void;
}

/** Thumbnail-style cards for every projector with color-coded status indicators (spec §5). */
export function DeviceGrid({
  devices,
  groups,
  selectedIds,
  onToggleSelected,
  onSelectIds,
  onOpenAnalytics,
  onOpenCredentials,
  activeGroupId,
  onSetActiveGroupId,
}: DeviceGridProps) {
  // Selecting a group both filters the grid down to its members and selects
  // them — NextSteps.md phase 1 item 6 ("hide devices not in selection group
  // when group is selected"), layered onto the existing "click a group chip
  // to select its members" behaviour rather than replacing it.
  const visibleDevices = activeGroupId === null ? devices : devices.filter((d) => d.groupIds.includes(activeGroupId));
  const allSelected = visibleDevices.length > 0 && selectedIds.size === visibleDevices.length;

  // Shift-click range select: the anchor is whichever card was last clicked
  // WITHOUT shift, and stays put across repeated shift-clicks (so
  // shift-clicking a second, then a third card re-measures the range from
  // the same anchor each time, standard file-manager behaviour) — reset by
  // any plain click, and otherwise left alone by every other selection path
  // (group chips, Select/Deselect all) since those don't go through this.
  const lastClickedIdRef = useRef<number | null>(null);

  function handleCardToggle(deviceId: number, shiftKey: boolean) {
    const anchorId = lastClickedIdRef.current;
    if (shiftKey && anchorId !== null) {
      const ids = visibleDevices.map((d) => d.id);
      const anchorIndex = ids.indexOf(anchorId);
      const targetIndex = ids.indexOf(deviceId);
      if (anchorIndex !== -1 && targetIndex !== -1) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        onSelectIds(ids.slice(start, end + 1));
        return;
      }
    }
    lastClickedIdRef.current = deviceId;
    onToggleSelected(deviceId);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
          Devices {visibleDevices.length > 0 && `(${visibleDevices.length}${activeGroupId !== null ? ` of ${devices.length}` : ''})`}
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSelectIds(allSelected ? [] : visibleDevices.map((d) => d.id))}
            disabled={visibleDevices.length === 0}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          <AddDeviceForm />
          <BulkAddDevicesForm />
        </div>
      </div>

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Groups:</span>
          {groups.map((group) => {
            const memberIds = devices.filter((d) => d.groupIds.includes(group.id)).map((d) => d.id);
            const isActive = activeGroupId === group.id;
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => {
                  if (isActive) {
                    onSetActiveGroupId(null);
                    onSelectIds([]);
                  } else {
                    onSetActiveGroupId(group.id);
                    onSelectIds(memberIds);
                  }
                }}
                title={`Show and select the ${memberIds.length} device(s) in "${group.name}"`}
                className={`rounded-full border px-3 py-1 text-xs ${
                  isActive
                    ? 'border-violet-500 bg-violet-950/40 text-violet-200'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {group.name} ({group.deviceCount})
              </button>
            );
          })}
        </div>
      )}

      {visibleDevices.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-800 p-8 text-center text-slate-500">
          {devices.length === 0 ? 'No devices registered yet. Add one to get started.' : 'No devices in this group.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleDevices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              selected={selectedIds.has(device.id)}
              onToggleSelected={handleCardToggle}
              onOpenAnalytics={onOpenAnalytics}
              onOpenCredentials={onOpenCredentials}
            />
          ))}
        </div>
      )}
    </div>
  );
}
