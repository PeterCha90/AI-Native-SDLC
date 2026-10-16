"use client";

import { useCallback, useMemo, useState } from "react";
import { Cell, Label, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import type { PieSectorShapeProps } from "recharts/types/polar/Pie";

export interface DonutChartDatum {
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  data: DonutChartDatum[];
  total: number;
  centerLabel?: string;
  size?: number;
}

/*
 * Built on Recharts the way shadcn/ui's chart primitives are: the library
 * draws the arcs and handles the geometry; we own the tooltip, the active
 * sector shape, the centre label, and the legend.
 *
 * Interaction rules, borrowed from shadcn's "donut active" example:
 *   - hovering a sector nudges it outward by a few px, nothing else moves
 *   - the tooltip follows the cursor and carries the numbers
 *   - the centre label is fixed — it never swaps on hover
 *   - sibling sectors keep full opacity
 */

interface TooltipPayloadEntry {
  name?: string;
  value?: number;
  payload?: DonutChartDatum & { percent: number };
}

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}) {
  const entry = payload?.[0]?.payload;
  if (!active || !entry) return null;

  return (
    <div className="grid min-w-[9rem] gap-1.5 rounded-lg border border-[#e5e8ef] bg-white px-3 py-2 text-xs shadow-[0_4px_16px_rgba(16,24,40,0.10)]">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
          style={{ backgroundColor: entry.color }}
        />
        <span className="flex-1 text-[#5a6376]">{entry.label}</span>
        <span className="font-medium tabular-nums text-[#14171d]">{entry.value}건</span>
      </div>
      <div className="flex items-center gap-2 pl-[1.125rem]">
        <span className="flex-1 text-[#757d8e]">비중</span>
        <span className="tabular-nums text-[#39404e]">{(entry.percent * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}

export function DonutChart({ data, total, centerLabel, size = 220 }: DonutChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const chartData = useMemo(() => {
    const filtered = data.filter((d) => d.value > 0);
    const sum = filtered.reduce((acc, d) => acc + d.value, 0);
    return filtered
      .map((d) => ({ ...d, percent: sum > 0 ? d.value / sum : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [data]);

  // Leave a margin for the +8px hover growth and so the tooltip has space to
  // sit beside the ring rather than over the centre label.
  const outerRadius = size / 2 - 16;
  const innerRadius = Math.round(outerRadius * 0.64);

  // shadcn's active-sector renderer: only the hovered arc grows.
  const renderSector = useCallback(
    ({ index, outerRadius: r = 0, ...props }: PieSectorShapeProps) => (
      <Sector {...props} outerRadius={index === activeIndex ? r + 8 : r} />
    ),
    [activeIndex],
  );

  if (chartData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-6">
        <div
          className="rounded-full border-[22px] border-[#eaedf2]"
          style={{ width: size, height: size }}
          aria-hidden="true"
        />
        <p className="text-sm text-[#757d8e]">분석 결과가 없습니다</p>
      </div>
    );
  }

  return (
    <div className="grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)]">
      <div className="mx-auto" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              cursor={false}
              content={<DonutTooltip />}
              wrapperStyle={{ outline: "none", zIndex: 10 }}
              isAnimationActive={false}
              allowEscapeViewBox={{ x: true, y: true }}
              offset={16}
            />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={chartData.length > 1 ? 2 : 0}
              cornerRadius={4}
              stroke="#ffffff"
              strokeWidth={2}
              shape={renderSector}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              isAnimationActive
              animationBegin={0}
              animationDuration={600}
              animationEasing="ease-out"
            >
              {chartData.map((entry) => (
                <Cell key={entry.label} fill={entry.color} />
              ))}
              <Label
                content={({ viewBox }) => {
                  if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
                  const cx = viewBox.cx ?? 0;
                  const cy = viewBox.cy ?? 0;
                  return (
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                      <tspan
                        x={cx}
                        y={cy - 4}
                        className="fill-[#14171d] text-[28px] font-semibold tabular-nums"
                      >
                        {total.toLocaleString()}
                      </tspan>
                      {centerLabel && (
                        <tspan x={cx} y={cy + 20} className="fill-[#5a6376] text-[12px]">
                          {centerLabel}
                        </tspan>
                      )}
                    </text>
                  );
                }}
              />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="grid gap-1" role="list">
        {chartData.map((entry, index) => {
          const isActive = activeIndex === index;
          return (
            <li key={entry.label}>
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
                aria-label={`${entry.label} ${entry.value}건, ${(entry.percent * 100).toFixed(1)}%`}
                className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563c9] ${
                  isActive ? "bg-[#f2f4f8]" : "hover:bg-[#f8f9fb]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-[3px]"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="truncate text-[#39404e]">{entry.label}</span>
                <span className="tabular-nums text-[#14171d]">{entry.value}</span>
                <span className="w-12 text-right text-xs tabular-nums text-[#757d8e]">
                  {(entry.percent * 100).toFixed(1)}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
