import { useMemo, useState } from 'react';

export interface ChartSeries {
  key: string;
  label: string;
  /** One of the fixed categorical hex steps — see CHART_COLORS below. Assigned by slot order, never cycled per-render. */
  color: string;
  points: { x: number; y: number }[];
}

interface LineChartProps {
  series: ChartSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  emptyMessage?: string;
}

const WIDTH = 640;
const PAD = { top: 12, right: 16, bottom: 26, left: 44 };
const GRIDLINE = '#2c2c2a'; // one step off the slate-950 surface, dark-mode hairline per dataviz skill
const MUTED = '#898781';
const SURFACE = '#0f172a'; // matches Tailwind slate-950, used for marker rings

/**
 * A minimal but spec-following line chart (see the dataviz skill): 2px lines,
 * ≥8px end markers with a surface-color ring, a crosshair + single shared
 * tooltip for every series at the nearest X, a legend whenever there's more
 * than one series, and recessive hairline gridlines. Built once and reused
 * for both the temperature and lamp-hours charts rather than duplicating
 * SVG/scale math per chart.
 */
export function LineChart({ series, height = 220, yFormat = String, xFormat, emptyMessage = 'No data yet' }: LineChartProps) {
  const [hoverPx, setHoverPx] = useState<number | null>(null);

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = height - PAD.top - PAD.bottom;

  const allPoints = series.flatMap((s) => s.points);
  const hasData = allPoints.length > 0;

  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    if (!hasData) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    const xs = allPoints.map((p) => p.x);
    const ys = allPoints.map((p) => p.y);
    const rawYMin = Math.min(...ys);
    const rawYMax = Math.max(...ys);
    const yPad = (rawYMax - rawYMin) * 0.1 || 1;
    return {
      xMin: Math.min(...xs),
      xMax: Math.max(...xs) || 1,
      yMin: rawYMin - yPad,
      yMax: rawYMax + yPad,
    };
  }, [allPoints, hasData]);

  const scaleX = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * plotWidth;
  const scaleY = (y: number) => PAD.top + plotHeight - ((y - yMin) / (yMax - yMin || 1)) * plotHeight;

  const formatX = xFormat ?? ((v: number) => new Date(v).toLocaleDateString());

  // Nearest data point per series to the hovered pixel X, for the shared tooltip.
  const hoverData =
    hoverPx === null
      ? null
      : (() => {
          const hoverTime = xMin + ((hoverPx - PAD.left) / plotWidth) * (xMax - xMin);
          const rows = series
            .map((s) => {
              if (s.points.length === 0) return null;
              let nearest = s.points[0]!;
              let bestDist = Math.abs(nearest.x - hoverTime);
              for (const p of s.points) {
                const dist = Math.abs(p.x - hoverTime);
                if (dist < bestDist) {
                  nearest = p;
                  bestDist = dist;
                }
              }
              return { series: s, point: nearest };
            })
            .filter((r): r is { series: ChartSeries; point: { x: number; y: number } } => r !== null);
          return rows.length > 0 ? { time: rows[0]!.point.x, rows } : null;
        })();

  const yTicks = useMemo(() => {
    if (!hasData) return [];
    const count = 4;
    return Array.from({ length: count + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / count);
  }, [hasData, yMin, yMax]);

  if (!hasData) {
    return (
      <div className="flex items-center justify-center rounded border border-dashed border-slate-800 text-sm text-slate-500" style={{ height }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div>
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-300">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}

      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        role="img"
        aria-label={series.map((s) => s.label).join(', ')}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * WIDTH;
          setHoverPx(Math.max(PAD.left, Math.min(WIDTH - PAD.right, px)));
        }}
        onMouseLeave={() => setHoverPx(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={scaleY(t)} y2={scaleY(t)} stroke={GRIDLINE} strokeWidth={1} />
            <text x={PAD.left - 8} y={scaleY(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={MUTED}>
              {yFormat(t)}
            </text>
          </g>
        ))}

        {series.map((s) => {
          if (s.points.length === 0) return null;
          const sorted = [...s.points].sort((a, b) => a.x - b.x);
          const path = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(p.x)} ${scaleY(p.y)}`).join(' ');
          const last = sorted[sorted.length - 1]!;
          return (
            <g key={s.key}>
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={scaleX(last.x)} cy={scaleY(last.y)} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />
            </g>
          );
        })}

        {hoverData && (
          <line
            x1={scaleX(hoverData.time)}
            x2={scaleX(hoverData.time)}
            y1={PAD.top}
            y2={PAD.top + plotHeight}
            stroke={MUTED}
            strokeWidth={1}
            strokeDasharray="2,2"
          />
        )}
      </svg>

      {hoverData && (
        <div className="mt-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs">
          <div className="mb-1 text-slate-400">{formatX(hoverData.time)}</div>
          {hoverData.rows.map(({ series: s, point }) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: s.color }} />
              <span className="font-medium">{yFormat(point.y)}</span>
              <span className="text-slate-400">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Fixed categorical order — dark-mode steps from the validated default palette. Assign by slot index, never cycle. */
export const CHART_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
