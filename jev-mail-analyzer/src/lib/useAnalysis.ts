"use client";

import { useCallback, useRef, useState } from "react";
import { streamSSE } from "./sseClient";
import type {
  AnalyzeEvent,
  AnalyzerSettings,
  CategoryResult,
  EmailSummary,
  MailboxSource,
  SpamEvent,
  SpamResult,
  TokenUsage,
} from "./types";

const EMPTY_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, requests: 0 };

export type RunPhase = "idle" | "fetching" | "analyzing" | "done" | "error";

export interface AnalysisState {
  phase: RunPhase;
  emails: EmailSummary[];
  results: Map<string, CategoryResult>;
  completed: number;
  total: number;
  source: MailboxSource | null;
  model: string;
  /** Whole run, including the mailbox read. */
  durationMs: number;
  /** The Gmail read alone. `durationMs - fetchMs` is classification time. */
  fetchMs: number;
  error: string | null;
}

export interface SpamState {
  phase: RunPhase;
  results: Map<string, SpamResult>;
  completed: number;
  total: number;
  durationMs: number;
  error: string | null;
}

const INITIAL_ANALYSIS: AnalysisState = {
  phase: "idle",
  emails: [],
  results: new Map(),
  completed: 0,
  total: 0,
  source: null,
  model: "",
  durationMs: 0,
  fetchMs: 0,
  error: null,
};

const INITIAL_SPAM: SpamState = {
  phase: "idle",
  results: new Map(),
  completed: 0,
  total: 0,
  durationMs: 0,
  error: null,
};

/**
 * Owns both analysis passes and the running token/cost tally.
 * Usage accumulates across passes so the cost panel shows one total for the
 * whole session rather than resetting when the spam pass starts.
 */
export function useAnalysis() {
  const [analysis, setAnalysis] = useState<AnalysisState>(INITIAL_ANALYSIS);
  const [spam, setSpam] = useState<SpamState>(INITIAL_SPAM);
  const [usage, setUsage] = useState<TokenUsage>(EMPTY_USAGE);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const runAnalysis = useCallback(async (settings: AnalyzerSettings) => {
    cancel();
    const controller = new AbortController();
    abortRef.current = controller;

    // A new category pass invalidates the spam pass that was based on it.
    setSpam(INITIAL_SPAM);
    setUsage(EMPTY_USAGE);
    setAnalysis({ ...INITIAL_ANALYSIS, phase: "fetching", results: new Map() });

    try {
      await streamSSE<AnalyzeEvent>(
        "/api/analyze",
        {
          instructions: settings.instructions,
          options: settings.options.map((option) => ({
            label: option.label,
            description: option.description,
          })),
          mailCount: settings.mailCount,
          concurrency: settings.concurrency,
        },
        (event) => {
          if (event.type === "start") {
            setAnalysis((prev) => ({
              ...prev,
              phase: "analyzing",
              emails: event.emails,
              total: event.total,
              source: event.source,
              fetchMs: event.fetchMs,
            }));
          } else if (event.type === "result") {
            setAnalysis((prev) => {
              const results = new Map(prev.results);
              results.set(event.result.emailId, event.result);
              return { ...prev, results, completed: event.completed, total: event.total };
            });
          } else if (event.type === "done") {
            setUsage(event.usage);
            setAnalysis((prev) => ({
              ...prev,
              phase: "done",
              model: event.model,
              durationMs: event.durationMs,
            }));
          } else {
            setAnalysis((prev) => ({ ...prev, phase: "error", error: event.message }));
          }
        },
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setAnalysis((prev) => ({ ...prev, phase: "idle" }));
        return;
      }
      setAnalysis((prev) => ({
        ...prev,
        phase: "error",
        error: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
      }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [cancel]);

  const runSpamAnalysis = useCallback(async (emailIds: string[], concurrency: number) => {
    if (emailIds.length === 0) return;
    cancel();
    const controller = new AbortController();
    abortRef.current = controller;

    setSpam({ ...INITIAL_SPAM, phase: "analyzing", total: emailIds.length, results: new Map() });

    try {
      await streamSSE<SpamEvent>(
        "/api/spam",
        { emailIds, concurrency },
        (event) => {
          if (event.type === "start") {
            setSpam((prev) => ({ ...prev, total: event.total }));
          } else if (event.type === "result") {
            setSpam((prev) => {
              const results = new Map(prev.results);
              results.set(event.result.emailId, event.result);
              return { ...prev, results, completed: event.completed, total: event.total };
            });
          } else if (event.type === "done") {
            // Add to the category pass's usage rather than replacing it.
            setUsage((prev) => ({
              inputTokens: prev.inputTokens + event.usage.inputTokens,
              outputTokens: prev.outputTokens + event.usage.outputTokens,
              requests: prev.requests + event.usage.requests,
            }));
            setSpam((prev) => ({ ...prev, phase: "done", durationMs: event.durationMs }));
          } else {
            setSpam((prev) => ({ ...prev, phase: "error", error: event.message }));
          }
        },
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setSpam((prev) => ({ ...prev, phase: "idle" }));
        return;
      }
      setSpam((prev) => ({
        ...prev,
        phase: "error",
        error: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
      }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [cancel]);

  const reset = useCallback(() => {
    cancel();
    setAnalysis(INITIAL_ANALYSIS);
    setSpam(INITIAL_SPAM);
    setUsage(EMPTY_USAGE);
  }, [cancel]);

  return { analysis, spam, usage, runAnalysis, runSpamAnalysis, cancel, reset };
}
