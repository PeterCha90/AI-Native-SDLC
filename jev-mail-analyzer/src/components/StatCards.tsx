"use client";

export interface StatCardItem {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}

export interface StatCardsProps {
  items: StatCardItem[];
}

const TONE_COLOR: Record<NonNullable<StatCardItem["tone"]>, string> = {
  default: "#14171d",
  good: "#0e8f5f",
  warn: "#9a6b0f",
  bad: "#cf3b46",
};

/** Responsive grid of compact stat cards. */
export function StatCards({ items }: StatCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item, i) => {
        const color = TONE_COLOR[item.tone ?? "default"];
        return (
          <div
            key={`${item.label}-${i}`}
            className="rounded-xl border border-[#d9dde6] bg-[#ffffff] px-4 py-3"
          >
            <div className="text-[11px] font-medium uppercase tracking-wide text-[#5a6376]">
              {item.label}
            </div>
            <div className="mt-1 tabular-nums text-2xl font-semibold" style={{ color }}>
              {item.value}
            </div>
            {item.hint && <div className="mt-0.5 text-xs text-[#5a6376]">{item.hint}</div>}
          </div>
        );
      })}
    </div>
  );
}
