import { LIMITS } from "@/lib/defaults";
import { fetchInbox } from "@/lib/gmail";
import { mapPool } from "@/lib/pool";
import { categoryQuestion, emailState, MODEL } from "@/lib/questions";
import { sseResponse } from "@/lib/sse";
import { describeError, getClient } from "@/lib/typesafe";
import type { AnalyzeEvent, AnalyzeRequest, CategoryResult } from "@/lib/types";

// Reads Gmail (fs + network) and calls TypeSafe AI — Node runtime, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ValidatedAnalyzeRequest {
  instructions: string;
  options: Array<{ label: string; description: string }>;
  mailCount: number;
  concurrency: number;
}

type ValidationResult =
  | { ok: true; value: ValidatedAnalyzeRequest }
  | { ok: false; message: string };

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function validate(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "요청 본문이 올바르지 않습니다." };
  }
  const req = body as Partial<AnalyzeRequest>;

  const instructions = typeof req.instructions === "string" ? req.instructions.trim() : "";
  if (instructions.length === 0) {
    return { ok: false, message: "분류 기준(instructions)이 비어 있습니다." };
  }

  const rawOptions = Array.isArray(req.options) ? req.options : [];
  const options = rawOptions
    .map((o) => ({
      label: typeof o?.label === "string" ? o.label.trim() : "",
      description: typeof o?.description === "string" ? o.description : "",
    }))
    .filter((o) => o.label.length > 0)
    .slice(0, LIMITS.maxOptions);

  if (options.length < LIMITS.minOptions) {
    return { ok: false, message: `옵션은 최소 ${LIMITS.minOptions}개 이상 필요합니다.` };
  }
  const labels = options.map((o) => o.label);
  if (new Set(labels).size !== labels.length) {
    return { ok: false, message: "옵션 라벨은 중복될 수 없습니다." };
  }

  const mailCount = clamp(Number(req.mailCount), LIMITS.mailCount.min, LIMITS.mailCount.max);
  const concurrency = clamp(Number(req.concurrency), LIMITS.concurrency.min, LIMITS.concurrency.max);

  return { ok: true, value: { instructions, options, mailCount, concurrency } };
}

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const validated = validate(body);

  return sseResponse<AnalyzeEvent>(async (emit) => {
    if (!validated.ok) {
      emit({ type: "error", message: validated.message });
      return;
    }
    const { instructions, options, mailCount, concurrency } = validated.value;
    const startedAt = Date.now();

    const fetchStartedAt = Date.now();
    const { emails, status } = await fetchInbox(mailCount);
    const fetchMs = Date.now() - fetchStartedAt;
    emit({ type: "start", total: emails.length, emails, source: status.source, fetchMs });

    // Built once — every email is judged against the exact same question.
    const category = categoryQuestion(instructions, options);
    const client = getClient();

    let inputTokens = 0;
    let outputTokens = 0;
    let requests = 0;
    let completed = 0;
    // `MODEL` is usually the `jev-latest` alias; report the version the API
    // actually resolved it to instead of echoing the alias back.
    let resolvedModel = MODEL;

    await mapPool(emails, concurrency, async (email) => {
      try {
        const res = await client.systemOne({
          state: emailState(email),
          questions: { category },
          model: MODEL,
        });
        inputTokens += res.usage.input_tokens;
        outputTokens += res.usage.output_tokens;
        requests += 1;
        resolvedModel = res.model;

        const result: CategoryResult = {
          emailId: email.id,
          category: res.answers.category.choice,
          confidence: res.answers.category.confidence,
          probabilities: res.answers.category.probabilities,
        };
        completed += 1;
        emit({ type: "result", completed, total: emails.length, result });
      } catch (err) {
        completed += 1;
        const result: CategoryResult = {
          emailId: email.id,
          category: "",
          confidence: 0,
          probabilities: {},
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
