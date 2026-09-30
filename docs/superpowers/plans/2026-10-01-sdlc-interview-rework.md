# 01 인터뷰 루프와 반려 후 재작업 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 01 Plan이 Slack 스레드에서 요청자를 인터뷰해 intent.md를 완성하고, 01·02·03 게이트 반려 시 사유를 반영해 재작업하게 한다.

**Architecture:** 파이프라인은 `InterviewChannel` 인터페이스로 질문을 던지고 답을 기다린다(기본 구현은 즉시 진행). 질문은 intent.md의 `## 미해결 질문` 절을 결정론적으로 파싱한다. 답·반려 사유는 `claude -p --resume <같은 세션>`으로 반영한다. Slack 구현은 스레드 답글을 메시지 이벤트로 모은다.

**Tech Stack:** Node ≥ 22 (`--experimental-strip-types`), TypeScript, `node:test`, `@slack/bolt`, Linear GraphQL.

**Spec:** `docs/superpowers/specs/2026-10-01-sdlc-interview-rework-design.md`

## Global Constraints

- 경로는 `AI_SDLC/runner/` 기준, 테스트는 `test/*.test.ts`, 검증은 `npm test && npx tsc --noEmit`.
- 새 의존성 없음.
- Slack이 꺼져 있으면 인터뷰는 건너뛰고(지금과 같은 동작), 반려 재작업은 Linear만으로 동작한다.
- 인터뷰 최대 `interviewMaxRounds` = 5, 재작업 최대 `reworkMaxAttempts` = 3. 재작업은 01-plan·02-design·03-build 게이트만.
- 사용자 문자열은 한국어. 병렬 작업 중에는 커밋하지 않는다(오케스트레이터가 커밋). 자기 Files 밖은 수정하지 않는다.

## Review Focus

1. 요청자가 [답변 반영]을 답글 없이 누름 → 재실행 없이 `proceed`로 처리 (Task 3).
2. 인터뷰 스레드가 아닌 곳의 메시지·봇 자신의 메시지·수정 이벤트 → 답으로 모이지 않음 (Task 3).
3. `--resume` 세션이 사라진 경우 → 새 세션으로 산출물 전문 + 답을 넣어 재실행 (Task 2).
4. 반려 사유 코멘트가 비어 있음 → "사유 없음"으로 재작업 프롬프트 구성, 무한 반복 없이 3회에서 중단 (Task 2).
5. 인터뷰 대기 중 러너 재시작 후 버튼 → "러너 재시작으로 중단, `/sdlc run <키>`" (Task 3).

---

## Wave A (Task 1, 2, 4 병렬)

### Task 1: 기반 — 세션 이어 가기, 질문 파싱, 인터뷰 타입, 어댑터·설정

**Files:**
- Modify: `src/claude.ts`, `src/adapters/types.ts`, `src/adapters/linear.ts`, `src/adapters/jira.ts`, `src/config.ts`
- Create: `src/interview.ts`, `test/interview.test.ts`
- Test: `test/linear.test.ts`(추가), `test/config.test.ts`(추가), `test/claude.test.ts`(없으면 생성)

**Interfaces (Produces):**
```ts
// claude.ts
RunStageOptions.resumeSessionId?: string;   // 있으면 --session-id 대신 --resume <id>
StageResult.sessionId: string;              // 이번 실행의 세션 ID (resume이면 그 ID)
// interview.ts
export interface InterviewAnswer { user: string; text: string }
export type InterviewOutcome = { kind: "answers"; answers: InterviewAnswer[] } | { kind: "proceed" } | { kind: "timeout" };
export interface InterviewChannel { ask(key: string, questions: string[], round: number, maxRounds: number): Promise<InterviewOutcome> }
export const noInterview: InterviewChannel;          // 항상 { kind: "proceed" }
export function parseOpenQuestions(markdown: string): string[];
// adapters/types.ts
Ticket.creatorEmail?: string;
setStateType(issueId: string, type: "completed" | "canceled" | "unstarted"): Promise<void>;
// config.ts
Config.interviewMaxRounds: number (기본 5); Config.reworkMaxAttempts: number (기본 3)
```
`parseOpenQuestions`: `## 미해결 질문` 제목부터 다음 `## ` 전까지에서 `1. …` / `- …` 목록 항목 텍스트만, 항목이 `없음`이면 제외. 절이 없으면 `[]`. Linear: `listRecentIssues`·`getTicket`·webhook `parse`가 가능한 곳에서 `creator { email }`을 `creatorEmail`로.

- [ ] **Step 1: 실패하는 테스트** — `parseOpenQuestions`: 번호 목록 3개 → 3개; `- 없음` → `[]`; 절 없음 → `[]`; 뒤에 `## 출처`가 와도 그 목록은 제외. `runStage` 인자 조립을 순수 함수 `buildClaudeArgs(opts, sessionId): string[]`로 빼서 `resumeSessionId` 있으면 `["--resume", id]`가 들어가고 `--session-id`는 없음. 어댑터: `setStateType(…, "unstarted")`가 unstarted 타입 상태 중 position 최소를 고름; `listRecentIssues` 결과에 `creatorEmail`. 설정 기본값 5/3, 파일 값 반영.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS.

### Task 2: 파이프라인 — 인터뷰 루프와 재작업 루프

**Files:**
- Modify: `src/pipeline.ts`, `src/events.ts`
- Test: `test/interview-pipeline.test.ts`(생성)

**Interfaces:**
- Consumes (Task 1, 병렬 작성 중 — 이름과 타입은 위 그대로): `InterviewChannel`, `noInterview`, `parseOpenQuestions`, `RunStageOptions.resumeSessionId`, `StageResult.sessionId`, `setStateType(…, "unstarted")`, `Config.interviewMaxRounds`, `Config.reworkMaxAttempts`.
- Produces:
  ```ts
  // events.ts — 선택 메서드 (notifier가 아직 구현하지 않아도 컴파일되게). safeEvents는 있을 때만 호출.
  stageReworking?(key: string, stage: StageId, attempt: number, maxAttempts: number, reason: string): Promise<void>;
  interviewAnswered?(key: string, round: number, answerCount: number): Promise<void>;
  // pipeline.ts
  runPipeline(ticket, config, source, runnerDir, events = noopEvents, interview: InterviewChannel = noInterview)
  ```
- 01 흐름: `01-intent` 실행(세션 S 기억) → `parseOpenQuestions(intent.md)` → 질문 있고 round ≤ max면 `interview.ask` → `answers`면 Linear 원 티켓에 Q&A 코멘트 + `interviewAnswered` + `runAndLog("01-intent-revise", "다음 답을 반영해 <path>를 고쳐라 …", resumeSessionId: S)` → 다시 파싱; `proceed`/`timeout`/빈 answers → 루프 종료 → 01-plan 게이트.
- 재작업: `gate()`가 반려를 돌려주면 01·02·03(계획)에 한해 attempt < max일 때 `stageReworking` → `runAndLog("<stage>-rework", "반려 사유: <reason 또는 '사유 없음'>. 반영해 <산출물>을 고쳐라.", resumeSessionId: 그 단계 세션)` → `setStateType(gate, "unstarted")` + "재작업 N/3" 코멘트 → 다시 게이트. 01 재작업 뒤에는 인터뷰 루프를 다시 탄다. 04·05·06 반려는 지금처럼 중단.
- resume 실패(`ok:false`이고 `sessionJsonlPath === null`)면 새 세션으로 "산출물 전문 + 답/사유" 프롬프트로 한 번 재시도.

- [ ] **Step 1: 실패하는 테스트** (`test/pipeline-e2e.test.ts`의 가짜 러너·source 구성을 참고해 새 파일에): 질문 2개 → answers → 두 번째 실행의 `resumeSessionId`가 첫 세션, 두 번째 파싱 0개 → 01-plan 게이트 대기로 진행; 인터뷰 5회 상한(매번 질문 남음) → 6번째 ask 없음; `proceed` → 재실행 없음; 원 티켓에 Q&A 코멘트 1회; 01 반려 1회 → rework 실행 + `setStateType(gate01, "unstarted")` → 다시 대기 → 승인 → 02 진행; 01 반려 3회 → 중단(`runFinished("aborted")`); 04 반려 → 즉시 중단(rework 없음); resume 실패 → 새 세션 재시도 1회.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS.

### Task 4: 스킬 형식, 매니페스트, 문서

**Files:**
- Modify: `../plugin/skills/sdlc-intent/SKILL.md`, `slack/manifest.yaml`, `README.md`(runner), `../README.md`, `../docs/architecture.md`, `../plugin/.claude-plugin/plugin.json`(0.4.0), `../../README.md`(배지 0.4.0)

- [ ] **Step 1:** `sdlc-intent` 산출물 형식에 "`## 미해결 질문`은 한 줄에 질문 하나인 번호 목록, 없으면 `- 없음`"을 hard rule로. 러너(`claude -p`)로 실행될 때는 되묻지 말고 질문을 이 절에 남기라고 명시(답은 다음 실행에 "다음 답을 반영해"로 온다).
- [ ] **Step 2:** 매니페스트: 봇 스코프에 `channels:history`, `groups:history`, `users:read.email` 추가, `settings.event_subscriptions.bot_events: [message.channels, message.groups]` (빈 배열 제거).
- [ ] **Step 3:** README 3-C에 인터뷰 흐름(질문 → 답글 → [답변 반영]/[이대로 진행], 최대 5회)과 반려 재작업(01·02·03, 최대 3회) 표 추가, "기존 설치는 매니페스트를 다시 붙여 넣고 재설치" 한 줄, 설정 표에 `interviewMaxRounds`·`reworkMaxAttempts`. runner README·architecture.md에 같은 흐름 요약.

## Wave B

### Task 3: Slack 인터뷰 채널과 연결

**Files:**
- Create: `src/slack/interview.ts`, `test/slack-interview.test.ts`
- Modify: `src/slack/blocks.ts`(인터뷰 메시지 빌더·액션 ID), `src/slack/notifier.ts`(`stageReworking`, `interviewAnswered`), `src/slack/app.ts`(메시지 이벤트, 버튼 2개), `src/index.ts`(채널 생성·`runPipeline`에 전달)

**Interfaces:**
- Consumes: Task 1·2 전부, 기존 `threads.ts`, `SlackClientLike`.
- Produces:
  ```ts
  // blocks.ts
  ACTIONS.interviewApply = "sdlc_interview_apply"; ACTIONS.interviewProceed = "sdlc_interview_proceed";
  export function interviewMessage(i: { key: string; ticketId: string; questions: string[]; round: number; maxRounds: number;
    requesterId?: string; answerCount: number; state: "open" | "applied" | "proceeded"; by?: string }): Msg;
  // slack/interview.ts
  export interface InterviewState { round: number; questions: string[]; messageTs: string; threadTs: string; answers: Array<{ user: string; text: string; ts: string }> }
  export function createSlackInterviewChannel(o: { client: SlackClientLike & { users: { lookupByEmail(a: { email: string }): Promise<{ user?: { id?: string } }> } };
    channel: string; stateDir: string; getRequesterEmail: (key: string) => string | undefined; timeoutMs: number }):
    InterviewChannel & {
      onThreadMessage(m: { threadTs?: string; user?: string; botId?: string; subtype?: string; text: string; ts: string }): Promise<void>;
      onButton(key: string, action: "apply" | "proceed", userId: string): Promise<{ ok: boolean; message?: string }>;
    };
  ```
  `ask`는 스레드에 `interviewMessage`를 쓰고 `.state/<key>.interview.json`에 상태를 기록한 뒤, `onButton`이나 `timeoutMs`가 resolve할 Promise를 반환한다. `onThreadMessage`는 `threadTs`가 열린 인터뷰 스레드이고 `botId`·`subtype`이 없을 때만 답을 추가하고 메시지의 답변 수를 갱신한다. `apply`인데 답이 0개면 `proceed`. 진행 중인 `ask`가 없는 키의 버튼(러너 재시작) → `{ ok:false, message:"러너 재시작으로 이 실행은 중단됐다. /sdlc run <키> 로 다시 시작한다." }`.
- `app.ts`: `app.message`(또는 `app.event("message")`)를 `onThreadMessage`로, 두 버튼을 `onButton`으로(ack 먼저). 기동 시 필요한 스코프가 없으면(`auth.test` 응답 헤더 `x-oauth-scopes` 또는 `apps.permissions` 대신 간단히 첫 `lookupByEmail` 실패 코드 `missing_scope`) 경고 로그.
- `index.ts`: Slack이 켜지면 채널을 만들어 `runPipeline(..., events, interview)`로 전달, 아니면 `noInterview`. `getRequesterEmail`은 실행 시작 시 티켓의 `creatorEmail`을 키별로 기억해 제공.

- [ ] **Step 1: 실패하는 테스트** — 가짜 client로: `ask` → postMessage 1회(요청자 멘션 포함) + 상태 파일; 다른 스레드·봇·subtype 메시지 무시; 같은 스레드 답 2개 → 메시지 update에 "2"; `onButton("apply")` → `ask`가 `{kind:"answers", answers:[2개]}`로 resolve; 답 0개 apply → `proceed`; `lookupByEmail` 실패 → 멘션 없는 문구; 진행 중 ask 없는 키 → ok:false 문구; timeout → `{kind:"timeout"}`. notifier: `stageReworking` → 게이트 메시지가 "재작업 1/3" 문구로 갱신.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `npm test && npx tsc --noEmit` PASS.

### Task 5: 전체 리뷰

- [ ] 두 계획(Slack 봇, 인터뷰)의 브랜치 전체를 fresh reviewer가 두 스펙 대비 검토. 지적 수정 후 전체 테스트, 커밋.
