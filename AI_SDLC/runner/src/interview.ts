// 01 Plan interview loop primitives: deterministic parsing of the "## 미해결 질문" section
// intent.md produces, and the channel abstraction the pipeline asks questions through.
// See docs/superpowers/specs/2026-10-01-sdlc-interview-rework-design.md §3.

export interface InterviewAnswer {
  user: string;
  text: string;
}

export type InterviewOutcome =
  | { kind: "answers"; answers: InterviewAnswer[] }
  | { kind: "proceed" }
  | { kind: "timeout" };

export interface InterviewChannel {
  ask(key: string, questions: string[], round: number, maxRounds: number): Promise<InterviewOutcome>;
}

/** Default channel: always proceeds immediately without asking anyone. Used when Slack is off. */
export const noInterview: InterviewChannel = {
  async ask(): Promise<InterviewOutcome> {
    return { kind: "proceed" };
  },
};

const OPEN_QUESTIONS_HEADING = "## 미해결 질문";

/**
 * Reads only the "## 미해결 질문" section of an intent.md-shaped markdown document: a numbered
 * (`1. …`) or dashed (`- …`) list, one question per line, up to (not including) the next `## `
 * heading or the end of the document. A single `없음` item means no open questions. A missing
 * section also means no open questions — parsing fails toward skipping the interview rather than
 * blocking the pipeline; a human judges at the gate instead.
 */
export function parseOpenQuestions(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === OPEN_QUESTIONS_HEADING);
  if (headingIndex === -1) return [];

  const sectionLines: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line.trim())) break;
    sectionLines.push(line);
  }

  const items: string[] = [];
  for (const line of sectionLines) {
    const match = /^\s*(?:\d+\.|-)\s+(.*)$/.exec(line);
    if (!match) continue;
    const text = match[1].trim();
    if (text) items.push(text);
  }

  if (items.length === 1 && items[0] === "없음") return [];
  return items;
}
