import type { CategoryResult, ChoiceOption, EmailSummary, SpamResult } from "./types";

export interface CategorySlice {
  label: string;
  value: number;
  color: string;
  /** Mean confidence of the answers in this slice. */
  averageConfidence: number;
  isSpam: boolean;
}

const UNMATCHED_COLOR = "#757d8e";

/**
 * Turns the streamed results into donut slices.
 * Driven by the settings options so the chart's colours and ordering match the
 * Settings drawer even before every email has come back. A label JEV returned
 * that no longer exists in settings still gets a slice — silently dropping
 * answers would misstate the totals.
 */
export function toCategorySlices(
  results: Map<string, CategoryResult>,
  options: ChoiceOption[],
): CategorySlice[] {
  const byLabel = new Map<string, { count: number; confidenceSum: number }>();

  for (const result of results.values()) {
    if (result.error || !result.category) continue;
    const bucket = byLabel.get(result.category) ?? { count: 0, confidenceSum: 0 };
    bucket.count += 1;
    bucket.confidenceSum += result.confidence;
    byLabel.set(result.category, bucket);
  }

  const slices: CategorySlice[] = [];

  for (const option of options) {
    const bucket = byLabel.get(option.label);
    byLabel.delete(option.label);
    slices.push({
      label: option.label,
      value: bucket?.count ?? 0,
      color: option.color,
      averageConfidence: bucket && bucket.count > 0 ? bucket.confidenceSum / bucket.count : 0,
      isSpam: option.isSpam,
    });
  }

  // Anything left came back under a label the user has since renamed or removed.
  for (const [label, bucket] of byLabel) {
    slices.push({
      label,
      value: bucket.count,
      color: UNMATCHED_COLOR,
      averageConfidence: bucket.count > 0 ? bucket.confidenceSum / bucket.count : 0,
      isSpam: false,
    });
  }

  return slices;
}

/** Emails whose category is flagged as a spam bucket — the second pass's input. */
export function spamCandidates(
  results: Map<string, CategoryResult>,
  options: ChoiceOption[],
): string[] {
  const spamLabels = new Set(options.filter((option) => option.isSpam).map((option) => option.label));
  const ids: string[] = [];
  for (const result of results.values()) {
    if (!result.error && spamLabels.has(result.category)) ids.push(result.emailId);
  }
  return ids;
}

/** Answers JEV was not sure about — the confidence-gated review queue. */
export function lowConfidenceCount(results: Map<string, CategoryResult>, threshold: number): number {
  let count = 0;
  for (const result of results.values()) {
    if (!result.error && result.confidence < threshold) count += 1;
  }
  return count;
}

export function failureCount(results: Map<string, CategoryResult>): number {
  let count = 0;
  for (const result of results.values()) if (result.error) count += 1;
  return count;
}

export function averageConfidence(results: Map<string, CategoryResult>): number {
  let sum = 0;
  let count = 0;
  for (const result of results.values()) {
    if (result.error) continue;
    sum += result.confidence;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

export interface SpamSummary {
  analyzed: number;
  likelySpam: number;
  likelyPhishing: number;
  averageProbability: number;
  /** Sorted most-suspicious-first, joined with the email it belongs to. */
  ranked: Array<{ email: EmailSummary; result: SpamResult }>;
}

export function summarizeSpam(
  spamResults: Map<string, SpamResult>,
  emails: EmailSummary[],
  spamThreshold: number,
): SpamSummary {
  const byId = new Map(emails.map((email) => [email.id, email]));
  const ranked: Array<{ email: EmailSummary; result: SpamResult }> = [];
  let probabilitySum = 0;
  let analyzed = 0;
  let likelySpam = 0;
  let likelyPhishing = 0;

  for (const result of spamResults.values()) {
    const email = byId.get(result.emailId);
    if (!email || result.error) continue;
    ranked.push({ email, result });
    probabilitySum += result.spamProbability;
    analyzed += 1;
    if (result.spamProbability >= spamThreshold) likelySpam += 1;
    if (result.phishingProbability >= spamThreshold) likelyPhishing += 1;
  }

  ranked.sort((a, b) => b.result.spamProbability - a.result.spamProbability);

  return {
    analyzed,
    likelySpam,
    likelyPhishing,
    averageProbability: analyzed > 0 ? probabilitySum / analyzed : 0,
    ranked,
  };
}
