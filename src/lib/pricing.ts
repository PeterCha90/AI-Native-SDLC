import type { TokenUsage } from "./types";

/**
 * JEV pricing, from https://docs.typesafe.ai/models
 *
 *   jev-1.13.0 — $42 per Btok / $0.042 per Mtok, input tokens only.
 *   Output tokens are not billed.
 *
 * Kept here as a named constant so the cost panel has exactly one number to
 * review when TypeSafe changes its price list.
 */
export const PRICING = {
  model: "jev-1.13",
  /** USD per 1,000,000 input tokens. */
  inputPerMillionTokens: 0.042,
  /** USD per 1,000,000 output tokens — JEV does not bill for output. */
  outputPerMillionTokens: 0,
} as const;

export interface CostBreakdown {
  /** USD billed for input tokens. */
  inputCost: number;
  /** USD billed for output tokens — always 0 on JEV, shown for transparency. */
  outputCost: number;
  /** USD total so far. */
  totalCost: number;
  /** Mean USD per JEV request in this run. */
  costPerRequest: number;
  /** What 1,000 emails would cost at this run's observed rate. */
  costPer1kEmails: number;
}

export function computeCost(usage: TokenUsage): CostBreakdown {
  const inputCost = (usage.inputTokens / 1_000_000) * PRICING.inputPerMillionTokens;
  const outputCost = (usage.outputTokens / 1_000_000) * PRICING.outputPerMillionTokens;
  const totalCost = inputCost + outputCost;
  const costPerRequest = usage.requests > 0 ? totalCost / usage.requests : 0;

  return {
    inputCost,
    outputCost,
    totalCost,
    costPerRequest,
    costPer1kEmails: costPerRequest * 1000,
  };
}

/**
 * Per-email costs land around $0.00002, where a plain `toFixed(2)` would read
 * as "$0.00" and hide the whole point. Small amounts keep significant digits;
 * amounts a person would recognise as money get ordinary cent formatting.
 */
export function formatUSD(amount: number): string {
  if (amount === 0) return "$0.00";
  if (amount < 0.01) {
    // Keep 3 significant digits: $0.0000168 rather than $0.00
    const digits = Math.min(10, Math.max(2, -Math.floor(Math.log10(amount)) + 2));
    return `$${amount.toFixed(digits)}`;
  }
  return `$${amount.toFixed(2)}`;
}

/** Micro-dollars, for a headline number that isn't all leading zeros. */
export function formatMicroUSD(amount: number): string {
  return `${(amount * 1_000_000).toFixed(1)}µ$`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}
