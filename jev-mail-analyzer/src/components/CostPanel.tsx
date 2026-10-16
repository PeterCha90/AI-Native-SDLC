"use client";

import { useEffect, useRef, useState } from "react";
import type { TokenUsage } from "@/lib/types";
import { computeCost, formatMicroUSD, formatTokens, formatUSD, PRICING } from "@/lib/pricing";

export interface CostPanelProps {
  usage: TokenUsage;
  running: boolean;
  emailsAnalyzed: number;
}

const TWEEN_MS = 450;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Tweens a displayed number up toward `target` whenever it increases. */
function useCountUp(target: number): number {
  const [displayed, setDisplayed] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion() || target <= fromRef.current) {
      fromRef.current = target;
      setDisplayed(target);
      return;
    }
    const from = fromRef.current;
    const startTime = performance.now();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / TWEEN_MS);
      const eased = easeOutCubic(t);
      setDisplayed(from + (target - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return displayed;
}

/** Live-updating USD spend readout, driven entirely by props (no fetching). */
export function CostPanel({ usage, running, emailsAnalyzed }: CostPanelProps) {
  const cost = computeCost(usage);
  const displayedTotal = useCountUp(cost.totalCost);

  const coffeeRatio = displayedTotal > 0 ? 5 / displayedTotal : 0;

  return (
    <div className="rounded-xl border border-[#d9dde6] bg-[#ffffff] p-5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[#5a6376]">총 예상 비용</span>
        {running && (
          <span className="flex items-center gap-1.5 text-[11px] text-[#5a6376]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0e8f5f] opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0e8f5f]" />
            </span>
            실시간 집계 중
          </span>
        )}
      </div>

      <div className="mt-1 tabular-nums text-4xl font-semibold text-[#14171d]">{formatUSD(displayedTotal)}</div>
      <div className="mt-0.5 tabular-nums text-xs text-[#5a6376]">{formatMicroUSD(displayedTotal)}</div>

      {displayedTotal > 0 && (
        <p className="mt-2 text-xs text-[#5a6376]">
          이 분석은 커피 한 잔 값의{" "}
          <span className="tabular-nums font-medium text-[#14171d]">{coffeeRatio.toFixed(0)}</span>분의 1입니다
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#d9dde6] pt-4 text-sm">
        <div>
          <dt className="text-xs text-[#5a6376]">입력 토큰</dt>
          <dd className="tabular-nums text-[#14171d]">{formatTokens(usage.inputTokens)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#5a6376]">출력 토큰</dt>
          <dd className="tabular-nums text-[#14171d]">
            {formatTokens(usage.outputTokens)} <span className="text-xs text-[#0e8f5f]">무료</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[#5a6376]">요청 수</dt>
          <dd className="tabular-nums text-[#14171d]">{usage.requests.toLocaleString("ko-KR")}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#5a6376]">분석된 메일</dt>
          <dd className="tabular-nums text-[#14171d]">{emailsAnalyzed.toLocaleString("ko-KR")}건</dd>
        </div>
        <div>
          <dt className="text-xs text-[#5a6376]">메일 1건당 평균 비용</dt>
          <dd className="tabular-nums text-[#14171d]">{formatUSD(cost.costPerRequest)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#5a6376]">1,000건 환산 예상 비용</dt>
          <dd className="tabular-nums text-[#14171d]">{formatUSD(cost.costPer1kEmails)}</dd>
        </div>
      </dl>

      <p className="mt-4 border-t border-[#d9dde6] pt-3 text-[11px] text-[#5a6376]">
        {PRICING.model} · 입력 ${PRICING.inputPerMillionTokens.toFixed(3)} / 1M 토큰 · 출력 무료
      </p>
    </div>
  );
}
