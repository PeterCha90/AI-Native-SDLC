"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CostPanel } from "@/components/CostPanel";
import { DonutChart } from "@/components/DonutChart";
import { EmailTable } from "@/components/EmailTable";
import { MailFeed } from "@/components/MailFeed";
import { ProgressBar } from "@/components/ProgressBar";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { StatCards, type StatCardItem } from "@/components/StatCards";
import {
  averageConfidence,
  failureCount,
  lowConfidenceCount,
  spamCandidates,
  summarizeSpam,
  toCategorySlices,
} from "@/lib/aggregate";
import { duration, throughput } from "@/lib/format";
import { useAnalysis } from "@/lib/useAnalysis";
import { useElapsed } from "@/lib/useElapsed";
import { useSettings } from "@/lib/useSettings";
import type { EmailSummary, MailboxStatus } from "@/lib/types";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function Page() {
  const settingsApi = useSettings();
  const { settings, errors } = settingsApi;
  const { analysis, spam, usage, runAnalysis, runSpamAnalysis, cancel, reset } = useAnalysis();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mailbox, setMailbox] = useState<MailboxStatus | null>(null);
  const [inbox, setInbox] = useState<EmailSummary[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * Pull the actual inbox as soon as the page opens. The mail list is the
   * proof that this is a live session, so it must not wait on an analysis run.
   */
  const loadInbox = useCallback(async (limit: number, signal?: AbortSignal) => {
    setInboxLoading(true);
    setInboxError(null);
    try {
      const response = await fetch(`/api/messages?limit=${limit}`, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { emails: EmailSummary[]; status: MailboxStatus };
      setInbox(data.emails);
      setMailbox(data.status);
    } catch (error) {
      if (signal?.aborted) return;
      setInboxError(
        error instanceof Error ? `메일을 불러오지 못했습니다: ${error.message}` : "메일을 불러오지 못했습니다.",
      );
    } finally {
      if (!signal?.aborted) setInboxLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadInbox(settings.mailCount, controller.signal);
    return () => controller.abort();
    // Deliberately mount-only: re-pulling on every slider nudge would hammer Gmail.
    // The refresh button and each analysis run bring in fresh mail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const analysisRunning = analysis.phase === "fetching" || analysis.phase === "analyzing";
  const spamRunning = spam.phase === "analyzing";
  const busy = analysisRunning || spamRunning;

  // Ticks during a run, then the server's own measurement takes over so the
  // number shown live and the number shown afterwards agree.
  const liveAnalysisMs = useElapsed(analysisRunning);
  const liveSpamMs = useElapsed(spamRunning);
  const analysisMs = analysisRunning ? liveAnalysisMs : analysis.durationMs;
  const spamMs = spamRunning ? liveSpamMs : spam.durationMs;
  const totalMs = analysisMs + spamMs;
  // Classification time on its own. Reading a few hundred messages out of
  // Gmail can take longer than judging them, and folding the two together
  // would report JEV as slower than it is.
  const classifyMs = Math.max(0, analysisMs - analysis.fetchMs);

  const slices = useMemo(
    () => toCategorySlices(analysis.results, settings.options),
    [analysis.results, settings.options],
  );
  const visibleSlices = useMemo(() => slices.filter((slice) => slice.value > 0), [slices]);

  const candidates = useMemo(
    () => spamCandidates(analysis.results, settings.options),
    [analysis.results, settings.options],
  );

  const spamSummary = useMemo(
    () => summarizeSpam(spam.results, analysis.emails, settings.spamThreshold),
    [spam.results, analysis.emails, settings.spamThreshold],
  );

  // Once a run starts, its own email list takes over — same ids, so results
  // keep lining up; before that, the preview fetch supplies the rows.
  const feedEmails = analysis.emails.length > 0 ? analysis.emails : inbox;
  const analyzed = analysis.results.size;
  const failures = failureCount(analysis.results);
  const lowConfidence = lowConfidenceCount(analysis.results, settings.confidenceThreshold);
  const meanConfidence = averageConfidence(analysis.results);

  const source = mailbox?.source ?? analysis.source;

  const stats: StatCardItem[] = useMemo(() => {
    const items: StatCardItem[] = [
      {
        label: "분석한 메일",
        value: String(analyzed),
        hint: analysis.total > 0 ? `전체 ${analysis.total}건` : undefined,
      },
      {
        label: "카테고리",
        value: String(visibleSlices.length),
        hint: `설정된 선택지 ${settings.options.length}개`,
      },
      {
        label: "평균 신뢰도",
        value: analyzed > 0 ? percent(meanConfidence) : "—",
        tone: meanConfidence >= 0.85 ? "good" : meanConfidence >= 0.6 ? "warn" : "default",
      },
      {
        label: "검토 필요",
        value: String(lowConfidence),
        hint: `신뢰도 ${percent(settings.confidenceThreshold)} 미만`,
        tone: lowConfidence > 0 ? "warn" : "good",
      },
    ];

    if (analysisMs > 0) {
      items.push({
        label: analysisRunning ? "경과 시간" : "총 소요 시간",
        value: duration(totalMs),
        hint:
          analysis.fetchMs > 0
            ? `메일 읽기 ${duration(analysis.fetchMs)} · 분류 ${duration(classifyMs)}`
            : undefined,
      });
      items.push({
        label: "분류 시간",
        value: duration(classifyMs),
        hint: spamMs > 0 ? `2차 Noul ${duration(spamMs)}` : analysis.model || undefined,
      });
      items.push({
        label: "처리 속도",
        value: throughput(analyzed, classifyMs),
        hint: `동시 요청 ${settings.concurrency}개`,
      });
    }
    if (failures > 0) {
      items.push({ label: "실패", value: String(failures), tone: "bad" });
    }
    return items;
  }, [
    analyzed,
    analysis.total,
    analysisMs,
    spamMs,
    totalMs,
    classifyMs,
    analysis.fetchMs,
    analysisRunning,
    settings.concurrency,
    analysis.model,
    visibleSlices.length,
    settings.options.length,
    settings.confidenceThreshold,
    meanConfidence,
    lowConfidence,
    failures,
  ]);

  const handleAnalyze = useCallback(() => {
    void runAnalysis(settings);
  }, [runAnalysis, settings]);

  const handleSpam = useCallback(() => {
    void runSpamAnalysis(candidates, settings.concurrency);
  }, [runSpamAnalysis, candidates, settings.concurrency]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    settingsButtonRef.current?.focus();
  }, []);

  const spamLabels = settings.options.filter((option) => option.isSpam).map((option) => option.label);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1280px] px-6 py-8">
        <Header source={source} mailbox={mailbox} />

        {analysis.error && <ErrorBanner message={analysis.error} />}
        {spam.error && <ErrorBanner message={spam.error} />}

        {inboxError && <ErrorBanner message={inboxError} />}

        {analyzed > 0 && (
          <>
            <div className="mt-6">
              <StatCards items={stats} />
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
              <section className="card p-6">
                <h2 className="text-sm font-semibold text-[#14171d]">카테고리 분포</h2>
                <p className="mt-1 text-xs text-[#5a6376]">
                  JEV가 고른 선택지입니다. 각 조각의 크기는 메일 수, 색은 설정의 카테고리 색입니다.
                </p>
                <div className="mt-5">
                  <DonutChart
                    data={visibleSlices.map((slice) => ({
                      label: slice.label,
                      value: slice.value,
                      color: slice.color,
                    }))}
                    total={visibleSlices.reduce((sum, slice) => sum + slice.value, 0)}
                    centerLabel="분류된 메일"
                    size={260}
                  />
                </div>
              </section>

              <CostPanel usage={usage} running={busy} emailsAnalyzed={analyzed} />
            </div>

          </>
        )}

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <MailFeed
              emails={feedEmails}
              results={analysis.results}
              spamResults={spam.results}
              options={settings.options}
              mailbox={mailbox}
              running={analysisRunning}
              fetching={inboxLoading || analysis.phase === "fetching"}
              confidenceThreshold={settings.confidenceThreshold}
              pageSize={15}
              onRefresh={() => void loadInbox(settings.mailCount)}
              refreshing={inboxLoading}
            />
          </div>

          {/* Sticky so the run controls stay in reach while scrolling a long feed. */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <Controls
              busy={busy}
              analysisRunning={analysisRunning}
              spamRunning={spamRunning}
              blocked={errors.blocking}
              blockingMessage={errors.messages[0]}
              canAnalyze={!busy}
              canRunSpam={analysis.phase === "done" && candidates.length > 0 && !busy}
              candidateCount={candidates.length}
              spamLabels={spamLabels}
              hasRun={analysis.phase === "done" || analysis.results.size > 0}
              mailCount={settings.mailCount}
              onAnalyze={handleAnalyze}
              onSpam={handleSpam}
              onCancel={cancel}
              onReset={reset}
            />
            {(analysisRunning || analysis.phase === "done") && (
              <div className="card mt-3 grid gap-4 p-4">
                <ProgressBar
                  value={analysis.completed}
                  total={analysis.total}
                  label={
                    analysis.phase === "fetching"
                      ? "Gmail에서 메일을 불러오는 중…"
                      : "1차 · 카테고리 분류 (Choice)"
                  }
                  sublabel={
                    analysis.phase === "done"
                      ? `완료 · ${duration(analysis.durationMs)}`
                      : `${duration(analysisMs)} 경과 · 동시 요청 ${settings.concurrency}개`
                  }
                  active={analysisRunning}
                />
                {(spamRunning || spam.phase === "done") && (
                  <ProgressBar
                    value={spam.completed}
                    total={spam.total}
                    label="2차 · 스팸 확률 측정 (Noul)"
                    sublabel={
                      spam.phase === "done"
                        ? `완료 · ${duration(spam.durationMs)}`
                        : `${duration(spamMs)} 경과 · 메일당 3문항을 한 요청으로`
                    }
                    tone="danger"
                    active={spamRunning}
                  />
                )}
              </div>
            )}

            <button
              ref={settingsButtonRef}
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="분석 설정 열기"
              className="mt-3 flex w-full items-center justify-between gap-2 rounded-xl border border-[#d9dde6] bg-[#ffffff] px-4 py-3 text-sm text-[#39404e] transition-colors hover:border-[#a6aebf] hover:text-[#14171d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563c9]"
            >
              <span className="flex items-center gap-2">
                <SettingsIcon />
                분석 설정
              </span>
              <span className="rounded bg-[#eef1f6] px-1.5 py-0.5 text-[11px] tabular-nums text-[#5a6376]">
                카테고리 {settings.options.length}
              </span>
            </button>
          </aside>
        </div>


        {analyzed > 0 && (
          <>
            {spamSummary.analyzed > 0 && (
              <SpamSection summary={spamSummary} threshold={settings.spamThreshold} />
            )}

            <section className="mt-6">
              <h2 className="mb-1 text-sm font-semibold text-[#14171d]">분류 결과 표</h2>
              <p className="mb-3 text-xs text-[#5a6376]">
                카테고리로 거르고 신뢰도·스팸확률로 정렬할 수 있습니다.
              </p>
              <EmailTable
                emails={analysis.emails}
                results={analysis.results}
                spamResults={spam.results}
                options={settings.options}
                confidenceThreshold={settings.confidenceThreshold}
                spamThreshold={settings.spamThreshold}
              />
            </section>
          </>
        )}


      </div>

      <SettingsDrawer open={drawerOpen} onClose={closeDrawer} settings={settings} controls={settingsApi} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Header({
  source,
  mailbox,
}: {
  source: MailboxStatus["source"] | null;
  mailbox: MailboxStatus | null;
}) {
  return (
    <header>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-[#14171d]">JEV 메일 분석기</h1>
        <SourceBadge source={source} mailbox={mailbox} />
      </div>
      <p className="mt-1.5 max-w-[68ch] text-sm text-[#5a6376]">
        TypeSafe AI의 System One 모델 <span className="text-[#39404e]">JEV</span>로 받은편지함을
        분류합니다. 분류 기준은 우측 설정에서 바로 바꿀 수 있고, 스팸으로 분류된 메일은 확률로 다시 측정합니다.
      </p>
    </header>
  );
}

function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.65.73.85" />
    </svg>
  );
}

function SourceBadge({
  source,
  mailbox,
}: {
  source: MailboxStatus["source"] | null;
  mailbox: MailboxStatus | null;
}) {
  if (!source) return null;

  if (source === "gmail") {
    return (
      <span
        className="flex items-center gap-1.5 rounded-full border border-[#a8dfc5] bg-[#e8f7f0] px-2.5 py-1 text-[11px] font-medium text-[#0e8f5f]"
        title={mailbox?.account ? `${mailbox.account} · 읽기 전용` : undefined}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[#0e8f5f]" />
        Gmail 연결됨
        {typeof mailbox?.loadedCount === "number" && (
          <span className="tabular-nums text-[#0e8f5f]">· 최근 {mailbox.loadedCount}건 로드</span>
        )}
      </span>
    );
  }

  return (
    <span
      className="flex items-center gap-1.5 rounded-full border border-[#ead7a4] bg-[#fdf6e5] px-2.5 py-1 text-[11px] font-medium text-[#9a6b0f]"
      title={mailbox?.reason ?? "Gmail 자격증명을 찾을 수 없어 샘플 데이터로 동작합니다."}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[#9a6b0f]" />
      샘플 데이터
    </span>
  );
}

function Controls({
  busy,
  analysisRunning,
  spamRunning,
  blocked,
  blockingMessage,
  canAnalyze,
  canRunSpam,
  candidateCount,
  spamLabels,
  hasRun,
  mailCount,
  onAnalyze,
  onSpam,
  onCancel,
  onReset,
}: {
  busy: boolean;
  analysisRunning: boolean;
  spamRunning: boolean;
  blocked: boolean;
  blockingMessage?: string;
  canAnalyze: boolean;
  canRunSpam: boolean;
  candidateCount: number;
  spamLabels: string[];
  hasRun: boolean;
  mailCount: number;
  onAnalyze: () => void;
  onSpam: () => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const spamDisabledReason = spamLabels.length === 0
    ? "설정에서 '스팸 후보'로 표시된 카테고리가 없습니다"
    : candidateCount === 0
      ? `${spamLabels.join(", ")}(으)로 분류된 메일이 없습니다`
      : undefined;

  return (
    <div className="card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#757d8e]">실행</p>

      <div className="mt-3 grid gap-2">
        <button
          type="button"
          onClick={onAnalyze}
          disabled={!canAnalyze || blocked}
          title={blocked ? blockingMessage : undefined}
          className="w-full rounded-lg bg-[#2563c9] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1d4fb0] disabled:cursor-not-allowed disabled:bg-[#d9dde6] disabled:text-[#6b7486] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563c9] focus-visible:ring-offset-2 focus-visible:ring-offset-[#ffffff]"
        >
          {analysisRunning ? "분석 중…" : hasRun ? "다시 분석" : "분석 시작"}
        </button>

        <button
          type="button"
          onClick={onSpam}
          disabled={!canRunSpam}
          title={spamDisabledReason}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#f0bdc1] bg-[#fdedee] px-4 py-2.5 text-sm font-semibold text-[#cf3b46] transition-colors hover:border-[#dd9aa0] hover:bg-[#fbdde0] disabled:cursor-not-allowed disabled:border-[#d9dde6] disabled:bg-transparent disabled:text-[#6b7486] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#cf3b46] focus-visible:ring-offset-2 focus-visible:ring-offset-[#ffffff]"
        >
          {spamRunning ? "측정 중…" : "스팸 확률 재분석"}
          {candidateCount > 0 && !spamRunning && (
            <span className="rounded bg-[#f6ced2] px-1.5 py-0.5 text-[11px] tabular-nums">
              {candidateCount}
            </span>
          )}
        </button>

        {busy ? (
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-lg border border-[#d9dde6] px-4 py-2 text-sm text-[#5a6376] transition-colors hover:border-[#a6aebf] hover:text-[#39404e]"
          >
            중지
          </button>
        ) : (
          hasRun && (
            <button
              type="button"
              onClick={onReset}
              className="w-full rounded-lg border border-[#d9dde6] px-4 py-2 text-sm text-[#5a6376] transition-colors hover:border-[#a6aebf] hover:text-[#39404e]"
            >
              초기화
            </button>
          )
        )}
      </div>

      <p className="mt-3 text-xs text-[#6b7486]">
        최근 메일 <span className="tabular-nums text-[#5a6376]">{mailCount}</span>건 대상
      </p>
      {blocked && blockingMessage && (
        <p className="mt-1 text-xs text-[#cf3b46]">{blockingMessage}</p>
      )}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mt-4 rounded-lg border border-[#f0bdc1] bg-[#fdedee] px-4 py-3 text-sm text-[#a92f38]"
    >
      {message}
    </div>
  );
}

function SpamSection({
  summary,
  threshold,
}: {
  summary: ReturnType<typeof summarizeSpam>;
  threshold: number;
}) {
  return (
    <section className="mt-6 card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#14171d]">스팸 확률 재분석 (Noul)</h2>
          <p className="mt-1 text-xs text-[#5a6376]">
            예/아니오 대신 확률로 답합니다. 한 메일당 스팸·피싱·정상 마케팅 세 문항을 한 요청으로 물었습니다.
          </p>
        </div>
        <div className="flex gap-5 text-xs text-[#5a6376]">
          <span>
            측정 <span className="tabular-nums text-[#14171d]">{summary.analyzed}</span>건
          </span>
          <span>
            스팸 의심{" "}
            <span className="tabular-nums text-[#cf3b46]">{summary.likelySpam}</span>건
          </span>
          <span>
            피싱 의심{" "}
            <span className="tabular-nums text-[#cf3b46]">{summary.likelyPhishing}</span>건
          </span>
          <span>
            평균{" "}
            <span className="tabular-nums text-[#14171d]">
              {(summary.averageProbability * 100).toFixed(1)}%
            </span>
          </span>
        </div>
      </div>

      <ul className="mt-5 grid gap-2">
        {summary.ranked.map(({ email, result }) => {
          const pct = result.spamProbability * 100;
          const band =
            result.spamProbability >= threshold
              ? { color: "#cf3b46", text: "스팸 가능성 높음" }
              : result.spamProbability >= threshold * 0.6
                ? { color: "#9a6b0f", text: "의심" }
                : { color: "#0e8f5f", text: "정상으로 보임" };

          return (
            <li
              key={email.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-[#e5e8ef] bg-[#ffffff] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-[#14171d]" title={email.subject}>
                  {email.subject || "(제목 없음)"}
                </p>
                <p className="mt-0.5 truncate text-xs text-[#5a6376]" title={email.from}>
                  {email.fromName || email.fromAddress}
                  <span className="ml-2 text-[#757d8e]">
                    피싱 {(result.phishingProbability * 100).toFixed(0)}% · 정상 마케팅{" "}
                    {(result.bulkMarketingProbability * 100).toFixed(0)}%
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-[#e5e8ef]">
                  <div
                    className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                    style={{ width: `${pct}%`, backgroundColor: band.color }}
                  />
                </div>
                <span
                  className="w-14 text-right text-sm font-semibold tabular-nums"
                  style={{ color: band.color }}
                  title={band.text}
                >
                  {pct.toFixed(1)}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs text-[#6b7486]">
        임계값 {(threshold * 100).toFixed(0)}% 이상을 스팸 의심으로 셉니다. 확률은 판정이 아니라
        보정된 수치이므로, 임계값은 설정에서 직접 조정하세요.
      </p>
    </section>
  );
}

