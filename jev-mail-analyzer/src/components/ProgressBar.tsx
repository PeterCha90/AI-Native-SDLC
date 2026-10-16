"use client";

export interface ProgressBarProps {
  value: number;
  total: number;
  label?: string;
  sublabel?: string;
  tone?: "accent" | "danger";
  active?: boolean;
}

/**
 * Determinate progress bar with a live sheen while `active`.
 * Handles total === 0 gracefully (renders an empty track, no NaN%).
 */
export function ProgressBar({ value, total, label, sublabel, tone = "accent", active = false }: ProgressBarProps) {
  const safeTotal = total > 0 ? total : 0;
  const safeValue = safeTotal > 0 ? Math.min(Math.max(value, 0), safeTotal) : 0;
  const pct = safeTotal > 0 ? (safeValue / safeTotal) * 100 : 0;
  const pctLabel = safeTotal > 0 ? `${pct.toFixed(0)}%` : "0%";

  const fillColor = tone === "danger" ? "#cf3b46" : "#2563c9";

  return (
    <div className="w-full">
      {(label || sublabel) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {label && <span className="text-[13px] font-medium text-[#14171d]">{label}</span>}
          {sublabel && <span className="text-xs text-[#5a6376]">{sublabel}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={safeTotal > 0 ? Math.round(safeValue) : 0}
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        aria-valuetext={`${Math.round(safeValue)} / ${safeTotal} (${pctLabel})`}
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-[#ffffff] ring-1 ring-inset ring-[#d9dde6]"
      >
        <div
          className="relative h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%`, backgroundColor: fillColor }}
        >
          {active && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1/3 animate-[jev-sheen_1.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent motion-reduce:animate-none"
            />
          )}
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-[#5a6376]">
        <span className="tabular-nums">
          완료 {Math.round(safeValue).toLocaleString("ko-KR")} / 전체 {safeTotal.toLocaleString("ko-KR")}
        </span>
        <span className="tabular-nums font-medium text-[#14171d]">{pctLabel}</span>
      </div>
      <style>{`
        @keyframes jev-sheen {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(340%); }
        }
      `}</style>
    </div>
  );
}
