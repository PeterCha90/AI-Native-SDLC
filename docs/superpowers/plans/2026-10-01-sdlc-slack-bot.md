# AI-SDLC Slack 봇 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 러너를 팀별 셀프호스팅 Slack 봇으로 확장한다(Socket Mode, 티켓 생성 알림, `/sdlc`, 스레드 진행, 역할 확인 버튼 승인). 대시보드는 제거한다.

**Architecture:** 파이프라인은 `PipelineEvents`로 이벤트만 내고, Slack 알림기가 그것을 스레드 메시지로 바꾼다. Slack 버튼은 역할을 확인한 뒤 Linear 게이트 카드 상태를 바꾸고, 기존 `awaitApproval` 폴링이 그 변화를 읽는다. 새 티켓은 `LinearWatcher`가 폴링으로 찾는다.

**Tech Stack:** Node ≥ 22 (`--experimental-strip-types`), TypeScript, `node:test`, `@slack/bolt` (Socket Mode), Linear GraphQL.

**Spec:** `docs/superpowers/specs/2026-10-01-sdlc-slack-bot-design.md`

## Global Constraints

- 모든 경로는 `AI_SDLC/runner/` 기준. 테스트는 `test/*.test.ts`(하위 폴더 금지 — `npm test`의 glob이 최상위만 본다). 실행: `npm test`, 타입: `npx tsc --noEmit`.
- 새 런타임 의존성은 `@slack/bolt` 하나뿐.
- Slack 토큰(`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`) 중 하나라도 없으면 Slack 기능 전체가 꺼지고 기존 동작 그대로.
- 이벤트·Slack 호출 실패는 파이프라인을 멈추지 않는다(로그만).
- 사용자에게 보이는 문자열은 한국어, 코드 주석 밀도·명명은 기존 파일을 따른다.
- 병렬 작업 중에는 **커밋하지 않는다.** 오케스트레이터가 웨이브마다 커밋한다. 자기 Files 목록 밖의 파일은 수정하지 않는다.

## Review Focus

1. 같은 게이트 버튼을 두 사람이 거의 동시에 누름 → Linear 상태는 한 번만 바뀌고, 두 번째 사람은 "이미 승인됨" ephemeral을 받는다 (Task 6 `handleGateAction` 테스트).
2. 러너가 게이트 대기 중에 재시작된 뒤 옛 스레드 버튼을 누름 → 카드는 옮겨지고 "러너 재시작으로 중단, `/sdlc run <키>`로 다시 시작" 안내 (Task 6).
3. Linear 폴링이 실패하는 동안 생성된 티켓 → 다음 성공 폴링에서 빠짐없이 한 번만 알림 (Task 4, 커서 유지 테스트).
4. `/sdlc <제목>`으로 만든 티켓 → 워처가 같은 티켓을 다시 알리지 않음 (Task 4 `markSeen` + Task 6).
5. 역할 그룹 멤버 조회 API 실패 → 승인을 막고(열어 주지 않고) ephemeral로 실패를 알림 (Task 3 `RoleChecker` 테스트).

---

## Wave 1 (Task 1–5 병렬)

### Task 1: 이벤트 인터페이스, 상태 모듈 분리, 대시보드 제거

**Files:**
- Create: `src/state.ts`, `src/events.ts`, `test/events.test.ts`
- Modify: `src/pipeline.ts`, `src/index.ts`, `package.json`(scripts만), `tsconfig.json`(scripts 포함 제거), `.gitignore`(`.state-demo/` 제거)
- Delete: `src/dashboard.ts`, `src/dashboard-routes.ts`, `src/dashboard-server.ts`, `src/dashboard.html`, `scripts/seed-demo-state.ts`, `test/dashboard.test.ts`

**Interfaces:**
- Produces (`src/state.ts`): `StageLogEntry`, `LiveStatus`, `RunMeta`를 `dashboard.ts`에서 그대로 옮김. 그리고
  `listActiveRuns(stateDir: string): Promise<Array<{ meta: RunMeta; live: LiveStatus }>>` — `live.phase`가 `"running" | "waiting"`인 실행만, `live.since` 최신순. 깨진 파일은 건너뜀.
- Produces (`src/events.ts`):
  ```ts
  export interface PipelineEvents {
    runStarted(meta: RunMeta): Promise<void>;
    stageStarted(key: string, stage: string): Promise<void>;
    stageFinished(key: string, stage: string, ok: boolean, durationMs: number, note?: string): Promise<void>;
    gateWaiting(key: string, stage: StageId, role: string, gate: GateRef, summary: string): Promise<void>;
    gateResolved(key: string, stage: StageId, approved: boolean, reason?: string): Promise<void>;
    followupCreated(key: string, followup: { key: string; url: string }): Promise<void>;
    runFinished(key: string, outcome: "done" | "aborted"): Promise<void>;
  }
  export const noopEvents: PipelineEvents;
  /** 각 호출을 try/catch로 감싸 실패를 로그만 하는 래퍼. pipeline은 항상 이걸 거쳐 호출한다. */
  export function safeEvents(inner: PipelineEvents, log?: (m: string) => void): PipelineEvents;
  ```
- Produces (`src/pipeline.ts`): `runPipeline(ticket, config, source, runnerDir, events: PipelineEvents = noopEvents): Promise<void>`

- [ ] **Step 1: 실패하는 테스트** `test/events.test.ts`
  - `safeEvents`: inner가 throw해도 `await ev.stageStarted("K","01-intent")`가 reject하지 않고 log가 1회 호출됨.
  - `listActiveRuns`: 임시 폴더에 `A.meta.json`+`A.live.json`(phase `waiting`), `B`(phase `done`), `C.live.json` 깨진 JSON → 결과 키 `["A"]`.
  - 파이프라인 이벤트 순서: `test/pipeline-e2e.test.ts`의 기존 가짜 러너 구성을 재사용해 `autoApprove` 실행 시 기록된 이벤트 이름 순서가 `runStarted`로 시작해 `runFinished`로 끝나고, 각 `stageStarted` 뒤에 같은 stage의 `stageFinished`가 온다.
- [ ] **Step 2:** `npm test` → 새 테스트 FAIL 확인.
- [ ] **Step 3: 구현.** `writeMeta` 직후 `runStarted`, `runAndLog` 시작/끝에 `stageStarted`/`stageFinished`, `gate()`에서 대기 전 `gateWaiting`(요약은 이미 만드는 summary 문자열), 판정 후 `gateResolved`, 후속 티켓을 알게 되는 지점(`createTicket` 폴백 포함)에서 `followupCreated`, `aborted`/`done` 라이브 기록 지점에서 `runFinished`. `index.ts`에서 `GET /`, `GET /api/runs`와 대시보드 로그 줄 제거(기동 로그에는 헬스체크 URL만). `package.json`의 `seed:demo`, `dashboard:*` 스크립트 제거.
- [ ] **Step 4:** `npm test && npx tsc --noEmit` → 전부 PASS, `grep -rn dashboard src test` 결과 없음.

### Task 2: 어댑터 확장 (Linear 상태 변경, 최근 이슈, 키로 조회)

**Files:**
- Modify: `src/adapters/types.ts`, `src/adapters/linear.ts`, `src/adapters/jira.ts`
- Test: `test/linear.test.ts`(추가)

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export interface RecentIssue extends Ticket { createdAt: string; creator: string; }
  // TicketSource 에 추가
  setStateType(issueId: string, type: "completed" | "canceled"): Promise<void>;
  listRecentIssues(sinceIso: string): Promise<RecentIssue[]>;   // 부모 없는 이슈만, createdAt 오름차순, 최대 50
  getTicket(idOrKey: string): Promise<Ticket>;                    // "ENG-12" 또는 UUID
  ```
- Linear: `setStateType`은 `issue(id){ team { states(filter:{type:{eq:$type}}) { nodes { id position } } } }`에서 `position`이 가장 작은 상태로 `issueUpdate(id, input:{stateId})`. 해당 타입 상태가 없으면 `Error("팀 워크플로에 <type> 상태가 없다")`. `listRecentIssues`는 `issues(first:50, filter:{ team:{id:{eq:teamId}}, createdAt:{gt:since}, parent:{null:true} })` 후 클라이언트에서 오름차순 정렬. `getTicket`은 `issue(id:$idOrKey)`.
- Jira: 세 메서드 모두 기존 스텁과 같은 방식(“not implemented” + 어떤 REST 호출인지 주석).

- [ ] **Step 1: 실패하는 테스트** — 기존 `linear.test.ts`의 fetch 목 패턴으로:
  - `setStateType("I1","completed")`: 두 번째 요청 body의 `variables.input.stateId`가 position 최소 상태의 id.
  - 상태 없음 → reject, 메시지에 `completed` 포함.
  - `listRecentIssues`: 응답이 내림차순이어도 결과는 `createdAt` 오름차순, `creator`는 `creator.name`.
  - `getTicket("ENG-12")`: 요청 `variables.id === "ENG-12"`, 결과 `key === "ENG-12"`.
- [ ] **Step 2:** FAIL 확인 → **Step 3:** 구현 → **Step 4:** `npm test && npx tsc --noEmit` PASS.

### Task 3: Slack 순수 모듈 (메시지 블록, 역할 확인, 스레드 저장)

**Files:**
- Create: `src/slack/blocks.ts`, `src/slack/roles.ts`, `src/slack/threads.ts`
- Test: `test/slack-blocks.test.ts`, `test/slack-roles.test.ts`, `test/slack-threads.test.ts`

**Interfaces:**
- `blocks.ts` (모두 `{ text: string; blocks: unknown[] }` 반환, Slack API 호출 없음):
  ```ts
  export const ACTIONS = { start: "sdlc_start", ignore: "sdlc_ignore", approve: "sdlc_approve", reject: "sdlc_reject" } as const;
  export const REJECT_MODAL = "sdlc_reject_modal";
  export interface ActionValue { key: string; ticketId: string; stage?: StageId }   // 버튼 value = JSON.stringify
  export function stageLabel(stage: string): string;   // "01-intent"→"01 Plan", "03-build"→"03 Build", "gate:04-test"→"04 Test", 모르면 원문
  export function ticketNotice(t: { key: string; title: string; url: string; creator?: string; labels: string[]; ticketId: string },
    o: { state: "new" | "started" | "ignored" | "auto"; by?: string; parentKey?: string; depth?: number }): Msg;
  export function stageLine(stage: string, status: "running" | "ok" | "failed", durationMs?: number, note?: string): Msg;
  export function gateMessage(g: { key: string; ticketId: string; stage: StageId; role: string; roleGroupId?: string; summary: string; gateUrl: string;
    state: "waiting" | "approved" | "rejected" | "timeout"; by?: string; reason?: string }): Msg;
  export function rejectModal(v: ActionValue): unknown;   // callback_id = REJECT_MODAL, private_metadata = JSON(v), 사유 입력 1개(block_id "reason", action_id "reason")
  export function followupLine(f: { key: string; url: string }): Msg;
  export function runFinishedLine(outcome: "done" | "aborted"): Msg;
  ```
  문구: 알림 `🆕 *<url|KEY>* 제목`, 버튼 `▶ 파이프라인 시작`/`무시`; 시작 후 `▶ 시작함 (by <@U>)`; 게이트 대기 `🔔 <!subteam^GID> 승인 필요 — 01 Plan` (그룹 없으면 역할 이름), 버튼 `✅ 승인`/`⛔ 반려`; 승인 후 `✅ <@U> 승인` 또는 `✅ Linear에서 승인`; 반려 `⛔ 반려: 사유`; 요약은 2900자에서 자른다(섹션 한도).
- `roles.ts`:
  ```ts
  export class RoleChecker {
    constructor(o: { roleGroups: Record<string, string>; listMembers: (groupId: string) => Promise<string[]>; ttlMs?: number; now?: () => number });
    canAct(role: string, userId: string): Promise<{ ok: true } | { ok: false; groupId: string; error?: string }>;
    unrestrictedRoles(roles: string[]): string[];
  }
  ```
  `ttlMs` 기본 60000. 조회 실패 → `{ ok:false, groupId, error }` (닫힌 채 실패).
- `threads.ts`:
  ```ts
  export interface ThreadRecord { channel: string; threadTs: string; ticketId: string; stageTs: Record<string, string>; gateTs: Partial<Record<StageId, string>>; gateResolvedBy: Partial<Record<StageId, string>> }
  export function threadPath(stateDir: string, key: string): string;   // <stateDir>/<key>.slack.json
  export async function readThread(stateDir: string, key: string): Promise<ThreadRecord | null>;
  export async function writeThread(stateDir: string, key: string, rec: ThreadRecord): Promise<void>;
  ```

- [ ] **Step 1: 실패하는 테스트**
  - blocks: `ticketNotice(state:"new")`의 actions 요소 `action_id`가 `["sdlc_start","sdlc_ignore"]`이고 value를 파싱하면 `{key,ticketId}`; `state:"started"`면 actions 블록 없음; `gateMessage(waiting, roleGroupId:"S1")`의 텍스트에 `<!subteam^S1>`; 3000자 summary → 섹션 text 길이 ≤ 3000; `stageLabel("gate:04-test")==="04 Test"`.
  - roles: 매핑 없는 역할 → ok; 멤버 → ok; 비멤버 → `{ok:false, groupId:"S1"}`; 60초 안 두 번 호출 시 `listMembers` 1회, 61초 뒤 2회; `listMembers` reject → ok:false + error.
  - threads: 쓰고 읽으면 같은 객체, 없는 키 → null, 깨진 JSON → null.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** `npm test && npx tsc --noEmit` PASS.

### Task 4: LinearWatcher

**Files:**
- Create: `src/linear-watcher.ts`, `test/linear-watcher.test.ts`

**Interfaces:**
- Consumes: `RecentIssue`, `TicketSource["listRecentIssues"]` (Task 2).
- Produces:
  ```ts
  export interface WatchState { cursor: string; seen: string[] }   // seen 최대 500개, 오래된 것부터 버림
  export class LinearWatcher {
    constructor(o: { listRecentIssues: (since: string) => Promise<RecentIssue[]>; statePath: string; intervalMs: number;
      onNew: (t: RecentIssue) => Promise<void>; now?: () => Date; log?: (m: string) => void });
    poll(): Promise<number>;          // 알린 개수
    markSeen(id: string): Promise<void>;
    start(): void; stop(): void;
  }
  ```
  상태 파일이 없으면 첫 `poll()`은 커서를 `now()`로 저장하고 0 반환. 조회 실패 → 로그, 커서 유지, 0 반환. `onNew` 실패 → 로그하고 본 것으로 처리(스팸 방지). 성공 시 커서 = 받은 이슈의 최대 `createdAt`.

- [ ] **Step 1: 실패하는 테스트** — 첫 폴 0개·커서=now; 두 번째 폴에 이슈 2개 → onNew 2회, 커서=최대 createdAt; 같은 이슈 재등장 → 0; 조회 throw → 커서 불변, 다음 폴에서 그 사이 이슈 알림; `markSeen("X")` 후 X 등장 → 알리지 않음; seen 501개 → 파일에 500개.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS.

### Task 5: 문서, 플러그인, Slack 매니페스트

**Files:**
- Create: `slack/manifest.yaml`
- Delete: `../plugin/commands/sdlc-visualize.md`, `../docs/assets/dashboard.png`
- Modify: `../plugin/commands/sdlc-status.md`, `../plugin/README.md`, `../plugin/.claude-plugin/plugin.json`(version `0.3.0`), `README.md`(runner), `../README.md`, `../docs/architecture.md`, `../docs/demo-scenario.md`, `../../README.md`, `../../USAGE.md`

**Interfaces (문서가 쓸 정확한 이름):** 환경변수 `SLACK_BOT_TOKEN`(xoxb), `SLACK_APP_TOKEN`(xapp, `connections:write`). `sdlc.config.json`:
```json
"linearTrigger": "poll", "linearPollIntervalMs": 30000,
"slack": { "channelId": "C…", "startMode": "button", "roleGroups": { "Product Owner": "S…" } }
```
`linearTrigger` 기본값: Slack이 켜지면 `"poll"`, 아니면 `"webhook"`. `poll`이면 `LINEAR_WEBHOOK_SECRET` 불필요. 명령 `/sdlc <제목>`, `/sdlc run ENG-12`, `/sdlc status`, `/sdlc help`.

- [ ] **Step 1:** `slack/manifest.yaml` — `display_information.name: AI-SDLC`, `features.bot_user`, 슬래시 명령 `/sdlc`(usage_hint `<제목> | run <키> | status | help`), `oauth_config.scopes.bot: [chat:write, commands, usergroups:read, users:read]`, `settings: { socket_mode_enabled: true, interactivity: { is_enabled: true }, org_deploy_enabled: false }`.
- [ ] **Step 2:** 대시보드 언급을 "Linear 원 티켓의 게이트 하위 이슈 + Slack 스레드"로 교체(`grep -rni "dashboard\|대시보드"`가 intent.md·specs 외 0건). `sdlc-status.md`는 대시보드 대신 Linear 원 티켓 링크 안내. `plugin/README.md` 명령 3개로.
- [ ] **Step 3:** `AI_SDLC/README.md`에 "3-C. Slack으로 쓰기" 절(neat-readme 스타일, 표 위주): ① api.slack.com/apps → Create New App → From a manifest → `runner/slack/manifest.yaml` 붙여넣기 ② Install to Workspace → Bot Token ③ Basic Information → App-Level Token(`connections:write`) ④ 채널에 `/invite @AI-SDLC`, 채널 ID ⑤ 사용자 그룹 ID 찾기(그룹 프로필 URL 끝 `S…`) ⑥ 설정·환경변수 ⑦ `npm start` ⑧ 사용법 표(알림·버튼·명령) ⑨ "봇이 들어간 채널 멤버 = 파이프라인을 시작할 수 있는 사람" 경고. 맨 위 대시보드 이미지를 Slack 스레드 텍스트 예시(펜스 블록)로 교체, 두 사용법 표에 **C. Slack** 행 추가, 트러블슈팅에 `not_in_channel`, 버튼 무반응(Socket 끊김·러너 꺼짐) 행 추가.
- [ ] **Step 4:** `USAGE.md`에서 삭제된 `slides/` 1장과 표 행 제거, 절 번호 재정렬, Slack 절은 README 링크로. 루트 README 버전 배지 `0.3.0`.
- [ ] **Step 5:** 링크 확인: `grep -rn "sdlc-visualize\|dashboard.png\|slides/" ../.. --include=*.md | grep -v specs | grep -v plans` 결과 0건.

---

## Wave 2

### Task 6: Slack 앱, 알림기, 설정, 기동 연결

**Files:**
- Create: `src/slack/notifier.ts`, `src/slack/app.ts`, `test/slack-actions.test.ts`, `test/config.test.ts`
- Modify: `src/config.ts`, `src/index.ts`, `package.json`(`@slack/bolt` 의존성), `sdlc.config.json`(`linearTrigger` 생략, `slack` 예시는 넣지 않음 — 문서에만)

**Interfaces:**
- Consumes: Task 1 `PipelineEvents`, `safeEvents`, `listActiveRuns`, `runPipeline(..., events)`; Task 2 `setStateType`, `listRecentIssues`, `getTicket`, `createTicket`, `comment`; Task 3 전부; Task 4 `LinearWatcher`; 기존 `readGateMap`, `classifyState`.
- `config.ts`: `FileConfig`에 `linearTrigger?`, `linearPollIntervalMs?`(기본 30000), `slack?: { channelId: string; startMode?: "button" | "auto"; roleGroups?: Record<string,string> }`. `Config.slack: null | { botToken; appToken; channelId; startMode; roleGroups }` — 토큰 둘과 `channelId`가 모두 있을 때만 non-null. `Config.linearTrigger`. `LINEAR_WEBHOOK_SECRET` 필수 조건: `linearTrigger === "webhook"`.
- `notifier.ts`:
  ```ts
  export interface SlackClientLike { chat: { postMessage(a: object): Promise<{ ts?: string }>; update(a: object): Promise<unknown>; postEphemeral(a: object): Promise<unknown> } }
  export function createSlackNotifier(o: { client: SlackClientLike; channel: string; stateDir: string; roleGroups: Record<string, string> }):
    PipelineEvents & { postTicketNotice(t: RecentIssue, state: "new" | "auto"): Promise<void>; markStarted(key: string, by: string): Promise<void> };
  ```
  알림 메시지 ts가 스레드 루트가 된다(`threads.ts`에 기록). 스레드가 없는 키의 이벤트(웹훅으로 시작된 실행)는 첫 이벤트에서 알림을 만들고 이어 간다. `gateWaiting`은 `reply_broadcast: true`. `gateResolved`는 `gateResolvedBy[stage]`가 이미 있으면 메시지를 다시 쓰지 않는다.
- `app.ts`:
  ```ts
  export interface GateActionDeps { source: TicketSource; roles: RoleChecker; stateDir: string; runnerDir: string; isRunActive: (key: string) => boolean; gateRoles: Record<StageId, string> }
  export async function handleGateAction(a: { userId: string; key: string; stage: StageId; approved: boolean; reason?: string }, d: GateActionDeps):
    Promise<{ ok: true; note?: string } | { ok: false; message: string }>;
  export function parseSdlcCommand(text: string): { kind: "create"; title: string } | { kind: "run"; key: string } | { kind: "status" } | { kind: "help" };
  export async function startSlackApp(o: { config: Config; source: TicketSource; stateDir: string; runnerDir: string;
    enqueue: (t: Ticket) => number /* 대기열 위치 */; isRunActive: (key: string) => boolean }): Promise<{ notifier: ReturnType<typeof createSlackNotifier>; stop(): Promise<void> }>;
  ```
  `handleGateAction` 순서: 역할 확인 → 게이트 맵 읽기 → 현재 상태 `classifyState(getStateType)`가 pending이 아니면 `{ok:false, message:"이미 승인됨|반려됨"}` → 반려면 사유 코멘트 먼저 → 승인이면 `"Slack에서 <이름> 승인"` 코멘트 → `setStateType` → `isRunActive(key)`가 false면 `note: "러너 재시작으로 이 실행은 중단됐다. /sdlc run <키> 로 다시 시작한다."`.
- `index.ts`: `Queue`에 `size` 노출, `enqueue` 반환값 = 대기열 위치. `activeKeys` Set으로 `isRunActive`. `config.slack`이면 `startSlackApp`, 그 `notifier`를 `safeEvents`로 감싸 `runPipeline`에 전달. `linearTrigger === "poll"`이면 `LinearWatcher`(statePath `.state/linear-watch.json`) → `notifier.postTicketNotice(t, startMode === "auto" ? "auto" : "new")`, auto면 즉시 enqueue. 기동 로그: Slack 연결/채널/폴링 주기/제한 없는 역할 목록. `chat.postMessage` 기동 확인 실패 `not_in_channel` → "봇을 채널에 초대하라: /invite @AI-SDLC".

- [ ] **Step 1: 실패하는 테스트**
  - `config.test.ts`: 토큰 없음 → `slack === null`, `linearTrigger === "webhook"`, webhook secret 없으면 exit(기존 `fail` 동작을 `process.exit` 목으로 확인); 토큰+channelId → `linearTrigger === "poll"`, webhook secret 없어도 통과.
  - `slack-actions.test.ts` (가짜 source·roles·게이트 맵 파일): 권한 없음 → `setStateType` 0회; pending 승인 → 코멘트 후 `setStateType("gate-uuid","completed")`; 이미 completed → ok:false "이미 승인됨", `setStateType` 0회; 반려 → 사유 코멘트가 `setStateType("…","canceled")`보다 먼저; `isRunActive=false` → note에 `/sdlc run`; 게이트 맵 없음 → ok:false. `parseSdlcCommand("run ENG-12")`, `("status")`, `("")`→help, `("결제 버그")`→create.
  - 알림기: 가짜 client로 `postTicketNotice` → `postMessage` 1회 + 스레드 파일 생성; `stageStarted` 후 `stageFinished` → 같은 ts로 `update`; `gateWaiting`에 `reply_broadcast: true`.
- [ ] **Step 2:** FAIL → **Step 3:** `npm i @slack/bolt` 후 구현 → **Step 4:** `npm test && npx tsc --noEmit` PASS, `SLACK_*` 없이 `npm start`가 기존처럼 기동(웹훅 모드)하는지 확인.

### Task 7: 전체 리뷰

- [ ] 브랜치 전체 diff를 fresh reviewer가 스펙 대비 검토(Review Focus 5개 포함). 지적 수정 후 `npm test && npx tsc --noEmit`, 커밋.
