import { useMemo, useState } from 'react';
import { useDevices, useDeviceTelemetry } from '../hooks/useDevices';
import { CHART_COLORS, LineChart, type ChartSeries } from './LineChart';

const RANGE_PRESETS = [
  { label: 'Last 24 hours', hours: 24 },
  { label: 'Last 7 days', hours: 24 * 7 },
  { label: 'Last 30 days', hours: 24 * 30 },
] as const;

interface AnalyticsPaneProps {
  deviceId: number;
  onClose: () => void;
}

/** Graphical representation of temperature and lamp-hour history (spec §5). */
export function AnalyticsPane({ deviceId, onClose }: AnalyticsPaneProps) {
  const { data: devices = [] } = useDevices();
  const device = devices.find((d) => d.id === deviceId);
  const [rangeHours, setRangeHours] = useState<number>(RANGE_PRESETS[0].hours);

  const since = useMemo(() => new Date(Date.now() - rangeHours * 3600_000).toISOString(), [rangeHours]);
  const { data: samples = [], isPending } = useDeviceTelemetry(deviceId, undefined, since);

  const tempSeries: ChartSeries[] = useMemo(() => {
    const intake = samples.filter((s) => s.metric === 'temp_intake').map((s) => ({ x: Date.parse(s.recordedAt), y: s.value }));
    const exhaust = samples.filter((s) => s.metric === 'temp_exhaust').map((s) => ({ x: Date.parse(s.recordedAt), y: s.value }));
    const out: ChartSeries[] = [];
    if (intake.length > 0) out.push({ key: 'intake', label: 'Intake', color: CHART_COLORS[0]!, points: intake });
    if (exhaust.length > 0) out.push({ key: 'exhaust', label: 'Exhaust', color: CHART_COLORS[1]!, points: exhaust });
    return out;
  }, [samples]);

  const voltageSeries: ChartSeries[] = useMemo(() => {
    // Number.isFinite, not just filtering by metric — a single non-finite
    // point poisons the whole chart's min/max scale (Math.min/max propagate
    // NaN across the entire array), so any already-stored bad reading from
    // before the backend's NaN-guard existed must never reach the chart.
    const points = samples
      .filter((s) => s.metric === 'ac_voltage' && Number.isFinite(s.value))
      .map((s) => ({ x: Date.parse(s.recordedAt), y: s.value }));
    return points.length > 0 ? [{ key: 'ac_voltage', label: 'AC Voltage', color: CHART_COLORS[2]!, points }] : [];
  }, [samples]);

  const lampSeries: ChartSeries[] = useMemo(() => {
    const byIdx = new Map<number, { x: number; y: number }[]>();
    for (const s of samples) {
      if (s.metric !== 'lamp_hours') continue;
      const list = byIdx.get(s.idx) ?? [];
      list.push({ x: Date.parse(s.recordedAt), y: s.value });
      byIdx.set(s.idx, list);
    }
    return [...byIdx.entries()]
      .sort(([a], [b]) => a - b)
      .map(([idx, points], i) => ({
        key: `lamp-${idx}`,
        label: byIdx.size > 1 ? `Lamp ${idx + 1}` : 'Lamp hours',
        color: CHART_COLORS[i % CHART_COLORS.length]!,
        points,
      }));
  }, [samples]);

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 pt-12" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-lg border border-slate-800 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-medium">{device?.name ?? `Device #${deviceId}`}</h2>
            <p className="text-sm text-slate-400">Temperature, lamp-hour and AC voltage history</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mb-4 flex gap-1">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.hours}
              type="button"
              onClick={() => setRangeHours(preset.hours)}
              className={`rounded-md px-3 py-1 text-xs ${
                rangeHours === preset.hours ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {isPending ? (
          <p className="text-slate-400">Loading…</p>
        ) : (
          <div className="flex flex-col gap-6">
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Temperature (°C)</h3>
              <LineChart series={tempSeries} yFormat={(v) => `${v.toFixed(0)}°`} emptyMessage="No temperature readings in this range" />
            </section>
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Lamp hours</h3>
              <LineChart series={lampSeries} yFormat={(v) => v.toFixed(0)} emptyMessage="No lamp-hour readings in this range" />
            </section>
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">AC voltage (V)</h3>
              <p className="mb-1 text-xs text-slate-500">Reported via QVX:VMOI2, not in the official command list under this name.</p>
              <LineChart series={voltageSeries} yFormat={(v) => v.toFixed(0)} emptyMessage="No voltage readings in this range" />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
