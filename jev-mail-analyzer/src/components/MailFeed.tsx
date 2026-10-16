"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { emailState } from "@/lib/emailState";
import { absoluteTime, relativeTime } from "@/lib/format";
import type {
  CategoryResult,
  ChoiceOption,
  EmailSummary,
  MailboxStatus,
  SpamResult,
} from "@/lib/types";

export interface MailFeedProps {
  emails: EmailSummary[];
  results: Map<string, CategoryResult>;
  spamResults: Map<string, SpamResult>;
  options: ChoiceOption[];
  mailbox: MailboxStatus | null;
  /** True while the category pass is still running. */
  running: boolean;
  /** Shown while the mailbox is still being read, before any email exists. */
  fetching: boolean;
  confidenceThreshold: number;
  /** How many rows to render before asking the viewer to load more. */
  pageSize?: number;
  /** Re-pull the inbox. Shown as a button in the header. */
  onRefresh?: () => void;
  refreshing?: boolean;
}

const GMAIL_LABEL_NAMES: Record<string, string> = {
  CATEGORY_PROMOTIONS: "프로모션",
  CATEGORY_PERSONAL: "기본",
  CATEGORY_SOCIAL: "소셜",
  CATEGORY_UPDATES: "업데이트",
  CATEGORY_FORUMS: "포럼",
  IMPORTANT: "중요",
  STARRED: "별표",
  UNREAD: "안 읽음",
};

/** Gmail's own guess, so the audience can compare it against JEV's. */
function gmailCategory(labels: string[]): string | null {
  const found = labels.find((label) => label.startsWith("CATEGORY_"));
  return found ? (GMAIL_LABEL_NAMES[found] ?? found.replace("CATEGORY_", "")) : null;
}

function initial(name: string, address: string): string {
  const source = name.trim() || address.trim();
  return source ? source[0].toUpperCase() : "?";
}

/**
 * Deterministic colour per sender, so the same sender keeps one colour.
 * A pastel fill with a deep ink of the same hue — bright on a light page,
 * and the initial stays readable (contrast ~7:1 across all seven hues).
 */
function avatarTint(seed: string): { background: string; color: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = [212, 152, 28, 268, 190, 45, 340][hash % 7];
  return {
    background: `hsl(${hue} 85% 88%)`,
    color: `hsl(${hue} 55% 32%)`,
  };
}

export function MailFeed({
  emails,
  results,
  spamResults,
  options,
  mailbox,
  running,
  fetching,
  confidenceThreshold,
  pageSize = 25,
  onRefresh,
  refreshing = false,
}: MailFeedProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visible, setVisible] = useState(pageSize);

  // Clock drives the relative timestamps so "3분 전" doesn't go stale on screen.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const optionByLabel = useMemo(
    () => new Map(options.map((option) => [option.label, option])),
    [options],
  );

  // Newest first — real inbox order, which also makes recency obvious.
  const ordered = useMemo(
    () => [...emails].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [emails],
  );

  useEffect(() => {
    setVisible(pageSize);
  }, [pageSize, emails]);

  if (fetching && emails.length === 0) {
    return (
      <section className="card p-5">
        <FeedHeader
          mailbox={mailbox}
          running
          count={0}
          analyzed={0}
          onRefresh={onRefresh}
          refreshing
        />
        <ul className="mt-4 grid gap-2">
          {Array.from({ length: 5 }, (_, index) => (
            <li key={index} className="h-[74px] animate-pulse rounded-lg bg-[#eaedf2] motion-reduce:animate-none" />
          ))}
        </ul>
      </section>
    );
  }

  if (emails.length === 0) {
    return (
      <section className="card p-5">
        <FeedHeader
          mailbox={mailbox}
          running={false}
          count={0}
          analyzed={0}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
        <p className="mt-6 pb-4 text-center text-sm text-[#6b7486]">
          받은편지함에서 메일을 찾지 못했습니다.
        </p>
      </section>
    );
  }

  const shown = ordered.slice(0, visible);

  return (
    <section className="card p-5">
      <FeedHeader
        mailbox={mailbox}
        running={running}
        count={emails.length}
        analyzed={results.size}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />

      <ul className="mt-4 grid gap-1.5">
        {shown.map((email) => {
          const result = results.get(email.id);
          const spam = spamResults.get(email.id);
          const option = result ? optionByLabel.get(result.category) : undefined;
          const isOpen = expanded === email.id;
          const lowConfidence = result && !result.error && result.confidence < confidenceThreshold;

          return (
            <li
              key={email.id}
              className="overflow-hidden rounded-lg border border-[#e5e8ef] bg-[#ffffff] transition-colors hover:border-[#c2c8d4]"
              style={
                result && !result.error && option
                  ? { borderLeft: `2px solid ${option.color}` }
                  : undefined
              }
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : email.id)}
                aria-expanded={isOpen}
                className="flex w-full items-start gap-3 px-3.5 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563c9]"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{
                    backgroundColor: avatarTint(email.fromAddress || email.fromName).background,
                    color: avatarTint(email.fromAddress || email.fromName).color,
                  }}
                >
                  {initial(email.fromName, email.fromAddress)}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-[#14171d]">
                      {email.fromName || email.fromAddress || "(발신자 없음)"}
                    </span>
                    <span className="truncate text-[11px] text-[#757d8e]">{email.fromAddress}</span>
                    <span
                      className="ml-auto shrink-0 text-[11px] tabular-nums text-[#6b7486]"
                      title={absoluteTime(email.date)}
                    >
                      {relativeTime(email.date, now)}
                    </span>
                  </span>

                  <span className="mt-0.5 block truncate text-sm text-[#39404e]">
                    {email.subject || "(제목 없음)"}
                  </span>

                  {/* The actual body preview — the same text JEV was given. */}
                  <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-[#5a6376]">
                    {email.snippet || "(미리보기 없음)"}
                  </span>

                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusChip result={result} option={option} running={running} />
                    {lowConfidence && (
                      <span className="rounded border border-[#ead7a4] px-1.5 py-0.5 text-[10px] text-[#9a6b0f]">
                        검토 필요
                      </span>
                    )}
                    {spam && !spam.error && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] tabular-nums"
                        style={{
                          color: spam.spamProbability >= 0.5 ? "#cf3b46" : "#5a6376",
                          border: `1px solid ${spam.spamProbability >= 0.5 ? "#f0bdc1" : "#d9dde6"}`,
                        }}
                      >
                        스팸 {(spam.spamProbability * 100).toFixed(0)}%
                      </span>
                    )}
                    {gmailCategory(email.gmailLabels) && (
                      <span className="text-[10px] text-[#757d8e]">
                        Gmail: {gmailCategory(email.gmailLabels)}
                      </span>
                    )}
                  </span>
                </span>
              </button>

              {isOpen && <Detail email={email} result={result} spam={spam} />}
            </li>
          );
        })}
      </ul>

      {visible < ordered.length && (
        <button
          type="button"
          onClick={() => setVisible((current) => current + pageSize)}
          className="mt-3 w-full rounded-lg border border-[#d9dde6] py-2.5 text-xs text-[#5a6376] transition-colors hover:border-[#a6aebf] hover:text-[#39404e]"
        >
          {ordered.length - visible}건 더 보기
        </button>
      )}
    </section>
  );
}

function FeedHeader({
  mailbox,
  running,
  count,
  analyzed,
  onRefresh,
  refreshing,
}: {
  mailbox: MailboxStatus | null;
  running: boolean;
  count: number;
  analyzed: number;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const live = mailbox?.source === "gmail";

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[#14171d]">
          {running && (
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0e8f5f] opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0e8f5f]" />
            </span>
          )}
          실시간 메일 스트림
        </h2>
        <p className="mt-1 text-xs text-[#5a6376]">
          {live ? (
            <>
              <span className="text-[#0e8f5f]">{mailbox?.account}</span> 받은편지함에서 방금 읽어온
              실제 메일입니다. 아래 미리보기가 JEV에 그대로 전달됩니다.
            </>
          ) : (
            <>Gmail 자격증명이 없어 번들 샘플 메일을 사용 중입니다.</>
          )}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-xs tabular-nums text-[#6b7486]">
          {count}건 중 <span className="text-[#14171d]">{analyzed}</span>건 분석됨
        </p>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="rounded-md border border-[#d9dde6] px-2.5 py-1 text-[11px] text-[#5a6376] transition-colors hover:border-[#a6aebf] hover:text-[#39404e] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? "불러오는 중…" : "새로고침"}
          </button>
        )}
      </div>
    </div>
  );
}

function StatusChip({
  result,
  option,
  running,
}: {
  result: CategoryResult | undefined;
  option: ChoiceOption | undefined;
  running: boolean;
}) {
  if (!result) {
    return (
      <span className="flex items-center gap-1.5 rounded border border-[#d9dde6] px-1.5 py-0.5 text-[10px] text-[#6b7486]">
        {running ? (
          <>
            <span className="h-1 w-1 animate-pulse rounded-full bg-[#2563c9] motion-reduce:animate-none" />
            분석 대기
          </>
        ) : (
          "미분석"
        )}
      </span>
    );
  }

  if (result.error) {
    return (
      <span className="rounded border border-[#f0bdc1] px-1.5 py-0.5 text-[10px] text-[#cf3b46]" title={result.error}>
        분석 실패
      </span>
    );
  }

  const color = option?.color ?? "#5a6376";
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-medium"
        style={{ color, backgroundColor: `${color}1a`, border: `1px solid ${color}40` }}
      >
        {result.category}
      </span>
      <span className="text-[10px] tabular-nums text-[#6b7486]">
        신뢰도 {(result.confidence * 100).toFixed(0)}%
      </span>
    </span>
  );
}

/**
 * The receipt: the exact JSON sent to JEV and the full distribution returned.
 * This is what turns "trust me, it's live" into something checkable.
 */
function Detail({
  email,
  result,
  spam,
}: {
  email: EmailSummary;
  result: CategoryResult | undefined;
  spam: SpamResult | undefined;
}) {
  const sorted = result
    ? Object.entries(result.probabilities).sort(([, a], [, b]) => b - a)
    : [];

  return (
    <div className="border-t border-[#e5e8ef] bg-[#f8f9fb] px-3.5 py-4">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6b7486]">
            JEV에 보낸 state
          </h3>
          <pre className="mt-2 max-h-56 overflow-auto rounded-md border border-[#e5e8ef] bg-[#f1f3f7] p-3 text-[11px] leading-relaxed text-[#5a6376]">
{JSON.stringify(emailState(email), null, 2)}
          </pre>
          {email.gmailLabels.length > 0 && (
            <p className="mt-2 text-[11px] text-[#757d8e]">
              Gmail 라벨: {email.gmailLabels.join(", ")}
            </p>
          )}
        </div>

        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6b7486]">
            선택지별 확률
          </h3>
          {sorted.length === 0 ? (
            <p className="mt-2 text-xs text-[#6b7486]">아직 분석되지 않았습니다.</p>
          ) : (
            <ul className="mt-2 grid gap-1.5">
              {sorted.map(([label, probability]) => (
                <li key={label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span className="flex items-center gap-2">
                    <span className="w-28 truncate text-[11px] text-[#39404e]" title={label}>
                      {label}
                    </span>
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-[#e5e8ee]">
                      <span
                        className="block h-full rounded-full bg-[#2563c9]"
                        style={{ width: `${probability * 100}%` }}
                      />
                    </span>
                  </span>
                  <span className="w-12 text-right text-[11px] tabular-nums text-[#5a6376]">
                    {(probability * 100).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          )}

          {spam && !spam.error && (
            <div className="mt-4 border-t border-[#e5e8ef] pt-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6b7486]">
                Noul 확률
              </h3>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                {[
                  ["스팸", spam.spamProbability],
                  ["피싱", spam.phishingProbability],
                  ["정상 마케팅", spam.bulkMarketingProbability],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded border border-[#e5e8ef] px-2 py-1.5">
                    <dt className="text-[#6b7486]">{label as string}</dt>
                    <dd className="mt-0.5 tabular-nums text-[#14171d]">
                      {((value as number) * 100).toFixed(1)}%
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
