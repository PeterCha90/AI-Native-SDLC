import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOpenQuestions, noInterview } from "../src/interview.ts";

test("parseOpenQuestions: numbered list with 3 items returns 3 questions", () => {
  const markdown = [
    "# intent",
    "",
    "## 미해결 질문",
    "1. 첫 번째 질문?",
    "2. 두 번째 질문?",
    "3. 세 번째 질문?",
    "",
  ].join("\n");
  assert.deepEqual(parseOpenQuestions(markdown), ["첫 번째 질문?", "두 번째 질문?", "세 번째 질문?"]);
});

test("parseOpenQuestions: '- 없음' returns an empty array", () => {
  const markdown = ["## 미해결 질문", "- 없음", ""].join("\n");
  assert.deepEqual(parseOpenQuestions(markdown), []);
});

test("parseOpenQuestions: section absent returns an empty array", () => {
  const markdown = ["# intent", "", "## 요약", "내용", ""].join("\n");
  assert.deepEqual(parseOpenQuestions(markdown), []);
});

test("parseOpenQuestions: stops at the next '## ' heading, excluding a following '## 출처' list", () => {
  const markdown = [
    "## 미해결 질문",
    "1. 질문 A",
    "2. 질문 B",
    "",
    "## 출처",
    "- https://example.com/1",
    "- https://example.com/2",
    "",
  ].join("\n");
  assert.deepEqual(parseOpenQuestions(markdown), ["질문 A", "질문 B"]);
});

test("parseOpenQuestions: dash-bulleted list items are also read", () => {
  const markdown = ["## 미해결 질문", "- 질문 하나", "- 질문 둘", ""].join("\n");
  assert.deepEqual(parseOpenQuestions(markdown), ["질문 하나", "질문 둘"]);
});

test("noInterview.ask always resolves to { kind: 'proceed' }", async () => {
  const outcome = await noInterview.ask("KEY-1", ["q1"], 1, 5);
  assert.deepEqual(outcome, { kind: "proceed" });
});
