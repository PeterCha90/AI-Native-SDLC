import { LIMITS } from "@/lib/defaults";
import { getEmailsByIds } from "@/lib/gmail";
import { mapPool } from "@/lib/pool";
import { emailState, MODEL, SPAM_QUESTIONS } from "@/lib/questions";
import { sseResponse } from "@/lib/sse";
import { describeError, getClient } from "@/lib/typesafe";
import type { SpamEvent, SpamRequest, SpamResult } from "@/lib/types";

// Resolves cached emails and calls TypeSafe AI — Node runtime, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ValidatedSpamRequest {
  emailIds: string[];
  concurrency: number;
}

type ValidationResult =
  | { ok: true; value: ValidatedSpamRequest }
  | { ok: false; message: string };

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function validate(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "요청 본문이 올바르지 않습니다." };
  }
  const req = body as Partial<SpamRequest>;

  const emailIds = Array.isArray(req.emailIds)
    ? req.emailIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  if (emailIds.length === 0) {
    return { ok: false, message: "스팸 검사할 이메일이 선택되지 않았습니다." };
  }

  const concurrency = clamp(Number(req.concurrency), LIMITS.concurrency.min, LIMITS.concurrency.max);

  return { ok: true, value: { emailIds, concurrency } };
}

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const validated = validate(body);

  return sseResponse<SpamEvent>(async (emit) => {
    if (!validated.ok) {
      emit({ type: "error", message: validated.message });
      return;
    }
    const { emailIds, concurrency } = validated.value;
    const startedAt = Date.now();

    const emails = await getEmailsByIds(emailIds);
    emit({ type: "start", total: emails.length });

    const client = getClient();

    let inputTokens = 0;
    let outputTokens = 0;
    let requests = 0;
    let completed = 0;
    // Report the version `jev-latest` resolved to, not the alias.
    let resolvedModel = MODEL;

    await mapPool(emails, concurrency, async (email) => {
      try {
        // One request, three nouls — the docs' fan-out pattern.
        const res = await client.systemOne({
          state: emailState(email),
          questions: SPAM_QUESTIONS,
          model: MODEL,
        });
        inputTokens += res.usage.input_tokens;
        outputTokens += res.usage.output_tokens;
        requests += 1;
        resolvedModel = res.model;

        const result: SpamResult = {
          emailId: email.id,
          spamProbability: res.answers.is_spam.noul,
          phishingProbability: res.answers.is_phishing.noul,
          bulkMarketingProbability: res.answers.is_bulk_marketing.noul,
        };
        completed += 1;
        emit({ type: "result", completed, total: emails.length, result });
      } catch (err) {
        completed += 1;
        const result: SpamResult = {
          emailId: email.id,
          spamProbability: 0,
          phishingProbability: 0,
          bulkMarketingProbability: 0,
          error: describeError(err),
        };
        emit({ type: "result", completed, total: emails.length, result });
      }
    });

    emit({
      type: "done",
      usage: { inputTokens, outputTokens, requests },
      model: resolvedModel,
      durationMs: Date.now() - startedAt,
    });
  });
}
