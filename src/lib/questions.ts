import { choice, noul } from "@typesafe-ai/sdk";
import type { ChoiceCriteria, ChoiceQuestion, NoulQuestion } from "@typesafe-ai/sdk";
import { emailState } from "./emailState";

// Re-exported so the request payload shown in the UI comes from the same
// builder the server actually sends.
export { emailState };

/**
 * Every question JEV is asked, and every threshold read against its answers,
 * lives in this file. The TypeSafe docs make this a review rule: the questions
 * and the constants are the part a human actually needs to read.
 */

/* ---------------------------------------------------------------- */
/* Pass 1 — category (Choice)                                       */
/* ---------------------------------------------------------------- */

/**
 * Builds the Choice question from the user's editable options.
 * A blank description is sent as `null`: the label alone then carries the
 * meaning, which is exactly what `choice()` expects for undescribed labels.
 */
export function categoryQuestion(
  instructions: string,
  options: Array<{ label: string; description: string }>,
): ChoiceQuestion<ChoiceCriteria> {
  const criteria: ChoiceCriteria = {};
  for (const option of options) {
    const description = option.description.trim();
    criteria[option.label] = description.length > 0 ? description : null;
  }
  return choice(instructions, criteria);
}

/* ---------------------------------------------------------------- */
/* Pass 2 — spam probability (Noul)                                 */
/* ---------------------------------------------------------------- */

/**
 * Three yes/no questions asked in one request. A Noul answers with a
 * calibrated probability rather than a verdict, so "how likely is this spam"
 * is a number the UI can show directly instead of a label to trust.
 */
export const SPAM_QUESTIONS: Record<string, NoulQuestion> = {
  is_spam: noul(
    "이 메일은 수신자가 수신에 동의한 적 없는 원치 않는 대량 발송 메일이다.",
    {
      true: "수신자가 요청하거나 구독한 적 없는데 일방적으로 발송된 메일",
      false: "수신자가 직접 가입, 구매, 구독했거나 개인적으로 주고받는 메일",
    },
  ),
  is_phishing: noul(
    "이 메일은 계정 정보나 금전을 탈취하려는 피싱 또는 사기 시도이다.",
    {
      true: "발신자를 사칭하거나, 긴급함을 조작해 링크·첨부·송금을 유도함",
      false: "정상적인 발신자가 보낸 통상적인 내용",
    },
  ),
  is_bulk_marketing: noul(
    "이 메일은 수신자가 실제로 구독한 정상적인 마케팅 메일 또는 뉴스레터이다.",
    {
      true: "실제 구독한 브랜드·서비스의 광고나 뉴스레터로, 수신거부 수단이 있음",
      false: "마케팅 메일이 아니거나, 구독한 적 없는 출처에서 온 메일",
    },
  ),
};

/* ---------------------------------------------------------------- */
/* Thresholds                                                       */
/* ---------------------------------------------------------------- */

/**
 * Defaults only — the Settings drawer overrides both at runtime.
 * CONFIDENCE: a Choice answer below this is surfaced for human review rather
 * than trusted, which is the confidence-gated routing pattern from the docs.
 * SPAM: P(spam) at or above this reads as "likely spam".
 */
export const THRESHOLDS = {
  CONFIDENCE: 0.7,
  SPAM: 0.5,
  /** P(spam) at or above this is called out as high risk. */
  SPAM_HIGH: 0.8,
} as const;

/** Model the demo asks for. `jev-latest` tracks the newest JEV release. */
export const MODEL = process.env.TYPESAFE_MODEL ?? "jev-latest";
