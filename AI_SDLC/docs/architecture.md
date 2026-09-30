# Architecture

## 1. 파이프라인 전체 흐름

Linear 티켓이 들어오면 `00 setup`이 승인 게이트용 Linear 하위 이슈 6개를 만든 뒤 6단계(01 intent ~ 06 maintain)가 순차로 실행된다. 각 단계 앞뒤에는 사람이 그 하위 이슈를 Done/Canceled로 옮길 때까지 파이프라인이 멈추는 승인 게이트가 있다(§2). 04 test에서 실패가 나거나 06 maintain이 σ-tier 이탈을 감지하면 새 Linear 티켓이 자동으로 만들어져 01로 되돌아간다. `SDLC_AUTO_APPROVE=1`을 주면 00 setup과 모든 게이트를 건너뛰는 리허설 모드가 된다.

```
 Linear 티켓 (사람이 작성, 또는 06이 자동 생성 — 라벨 sdlc-auto, sdlc-depth:N)
        │
        │ webhook
        ▼
 ticket-source adapter   verify() → parse() → 공통 Ticket
        │                (adapters/linear.ts, jira.ts 등으로 교체 가능)
        ▼
 local runner (Node 데몬)
        │  단계마다 claude -p 헤드리스 세션을 순차 실행한다(--plugin-dir plugin/ 으로
        │  skills/hooks/subagents를 그 세션에만 로드한다).
        │  부수 효과: ~/.claude/projects/<project>/<session-id>.jsonl 이 단계마다 생성되고,
        │  runner/.state/ 아래 단계 로그·게이트 맵·상태 파일이 갱신된다 — Linear 원 티켓의
        │  게이트 하위 이슈와(Slack이 켜져 있으면) 티켓 스레드가 이 상태를 보여준다.
        ▼
 ┌────────────────────────────────────────────────────────────┐
 │ 00 setup — Linear MCP로 승인 게이트 하위 이슈 6개 생성        │
 │            runner/.state/<key>.gates.json 에 매핑을 기록      │
 │            (SDLC_AUTO_APPROVE=1 이면 이 단계 자체를 건너뛴다) │
 └───────────────────────────────┬───────────────────────────────┘
                                  ▼
 ┌────────────┐         ┌────────────┐         ┌────────────┐
 │ 01 intent  │─[게이트]▶│ 02 spec    │─[게이트]▶│ 03 plan    │
 │ sdlc-intent│ 01-plan │ sdlc-spec  │02-design│ sdlc-plan  │
 │            │  (PO)   │            │  (PO)   │(코드 미변경)│
 └────────────┘         └────────────┘         └──────┬─────┘
                                                        │ [게이트 03-build · Engineer]
                                                        ▼
 ┌────────────┐         ┌────────────┐         ┌────────────┐
 │ 03 build   │────────▶│ 04 test    │─[게이트]▶│ 05 deploy  │
 │ (구현,     │         │ sdlc-test  │ 04-test │ sdlc-review│
 │ plan-drift │         │ +unit/e2e  │  (CO)   │ +PR 생성   │
 │ 훅 적용)   │         └──────┬─────┘         └──────┬─────┘
 └────────────┘                │ 실패                  │ [게이트 05-deploy · Release
                                │                       │  Manager, PR 생성 성공 시만]
                                └────────────────▶┌────────────┐
                                                   │ 06 maintain│
                                                   │ ops/detect │
                                                   │ →sdlc-maintain(2σ/3σ만)│
                                                   └──────┬─────┘
                                                          │ [게이트 06-maintain · Service Owner,
                                                          │  tier와 무관하게 항상 호출]
        ┌─────────────────────────────────────────────────┘
        │  3σ이고 depth < maxAutoTicketDepth일 때만:
        │  createTicket() — labels:["sdlc-auto"], body에 sdlc-depth:N+1 기록
        ▼
 Linear 티켓 (신규, 01 intent로 회귀 → 루프가 닫힌다)
```

04 test 실패는 05 deploy를 건너뛰고 바로 06 maintain으로 넘어간다(위 다이어그램의 "실패" 화살표). 05 deploy에서 PR 생성 자체가 실패해도(`useWorktree=false`가 아닌 한) 게이트를 열지 않고 곧장 06으로 넘어간다. 어느 경로든 신규 티켓은 같은 `createTicket()` 한 곳으로 모인다.

파이프라인은 헤드리스 세션마다 `--plugin-dir`로 플러그인을 명시적으로 로드하지만, 사람이 `todo-app/` 안에서 대화형 Claude Code를 직접 열 때도 같은 플러그인이 자동으로 붙는다 — `todo-app/.claude/settings.json`이 로컬 마켓플레이스 `ai-sdlc-local`(`AI_SDLC/.claude-plugin/marketplace.json`, source kind `directory`, path `..`)을 통해 `ai-native-sdlc` 플러그인을 활성화해둔다. 별도 설치 없이 시연 중 수동 개입에도 동일한 skills/hooks가 걸린다.

## 2. 승인 게이트 프로토콜

00 setup이 만든 하위 이슈 6개가 각 단계의 게이트다. `gate.ts`가 그 상태를 읽어 다음 단계 진행 여부를 결정하며, 판정 자체(`classifyState`)는 모델이 관여하지 않는 순수 함수다.

| Linear 워크플로 상태 타입(`StateType`) | 판정 | 파이프라인 동작 |
| --- | --- | --- |
| `completed` (Done류) | approved | 다음 단계로 진행 |
| `canceled` (Canceled류) | rejected | 파이프라인 즉시 중단. 그 하위 이슈에 남은 최신 코멘트를 반려 사유로 로그에 남긴다 |
| 그 외(`triage`/`backlog`/`unstarted`/`started`) | pending | `gatePollIntervalMs`(기본 10초)마다 재조회. `gateTimeoutMs`(기본 30분) 안에 결정이 안 나면 타임아웃으로 반려 처리하고 파이프라인을 중단한다(**01 Plan 인터뷰의 타임아웃은 정반대다 — §2.1 참고**) |

게이트별 승인자 역할은 `sdlc.config.json`의 `gateRoles`에서 온다.

| 게이트 | 승인자 | 열리는 시점 |
| --- | --- | --- |
| `01-plan` | Product Owner | 01 intent 완료 직후 |
| `02-design` | Product Owner | 02 spec 완료 직후 |
| `03-build` | Engineer | 03 plan(코드 미변경) 완료 직후 — 승인돼야 실제 코드 편집이 시작된다 |
| `04-test` | Code Owner | 04 test 피드백 루프 + unit/e2e 결과 확인 후 |
| `05-deploy` | Release Manager | PR 생성 성공 후에만 (실패하면 이 게이트를 열지 않고 06으로 진행) |
| `06-maintain` | Service Owner | 06 maintain 판정 완료 후, tier와 무관하게 항상 |

- 게이트 맵은 `runner/.state/<ticket-key>.gates.json`에 저장된다. 00 setup이 이 파일을 만들지 못했거나 형식이 깨져 있으면 `readGateMap`이 에러를 던지고 파이프라인은 그 자리에서 중단된다 — 게이트 없이 조용히 6단계를 통과시키는 상황을 원천 차단하는 설계다.
- `SDLC_AUTO_APPROVE=1`이면 00 setup 자체를 실행하지 않고 모든 게이트를 즉시 승인 처리하며, 매번 "리허설 모드"라고 로그에 남긴다.
- 게이트 대기에 들어가기 전, 해당 하위 이슈에 리뷰용 요약(단계 산출물 경로, 테스트 결과, PR diff 요약 등)이 먼저 코멘트로 남는다 — 승인자는 카드를 열어보는 것만으로 판단 근거를 얻는다.

### 2.1 01 Plan 인터뷰 루프

01 intent가 `## 미해결 질문`을 남긴 채 끝나면(형식은 `sdlc-intent` 스킬이 hard rule로 고정한다 — 번호 목록 또는
`- 없음`), 러너는 `01-plan` 게이트를 바로 열지 않고 `InterviewChannel.ask(questions, round)`로 요청자에게
되묻는다. Slack에서는 스레드에 번호 목록과 `[답변 반영]`/`[이대로 진행]` 버튼이 올라가고, 참여자 답글을
`.state/<key>.interview.json`에 모은다. `[답변 반영]`이면 모은 답을 Linear 원 티켓에 코멘트로 남기고
`claude -p --resume <01 세션>`으로 intent.md를 다시 쓴 뒤 `## 미해결 질문`을 다시 파싱한다 — 질문이 없어질
때까지, 또는 `interviewMaxRounds`(기본 5)에 도달할 때까지 반복한다. `[이대로 진행]`이나 라운드 상한 도달은
남은 질문을 미해결로 둔 채 게이트로 넘어간다. Slack이 꺼져 있거나 webhook 모드면 `noInterview` 구현이 즉시
`proceed`를 반환해 지금과 같이 인터뷰 없이 게이트로 간다.

`[답변 반영]`/`[이대로 진행]`은 역할 제한이 없다 — `gateRoles`/`roleGroups`로 승인자를 확인하는 게이트의
`[✅ 승인]`/`[⛔ 반려]`와 달리, 인터뷰는 승인이 아니므로 스레드 참여자 누구나 누를 수 있다.

**타임아웃은 게이트와 반대 방향이다.** §2의 일반 게이트는 `gateTimeoutMs` 안에 결정이 안 나면 타임아웃을
반려로 취급해 파이프라인을 중단한다. `InterviewOutcome`의 `timeout`(아무도 `gateTimeoutMs` 동안 답하지도
버튼을 누르지도 않은 경우)은 그 반대로 `[이대로 진행]`과 같게 처리된다 — 남은 질문을 미해결로 둔 채 그대로
`01-plan` 게이트로 **진행**한다. 인터뷰는 사람이 막연히 답을 미루는 것만으로 파이프라인 전체가 멈추면 안
된다는 설계다(최종 판단은 어차피 뒤이은 PO 게이트가 한다).

### 2.2 반려 후 재작업 (01·02·03)

`01-plan`·`02-design`·`03-build` 게이트가 반려되면(Slack 모달 사유 또는 Linear Canceled + 코멘트), 파이프라인은
멈추지 않고 그 단계를 반려 사유를 반영해 다시 돈다: 재작업 횟수가 `reworkMaxAttempts`(기본 3) 미만이면
`claude -p --resume <그 단계 세션>`에 "반려 사유: … 반영해 고쳐라"를 넣어 재실행하고, 어댑터의 `setStateType`으로
게이트 하위 이슈를 `unstarted`로 되돌린 뒤 "재작업 N/3" 코멘트를 남기고 다시 대기한다(01이면 인터뷰 루프도
다시 탄다). 상한에 도달하면 지금처럼 파이프라인을 중단한다. **04-test·05-deploy·06-maintain 반려는 재작업하지
않는다** — 코드/릴리스 단계의 반려는 그 자리에서 멈추고, 코드를 다시 짜야 하는 반려는 새 티켓으로 처리한다.

## 3. 단계별 입출력 아티팩트

| 단계 | 스킬/도구 | 입력 | 출력 | 게이트 | 실행 방식 |
| --- | --- | --- | --- | --- | --- |
| 00 setup | Linear MCP 직접 호출(스킬 없음) | 티켓 | `runner/.state/<key>.gates.json` (하위 이슈 6개) | 없음(게이트를 만드는 단계) | `claude -p`(`Write`, `mcp__linear__*`) |
| 01 intent | `sdlc-intent` | 티켓(title, body, labels) | `docs/intent/<id>.md` | `01-plan` | `claude -p` |
| 02 spec | `sdlc-spec` | `docs/intent/<id>.md` | `docs/spec/<id>.md` | `02-design` | `claude -p` |
| 03 plan | `sdlc-plan` | `docs/spec/<id>.md` | `docs/plan/<id>.md`(코드 미변경) | `03-build` | `claude -p` |
| 03 build | 스킬 없음, 승인된 plan.md를 순서대로 구현 | `docs/plan/<id>.md` | 코드 diff(`plan-drift` 훅 적용) | 없음 | `claude -p` |
| 04 test | `sdlc-test`(화면 변경 시 `sdlc-e2e`에 위임) | 코드 diff, plan.md 성공 기준 | 통과할 때까지 수정한 루프 결과 + unit(`npm test`)/e2e(`npm run e2e`, ego-lite) 결과 | `04-test` | `claude -p` + 러너가 직접 실행하는 테스트 명령과 `runE2E` |
| 05 deploy | `sdlc-review` | 통과한 코드 diff, `docs/spec/<id>.md` | 리뷰 리포트(승인 아님, 발견만) + PR(`gh pr create`) | `05-deploy`(PR 생성 성공 시만) | `claude -p` + `gh` CLI |
| 06 maintain | `sdlc-maintain`(2σ/3σ일 때만 호출) | `ops/detect.sh` 판정, 04/05 결과 요약 | 로그만(1σ) / 읽기전용 진단(2σ) / `docs/intent/<new-id>.md` + 신규 Linear 티켓(3σ, depth < 상한일 때만) | `06-maintain` | `ops/detect.sh`(결정론) + `claude -p`(2σ·3σ만) |

**여섯 단계는 모두 같은 작업 디렉터리에서 돈다.** `useWorktree: true`이면 러너는 01 intent보다 **먼저** worktree를 만들고(`prepareWorkDir`), 문서(`docs/intent|spec|plan/`)와 코드를 그 한 체크아웃 안에서 함께 만든다. 이건 정리 취향이 아니라 정확성 문제다 — `plan-drift.sh`와 `verify-before-done.sh`는 `docs/plan/*.md`를 **자기 cwd 기준**으로 찾기 때문에, 문서가 `repoPath`에 있고 빌드 단계가 worktree에서 돌면 두 훅이 계획 파일을 못 찾고 fail-open으로 통과해버린다(= 기본 설정에서 조용히 무력화). 부수 효과로 PR이 intent/spec/plan을 코드 diff와 함께 담는다. `repoPath`가 git 최상위의 하위 디렉터리면 그 상대 경로를 worktree 안에서 그대로 재현하고, `git rev-parse`나 `git worktree add`가 실패하면 파이프라인을 중단한다(에러 텍스트를 경로로 오인해 엉뚱한 디렉터리에서 도는 것을 막는다).

모든 `claude -p` 호출과 각 게이트 판정은 `runner/.state/<key>.json`에 시작/종료 시각, 성공 여부, 세션 jsonl 경로를 이어붙인다. 이 상태 로그는 파이프라인이 소비하는 아티팩트가 아니지만, `/sdlc-status`와 Slack 알림이 읽는 원본이다 — `runner/.state/` 아래 단계 로그·게이트 맵·라이브 상태·메타 파일을 읽어 현재 단계와 대기 역할을 보여준다. 세션 jsonl 경로는 "세션 로그"로 계속 남아 디버깅용으로만 쓰인다.

`intent.md`가 요구한 "zoetrope로 시각화"는 Linear 원 티켓 아래 게이트 하위 이슈 6개와, Slack이 켜져 있다면 티켓 스레드가 대신한다. zoetrope는 세션 하나의 내부(도구 호출, 서브에이전트 트리)만 보여줄 뿐, 여러 단계에 걸친 흐름·대기 중인 게이트·06→01 재귀 루프처럼 파이프라인 수준의 상태는 애초에 표현할 수 없다. 초기 버전은 러너 자신이 대시보드(`GET /`)를 띄워 이 세 가지(단계 간 흐름, 게이트 대기, 신규 티켓 루프)를 그렸지만, 같은 정보가 이미 Linear 게이트 카드와 Slack 스레드 두 곳에 보이므로 세 번째 화면을 없앴다.

## 4. ticket-source 어댑터

트리거 소스를 바꿀 수 있어야 한다는 요구에 따라, 티켓 시스템에 의존하는 부분은 `adapters/types.ts`의 인터페이스 하나로 격리한다. 승인 게이트가 생기면서 세 메서드(`createSubIssue`, `getStateType`, `listComments`)가 추가됐다 — 게이트가 Linear의 워크플로 상태와 코멘트를 직접 읽고 쓰기 때문이다.

```ts
type StateType = "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled";
interface IssueComment { body: string; author: string; createdAt: string; }
interface Ticket { id: string; key: string; title: string; body: string; labels: string[]; url: string; }
interface NewTicket { title: string; body: string; labels?: string[]; }

interface TicketSource {
  name: string;
  verify(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean;
  parse(rawBody: string): Ticket | null;
  createTicket(t: NewTicket): Promise<Ticket>;
  comment(ticketId: string, body: string): Promise<void>;
  createSubIssue(parentId: string, t: NewTicket): Promise<Ticket>;  // 00 setup이 게이트용 하위 이슈를 만들 때 사용
  getStateType(issueId: string): Promise<StateType>;                // gate.ts가 승인 대기 중 폴링
  listComments(issueId: string): Promise<IssueComment[]>;           // canceled 게이트의 반려 사유(최신 코멘트) 조회
}
```

기본 구현은 `adapters/linear.ts`(GraphQL). Jira로 바꾸려면 정확히 다음만 하면 된다. `adapters/jira.ts`는 이미 일곱 메서드 모두를 `TicketSource` 셰이프로 스텁해뒀고, 각 메서드 위에 실제로 무엇을 호출해야 하는지 주석으로 남겨뒀다.

1. `verify()` — Jira Cloud webhook은 기본적으로 서명하지 않는다. 공유 시크릿을 별도로 구성했다면 `linear.ts`와 같은 방식(HMAC + `timingSafeEqual`)으로 검증한다. 그전까지는 모든 요청을 거부한다.
2. `parse()` — `jira:issue_created` webhook payload를 공통 `Ticket` 셰이프로 매핑한다(`fields.summary`→title, `fields.description`→body, `fields.labels`→labels). 그 외 `webhookEvent`는 `null`.
3. `createTicket()` — `POST {baseUrl}/rest/api/3/issue` (Basic auth: email:apiToken).
4. `comment()` — `POST {baseUrl}/rest/api/3/issue/{ticketId}/comment`.
5. `createSubIssue()` — `createTicket()`과 같은 POST에 `fields.parent = { id: parentId }`와 부모보다 낮은 계층의 issuetype(예: "Sub-task")을 추가한다.
6. `getStateType()` — `GET {baseUrl}/rest/api/3/issue/{issueId}?fields=status`로 `fields.status.statusCategory.key`를 읽어 `"new"→"unstarted"`, `"indeterminate"→"started"`, `"done"→"completed"`로 매핑한다. **Jira에는 별도의 canceled 카테고리가 없다** — 프로젝트의 Canceled/Won't Do 해결값을 명시적으로 `"canceled"`에 매핑하지 않으면 게이트가 영원히 반려될 수 없다.
7. `listComments()` — `GET {baseUrl}/rest/api/3/issue/{issueId}/comment`를 오래된 순으로 매핑한다.

runner가 로드하는 어댑터를 `adapters/linear.ts` 대신 `adapters/jira.ts`로 교체하면 끝이다. 파이프라인의 00~06 단계 로직, 게이트 프로토콜, `claude -p` 호출, 아티팩트 경로는 이 인터페이스보다 위 계층이므로 전혀 손댈 필요가 없다. Jira 어댑터 자체의 실제 구현은 이 프로젝트 범위 밖이며(§7), 인터페이스와 위 절차만 확정한다.

## 5. 3층 가드레일이 걸리는 지점

원문의 3층 가드레일(CLAUDE.md / skills / hooks)을 그대로 따른다. 층마다 성격이 다르고, 실제로 걸리는 스킬·훅과 단계는 아래와 같다.

| 계층 | 이름 | 이벤트/매처 | 하는 일 | 걸리는 단계 |
| --- | --- | --- | --- | --- |
| CLAUDE.md | `todo-app/.claude/CLAUDE.md` | - | 저장소 컨텍스트(명령어, 컨벤션, 아키텍처, 반복된 실수) 1페이지 | 01~06 전 단계 — `claude -p`는 매 호출마다 이걸 읽는다 |
| skills | `sdlc-intent` | `Skill` | 01 intent 산출물(`docs/intent/<id>.md`) 작성 | 01 intent |
| skills | `sdlc-spec` | `Skill` | 02 spec 산출물 작성, "정책 충돌" 인라인 표시 | 02 spec |
| skills | `sdlc-plan` | `Skill` | 03 plan 산출물 작성(코드 미변경) + "무엇이 깨질 수 있는가" 심문 | 03 plan |
| skills | `sdlc-test` | `Skill` | 04 test 피드백 루프(통과할 때까지), 버그 수정 시 실패 테스트 우선, verifier 서브에이전트 위임 | 04 test |
| skills | `sdlc-e2e` | `Skill`(sdlc-test가 위임) | ego-browser로 화면 스냅샷 e2e 확인, `cliLog` stderr `2>&1` 주의 | 04 test(화면 변경 시) |
| skills | `sdlc-review` | `Skill` | 05 deploy Bugs/Security/Compliance 3패스 리뷰(승인은 하지 않음) | 05 deploy |
| skills | `sdlc-maintain` | `Skill` | 06 maintain 2σ 읽기전용 진단 / 3σ intent.md+티켓 생성 | 06 maintain(2σ·3σ만) |
| hooks | `guard-protected-paths.sh` | PreToolUse: `Edit|Write|MultiEdit` | `.env*`/`infra/`/`.github/workflows/` 편집 차단 | 03 build |
| hooks | `block-secrets.sh` | PreToolUse: `Edit|Write|MultiEdit` | 자격 증명처럼 보이는 문자열이 새 내용에 있으면 차단 | 03 build |
| hooks | `protect-tests.sh` | PreToolUse: `Edit|Write|MultiEdit` | `SDLC_BUGFIX=1`일 때 테스트로 보이는 파일 편집 차단(실패하는 테스트가 명세) | 04 test(버그 수정 세션) |
| hooks | `production-gate.sh` | PreToolUse: `Bash` | `RELEASE_APPROVED=1` 없이 프로덕션 배포로 보이는 명령 차단 | 05 deploy 및 이후 수동 배포 |
| hooks | `plan-drift.sh` | PreToolUse: `Bash`(`git commit`) | 스테이징된 파일이 plan.md "변경할 파일" 밖이면 커밋 차단 | 03 build |
| hooks | `format-lint.sh` | PostToolUse: `Edit|Write|MultiEdit` | 자동 포맷 + 린트 실패 시 보고해 같은 턴에서 스스로 고치게 함 | 03 build |
| hooks | `config-eval.sh` | PostToolUse: `Edit|Write|MultiEdit` | `CLAUDE.md`/`.claude/**` 변경 시 저장소 테스트 스위트를 실행해 실패를 보고 | 03 build(에이전트 설정 편집 시) |
| hooks | `verify-before-done.sh` | Stop | plan.md "성공 기준" 명령이 세션 트랜스크립트에 실행된 흔적이 없으면 세션 종료를 차단 | 04 test를 포함해 세션이 끝나려는 모든 시점 |

CLAUDE.md와 skills는 "이렇게 하는 게 좋다"는 유도이고, hooks만 실제로 실행을 막을 수 있다. 그래서 되돌릴 수 없는 지점(코드 변경, 커밋, 배포)에 hooks를 건다. §2의 승인 게이트는 이 3층과 별개로, 에이전트 세션 **밖에서** 사람이 거는 네 번째 장치다 — hooks가 세션 내부 결정론적 차단이라면, 게이트는 세션과 세션 사이에서 사람이 거는 차단이다.

## 6. σ-tier 감지와 무한 루프 방지

06 maintain이 만든 티켓이 다시 01을 트리거하는 구조이므로, 같은 문제가 계속 티켓을 재생성하며 무한히 도는 것을 막아야 한다. 이제 이 방지 장치는 서로 다른 두 계층으로 나뉜다: "이상이 실제로 있었는가"를 판정하는 σ-tier 감지(신규)와, "그 판정이 새 티켓을 계속 만들어도 되는가"를 판정하는 깊이 제한(기존)이다.

### σ-tier 감지 — `ops/detect.sh` + `ops/bands.yaml`

- `ops/detect.sh`는 결정론적 bash+python3 스크립트다. 스크립트 어디에도 `claude` 호출이 없다 — 계산은 `deviation = |value - baseline| / sigma` 뿐이다.
- `ops/bands.yaml`은 metric별 baseline/sigma와 고정된 tier→action 매핑을 정의한다: `<1σ`=none(조치 없음), `1~2σ`=log(에이전트 미개입), `2~3σ`=diagnose(Claude가 read-only로 진단), `≥3σ`=act(`sdlc-maintain`이 intent.md와 Linear 티켓을 만든다). 정의된 metric은 `unit_test_failure_rate`, `e2e_failure_rate`, `api_5xx_rate` 세 가지이고, 파이프라인은 `sdlc.config.json`의 `detectMetric`(기본 `e2e_failure_rate`) 하나만 실제로 평가한다.
- 러너는 이번 실행의 e2e 성공 여부만으로 `metricValue`를 0(통과)/1(실패)로 바꿔 `ops/detect.sh --metric <detectMetric> --value <metricValue>`에 넘긴다. `bands.yaml` 주석이 언급하는 "최근 N회 롤링" 집계는 아직 러너에 구현돼 있지 않다 — 지금은 직전 1회 결과만 본다.
- `ops/detect.sh`가 없거나 tier를 파싱할 수 없으면, 러너는 파이프라인 성공 여부(`testOk && deployOk`)로 tier를 0 또는 3으로 대체 판정한다 — `ops/`가 없다고 유지보수 전체가 조용해지는 상황을 막기 위함이다.

### 3σ 티켓 생성은 에이전트 성공에 의존하지 않는다

3σ에서 새 티켓을 만드는 것은 원칙적으로 `sdlc-maintain` 스킬이 Linear MCP로 하는 일이다. 하지만 그 세션이 실패하면 티켓이 없는 채로 루프가 열린 상태가 되고, 이 단계가 존재하는 유일한 이유가 사라진다. 그래서 러너는 `06-maintain-act` 세션의 종료 상태를 확인하고, 실패했으면 **어댑터(`createTicket`)로 직접 후속 티켓을 만든다** — 러너는 어차피 API 키를 쥐고 있다. 그것마저 실패하면 "루프가 닫히지 않았다, 사람이 처리해야 한다"고 상태 로그와 stderr에 명시한다. 세션이 정상 종료했다는 사실이 실제로 Linear를 호출했음을 증명하지는 않는다는 한계는 코드에 `ponytail:` 주석으로 남겨두었다.

### 깊이 제한 — 기존 그대로

- **자동 생성 티켓 마커 라벨** — `createTicket()`이 만드는 모든 티켓은 `labels: ["sdlc-auto"]`를 갖는다. 라벨이 워크스페이스에 아직 없으면 `resolveLabelIds`가 **직접 만든다**. 예전처럼 조용히 건너뛰면 후속 티켓이 라벨 없이 생성되고, 그 티켓이 webhook으로 되돌아왔을 때 `shouldCreateFollowupTicket`이 "사람이 만든 티켓"으로 오판해 깊이 제한을 통째로 우회한다 — 깊이 제한이 막으려던 무한 루프가 바로 그 경로로 열린다.
- **깊이 제한** — 티켓 본문의 `sdlc-depth: N` 마커(`extractDepth`)로 깊이를 추적한다. 3σ 판정이 나도 `shouldCreateFollowupTicket`이 `maxAutoTicketDepth`(기본 3)에 도달했다고 판단하면 새 티켓을 만들지 않고, 원인 티켓에 코멘트를 남겨 사람에게 에스컬레이션한다.

두 장치는 서로 다른 질문에 답한다 — σ-tier는 "지금 조치가 필요한가", 깊이 제한은 "이 조치를 자동화해도 되는가"다. 3σ이면서 깊이가 상한 미만일 때만 `sdlc-maintain`이 실제로 intent.md와 신규 티켓을 만든다. 그리고 tier가 몇이든 06 maintain이 끝나면 항상 `06-maintain` 게이트(Service Owner)를 거친다 — 로그만 남긴 1σ 케이스도 최종적으로는 사람이 트리아지한다.

## 7. 범위 밖

이 설계가 다루지 않는 것.

- GitHub Actions 워크플로 — 실행기는 로컬 러너 하나뿐이다.
- Jira 어댑터의 실제 구현 — 인터페이스(§4)와 교체 절차만 정의한다. `jira.ts`는 일곱 메서드 모두 스텁이다.
- 멀티 저장소 지원 — 데모/파이프라인은 단일 저장소(`repoPath`)를 전제로 한다.
- 인증·과금·배포 인프라 — 프로덕션 배포 파이프라인 자체(클라우드 배포, 과금, 인증 체계)는 다루지 않는다. 05 deploy는 PR 생성과 리뷰 게이트까지고, `RELEASE_APPROVED=1` 없이는 `production-gate.sh`가 그 이후 어떤 배포 명령도 막는다.
- `ops/bands.yaml`이 언급하는 롤링 윈도 집계의 실제 구현 — §6에서 밝힌 대로 현재는 직전 1회 결과만 본다.
