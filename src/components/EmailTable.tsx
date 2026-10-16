"use client";

import { useMemo, useState } from "react";
import type { CategoryResult, ChoiceOption, EmailSummary, SpamResult } from "@/lib/types";

export interface EmailTableProps {
  emails: EmailSummary[];
  results: Map<string, CategoryResult>;
  spamResults: Map<string, SpamResult>;
  options: ChoiceOption[];
  confidenceThreshold: number;
  spamThreshold: number;
}

type CategoryFilter = "all" | string;
type SortMode = "none" | "confidence" | "spam";

const MAX_ROWS = 500;

function spamBand(prob: number, spamThreshold: number): "danger" | "warn" | "muted" {
  if (prob >= spamThreshold) return "danger";
  if (prob >= spamThreshold * 0.6) return "warn";
  return "muted";
}

const SPAM_BAND_COLOR: Record<ReturnType<typeof spamBand>, string> = {
  danger: "#cf3b46",
  warn: "#9a6b0f",
  muted: "#5a6376",
};

function ShimmerRow() {
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto_auto] items-center gap-3 border-b border-[#d9dde6] px-3 py-2.5">
      <div className="h-3.5 w-3/4 animate-pulse rounded bg-[#d9dde6] motion-reduce:animate-none" />
      <div className="h-3.5 w-full animate-pulse rounded bg-[#d9dde6] motion-reduce:animate-none" />
      <div className="h-5 w-16 animate-pulse rounded-full bg-[#d9dde6] motion-reduce:animate-none" />
      <div className="h-3.5 w-12 animate-pulse rounded bg-[#d9dde6] motion-reduce:animate-none" />
    </div>
  );
}

/** Dense, filterable, sortable table of analyzed emails. Pure presentation. */
export function EmailTable({
  emails,
  results,
  spamResults,
  options,
  confidenceThreshold,
  spamThreshold,
}: EmailTableProps) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("none");

  const optionByLabel = useMemo(() => {
    const m = new Map<string, ChoiceOption>();
    for (const o of options) m.set(o.label, o);
    return m;
  }, [options]);

  const rows = useMemo(() => {
    let list = emails.slice(0, MAX_ROWS).map((email) => {
      const result = results.get(email.id);
      const spam = spamResults.get(email.id);
      const isLowConfidence = result !== undefined && result.confidence < confidenceThreshold;
      return { email, result, spam, isLowConfidence };
    });

    if (categoryFilter !== "all") {
      list = list.filter((r) => r.result?.category === categoryFilter);
    }
    if (reviewOnly) {
      list = list.filter((r) => r.isLowConfidence);
    }

    if (sortMode === "confidence") {
      list = [...list].sort((a, b) => (b.result?.confidence ?? -1) - (a.result?.confidence ?? -1));
    } else if (sortMode === "spam") {
      list = [...list].sort((a, b) => (b.spam?.spamProbability ?? -1) - (a.spam?.spamProbability ?? -1));
    }

    return list;
  }, [emails, results, spamResults, categoryFilter, reviewOnly, sortMode, confidenceThreshold]);

  const hasSpamColumn = spamResults.size > 0;

  return (
    <div className="rounded-xl border border-[#d9dde6] bg-[#ffffff]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#d9dde6] px-4 py-3">
        <label className="flex items-center gap-1.5 text-xs text-[#5a6376]">
          카테고리
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-md border border-[#d9dde6] bg-[#f5f6f8] px-2 py-1 text-xs text-[#14171d]"
          >
            <option value="all">전체</option>
            {options.map((o) => (
              <option key={o.id} value={o.label}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-[#5a6376]">
          정렬
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded-md border border-[#d9dde6] bg-[#f5f6f8] px-2 py-1 text-xs text-[#14171d]"
          >
            <option value="none">기본</option>
            <option value="confidence">신뢰도</option>
            <option value="spam">스팸확률</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-[#5a6376]">
          <input
            type="checkbox"
            checked={reviewOnly}
            onChange={(e) => setReviewOnly(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-[#d9dde6] bg-[#f5f6f8] accent-[#9a6b0f]"
          />
          검토 필요만 보기
        </label>

        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-[#5a6376]">
          <span className="inline-block h-2.5 w-1 rounded-sm bg-[#9a6b0f]" aria-hidden="true" />
          신뢰도 {(confidenceThreshold * 100).toFixed(0)}% 미만은 검토 필요로 표시됩니다
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto_auto] gap-3 border-b border-[#d9dde6] px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[#5a6376]">
        <span>발신자</span>
        <span>제목</span>
        <span>카테고리</span>
        <span className="text-right">신뢰도{hasSpamColumn ? " / 스팸" : ""}</span>
      </div>

      <div role="table" aria-label="분석된 메일 목록">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[#5a6376]">표시할 메일이 없습니다.</p>
        ) : (
          rows.map(({ email, result, spam, isLowConfidence }) => {
            const option = result ? optionByLabel.get(result.category) : undefined;
            const band = spam ? spamBand(spam.spamProbability, spamThreshold) : null;
            const titleParts = [email.subject];
            if (spam) titleParts.push(`피싱 확률: ${(spam.phishingProbability * 100).toFixed(1)}%`);

            if (!result) {
              return <ShimmerRow key={email.id} />;
            }

            return (
              <div
                key={email.id}
                role="row"
                title={titleParts.join(" · ")}
                className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto_auto] items-center gap-3 border-b border-[#d9dde6] px-3 py-2.5 last:border-b-0"
                style={isLowConfidence ? { borderLeft: "3px solid #9a6b0f" } : undefined}
              >
                <div className="min-w-0" role="cell">
                  <div className="truncate text-sm font-semibold text-[#14171d]">{email.fromName || email.fromAddress}</div>
                  <div className="truncate text-xs text-[#5a6376]">{email.fromAddress}</div>
                </div>

                <div className="min-w-0 truncate text-sm text-[#14171d]" role="cell" title={email.subject}>
                  {email.subject}
                </div>

                <div className="flex items-center gap-2" role="cell">
                  <span
                    className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      color: option?.color ?? "#5a6376",
                      backgroundColor: `${option?.color ?? "#5a6376"}22`,
                    }}
                  >
                    {result.category}
                  </span>
                  {isLowConfidence && (
                    <span className="whitespace-nowrap rounded-full bg-[#9a6b0f]/15 px-2 py-0.5 text-[11px] font-medium text-[#9a6b0f]">
                      검토 필요
                    </span>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1" role="cell">
                  <div className="flex items-center gap-1.5">
                    <span className="tabular-nums text-sm text-[#14171d]">{(result.confidence * 100).toFixed(0)}%</span>
                    <span className="h-1.5 w-14 overflow-hidden rounded-full bg-[#d9dde6]">
                      <span
                        className="block h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none"
                        style={{
                          width: `${Math.min(100, Math.max(0, result.confidence * 100))}%`,
                          backgroundColor: isLowConfidence ? "#9a6b0f" : "#2563c9",
                        }}
                      />
                    </span>
                  </div>
                  {spam && band && (
                    <div className="flex items-center gap-1.5">
                      <span className="tabular-nums text-xs" style={{ color: SPAM_BAND_COLOR[band] }}>
                        {(spam.spamProbability * 100).toFixed(0)}%
                      </span>
                      <span className="h-1 w-14 overflow-hidden rounded-full bg-[#d9dde6]">
                        <span
                          className="block h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none"
                          style={{
                            width: `${Math.min(100, Math.max(0, spam.spamProbability * 100))}%`,
                            backgroundColor: SPAM_BAND_COLOR[band],
                          }}
                        />
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
