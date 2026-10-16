/**
 * Shared contract between the API routes and the UI.
 * Everything crossing the network boundary is declared here.
 */

/** One email as the UI sees it. Bodies are never fetched — subject + snippet is enough for JEV. */
export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  fromAddress: string;
  subject: string;
  snippet: string;
  date: string;
  /** Gmail's own labels, kept so the demo can contrast Gmail's guess with JEV's. */
  gmailLabels: string[];
}

/** A single editable Choice option. `label` is what gets sent to JEV as a criteria key. */
export interface ChoiceOption {
  id: string;
  label: string;
  description: string;
  color: string;
  /** Marks the bucket the second pass re-examines. Survives renaming the label. */
  isSpam: boolean;
}

/** Everything the Settings drawer owns. Persisted to localStorage. */
export interface AnalyzerSettings {
  /** The Choice question text itself — reviewable in one place. */
  instructions: string;
  options: ChoiceOption[];
  /** How many inbox messages to pull. */
  mailCount: number;
  /** Parallel in-flight JEV requests. */
  concurrency: number;
  /** Answers below this confidence get flagged for review. */
  confidenceThreshold: number;
  /** noul >= this is treated as "likely spam". */
  spamThreshold: number;
}

/** Result of the category (Choice) pass for one email. */
export interface CategoryResult {
  emailId: string;
  category: string;
  confidence: number;
  probabilities: Record<string, number>;
  /** Set when JEV could not be reached for this email. */
  error?: string;
}

/** Result of the spam (Noul) pass for one email. */
export interface SpamResult {
  emailId: string;
  /** P(unsolicited spam), 0..1 — the headline number. */
  spamProbability: number;
  /** P(phishing / credential theft attempt), 0..1. */
  phishingProbability: number;
  /** P(legitimate bulk marketing the user opted into), 0..1. */
  bulkMarketingProbability: number;
  error?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

/* ------------------------------------------------------------------ */
/* Streaming events (SSE). Both analysis routes speak this vocabulary. */
/* ------------------------------------------------------------------ */

export type AnalyzeEvent =
  /**
   * Mailbox read finished; `total` is how many JEV calls will follow.
   * `fetchMs` is the Gmail read alone, kept separate so classification speed
   * isn't reported as slower than it is.
   */
  | { type: "start"; total: number; emails: EmailSummary[]; source: MailboxSource; fetchMs: number }
  /** One email finished. `completed`/`total` drive the progress bar. */
  | { type: "result"; completed: number; total: number; result: CategoryResult }
  | { type: "done"; usage: TokenUsage; model: string; durationMs: number }
  | { type: "error"; message: string };

export type SpamEvent =
  | { type: "start"; total: number }
  | { type: "result"; completed: number; total: number; result: SpamResult }
  | { type: "done"; usage: TokenUsage; model: string; durationMs: number }
  | { type: "error"; message: string };

/** Where the emails came from — the UI says so plainly. */
export type MailboxSource = "gmail" | "sample";

export interface MailboxStatus {
  source: MailboxSource;
  /** Present when connected to a real account. */
  account?: string;
  /**
   * How many messages were actually read in this fetch. Gmail's own
   * `resultSizeEstimate` is not a mailbox total — it swings with the page
   * size requested — so it is deliberately not surfaced.
   */
  loadedCount?: number;
  /** Why we fell back to the bundled sample, if we did. */
  reason?: string;
}

/** POST body for /api/analyze */
export interface AnalyzeRequest {
  instructions: string;
  options: Array<Pick<ChoiceOption, "label" | "description">>;
  mailCount: number;
  concurrency: number;
}

/** POST body for /api/spam */
export interface SpamRequest {
  emailIds: string[];
  concurrency: number;
}
