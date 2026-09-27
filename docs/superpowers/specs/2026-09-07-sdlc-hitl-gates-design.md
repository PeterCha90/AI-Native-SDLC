# AI-native SDLC 데모 보강: 6단계 실체화 · Linear 자동 티켓 · 역할별 승인 게이트

날짜: 2026-09-07
대상: `AI_SDLC/` (plugin, runner, demo)
원문: [The AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)

## 1. 문제

현재 데모는 6단계를 "이름만" 통과한다. 세 가지가 빠져 있다.

1. **단계별 가드레일이 실체가 없다.** 스킬 5개와 훅 4개가 있지만 러너의 `claude -p` 프롬프트가 스킬을 한 번도 호출하지 않는다(`pipeline.ts`가 생짜 지시문을 보낸다). `CLAUDE.md`는 템플릿 파일일 뿐 데모 저장소에 실제로 놓여 있지 않다. 원문이 각 단계에 배치하라고 한 훅(계획 이탈 검사, 검증 없이 완료 금지, 수정 중 테스트 파일 보호, 설정 변경 시 eval)과 스킬(04 Test, 06 Maintain), 산출물(`REVIEW.md`, `bands.yaml`)이 없다.
2. **06 Maintain의 자동 티켓 생성이 "테스트 실패 시"에만 있다.** 원문 6단계는 *모델이 개입하지 않는 결정론적 감지 스크립트*가 지표를 롤링 베이스라인과 비교해 σ 티어로 대응하는 구조다. 그 감지 계층이 없다.
3. **Human-in-the-loop이 아예 없다.** 러너가 01~06을 논스톱으로 직진한다. 원문은 단계마다 승인 주체가 다르다(originator / product owner / engineer / code owner / release manager / service owner). 지금은 아무도 승인하지 않는다.

## 2. 설계

### 2.1 Linear에 "단계 파이프라인"을 만든다 (요구사항 3)

티켓 하나가 들어오면 `00-setup` 단계가 **Linear MCP로** 그 티켓 아래에 6개의 하위 이슈를 만든다. 하위 이슈 하나 = 승인 게이트 하나.

```
LIN-42  결제 화면에서 빈 항목이 저장됨          (사람이 만든 원 티켓)
├─ LIN-43  [gate] 01 Plan — 승인자: Product Owner
├─ LIN-44  [gate] 02 Design — 승인자: Product Owner
├─ LIN-45  [gate] 03 Build — 승인자: Engineer
├─ LIN-46  [gate] 04 Test — 승인자: Code Owner
├─ LIN-47  [gate] 05 Deploy — 승인자: Release Manager
└─ LIN-48  [gate] 06 Maintain — 승인자: Service Owner
```

승인 신호는 **Linear의 기본 상태 전이**를 그대로 쓴다. 매직 커맨드 문자열을 새로 만들지 않는다.

| 하위 이슈 상태 타입 | 러너 해석 |
| --- | --- |
| `completed` (Done) | 승인 — 다음 단계로 진행 |
| `canceled` (Canceled) | 반려 — 파이프라인 중단, 최신 코멘트를 사유로 기록 |
| 그 외 | 대기 — 계속 폴링 |

역할은 하위 이슈 제목(`— 승인자: Product Owner`)과 본문에 명시한다. Linear 사용자 조회·배정은 넣지 않는다(YAGNI: 실제 라우팅이 필요해지면 그때 추가).

### 2.2 게이트는 러너가 폴링한다 (Linear MCP는 쓰기 전용)

- **에이전트가 Linear에 쓰는 것** — 하위 이슈 생성(00-setup), 단계별 결과 코멘트, 06의 신규 티켓 — 은 `claude -p` 세션 안에서 **Linear MCP**로 한다. 원문 표현대로 "MCP 커넥터를 통해 결과를 되쓴다".
- **승인 대기 폴링**은 러너가 GraphQL로 직접 한다. 모델을 태울 이유가 없고, 원문도 6단계 감지 계층을 "모델이 개입하지 않는 결정론적" 층으로 규정한다.

`00-setup`이 만든 `stage → issueId` 매핑은 `runner/.state/<key>.gates.json`에 남기고 러너가 읽는다. 이 파일이 없거나 깨졌으면 **파이프라인을 큰 소리로 중단한다.** 승인 게이트를 조용히 건너뛰는 경로는 만들지 않는다.

리허설·오프라인용으로 `SDLC_AUTO_APPROVE=1`이 설정되면 게이트를 즉시 통과시키고 그 사실을 로그와 상태 파일에 남긴다.

### 2.3 각 단계가 실제로 스킬을 호출한다 (요구사항 1)

`pipeline.ts`의 프롬프트를 "이걸 해라"에서 "`sdlc-*` 스킬을 사용해서 이걸 해라"로 바꾸고, `--allowedTools`에 스킬 호출 권한과 (06에 한해) Linear MCP 도구를 넣는다. 데모 저장소는 로컬 마켓플레이스(`AI_SDLC/.claude-plugin/marketplace.json`) + `demo/.claude/settings.json`으로 플러그인을 자동 활성화해서, `claude -p`가 스킬·훅·서브에이전트를 실제로 로드하게 한다.

### 2.4 빠진 가드레일 아티팩트를 채운다 (요구사항 1)

| 추가 | 계층 | 걸리는 단계 | 근거 |
| --- | --- | --- | --- |
| `skills/sdlc-test/` | skill | 04 | 원문 "피드백 루프": 버그는 실패하는 테스트로 먼저 재현하고, 테스트는 고치지 않은 채 코드를 고친다 |
| `skills/sdlc-maintain/` | skill | 06 | 원문 "루프 닫기": 진단을 1단계 형식의 새 `intent.md`로 쓰고 Linear에 티켓 생성 |
| `hooks/plan-drift.sh` | hook | 03 | 커밋 시 `plan.md`의 "변경할 파일"과 실제 변경 파일을 대조, 이탈이면 차단 |
| `hooks/protect-tests.sh` | hook | 04 | 버그 수정 중(`SDLC_BUGFIX=1`) 테스트 파일 편집 차단 |
| `hooks/verify-before-done.sh` | hook | 04 | Stop 훅 — `plan.md` 성공 기준을 한 번도 실행하지 않았으면 완료 불가 |
| `hooks/config-eval.sh` | hook | 04 | `CLAUDE.md`/`.claude/**`가 바뀌면 테스트를 돌린다 |
| `demo/CLAUDE.md` | CLAUDE.md | 03~06 | 템플릿이 아니라 실제로 채워진 파일 |
| `demo/REVIEW.md` | 산출물 | 05 | 3패스 정의, Important 기준, nit 5건 상한 |
| `demo/ops/bands.yaml` | 산출물 | 06 | 지표·베이스라인·σ 티어 규칙 |
| `demo/ops/detect.sh` | 결정론적 스크립트 | 06 | 모델 없이 지표를 읽어 σ 티어를 판정 |
| `docs/stage-map.md` | 문서 | 전체 | 단계 × (CLAUDE.md/skill/hook/subagent/MCP/승인 역할) 대응표 |

### 2.5 06 Maintain을 원문 구조로 바꾼다 (요구사항 2)

```
detect.sh (모델 없음)  지표를 bands.yaml의 롤링 베이스라인과 비교
   ├─ 1σ  로그만 남긴다
   ├─ 2σ  claude -p 를 read-only로 띄워 진단만 시킨다
   └─ 3σ  sdlc-maintain 스킬 → 진단을 docs/intent/<new>.md 로 쓰고
           Linear MCP로 새 티켓 생성 (라벨 sdlc-auto, sdlc-depth: N+1)
              └─ 그 티켓이 다시 01 Plan을 트리거 → 루프가 닫힌다
```

기존 깊이 제한(`sdlc-auto` 라벨 + `sdlc-depth: N`)은 그대로 유지한다.

## 3. 인터페이스 변경

`TicketSource`에 3개를 더한다. Jira 어댑터 교체 가능성은 유지된다.

```ts
createSubIssue(parentId: string, t: NewTicket): Promise<Ticket>;
getStateType(issueId: string): Promise<"triage"|"backlog"|"unstarted"|"started"|"completed"|"canceled">;
listComments(issueId: string): Promise<Array<{ body: string; author: string; createdAt: string }>>;
```

## 4. 하지 않는 것

- Linear 사용자 조회/자동 배정 — 역할은 제목 문자열로 표시한다.
- 관리형 설정(managed settings), OpenTelemetry 내보내기 — 데모에서 보여줄 화면이 없다.
- Jira 어댑터 실구현 — 인터페이스만 맞춘다(기존 범위 유지).
- 게이트 없이 도는 우회 경로 — `SDLC_AUTO_APPROVE=1` 하나만 두고, 그 사실을 항상 로그에 남긴다.

## 5. 검증

- `runner/test/gate.test.ts` — 상태 타입 → 승인/반려/대기 판정, 게이트 매핑 파일 누락 시 중단.
- `runner/test/pipeline.test.ts` — 기존 깊이 제한 테스트 유지.
- `demo/ops/detect.sh` — `--self-check` 로 σ 티어 판정을 assert.
- 훅 4개 — 각 스크립트에 `--self-check` 를 넣어 차단/통과 판정을 검증한다.
