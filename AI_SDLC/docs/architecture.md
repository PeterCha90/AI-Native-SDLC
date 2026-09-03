# Architecture

## 1. 파이프라인 전체 흐름

Linear 티켓이 들어오면 6단계(01 intent ~ 06 maintain)가 순차로 실행되고, 04 test에서 실패가 나거나 06 maintain이 배포 후 이상을 감지하면 새 Linear 티켓이 자동으로 만들어져 01로 되돌아간다. 루프는 사람이 판단해야 하는 지점(05 deploy의 승인 게이트, 그리고 필요하면 리뷰)에서만 멈춘다.

```
 Linear 티켓 (사람이 작성, 또는 06이 자동 생성 — 라벨 sdlc-auto, depth:N)
        │
        │ webhook
        ▼
 ticket-source adapter   verify() → parse() → 공통 Ticket
        │                (adapters/linear.ts, Jira 등으로 교체 가능)
        ▼
 local runner (Node 데몬)
        │  단계마다 claude -p 헤드리스 세션을 순차 실행한다.
        │  부수 효과: ~/.claude/projects/<project>/<session-id>.jsonl 이 단계마다 생성되고,
        │  zoe --follow 가 그것을 실시간으로 그린다 (§2 참조, 시각화 전용 포맷은 없다).
        ▼
 ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐
 │ 01 intent  │──▶│ 02 spec    │──▶│ 03 build   │──▶│ 04 test    │──▶│ 05 deploy  │──▶│ 06 maintain│
 │ claude -p  │   │ claude -p  │   │ claude -p  │   │ pytest/    │   │ PR 생성 +  │   │ 배포 모니터│
 │            │   │            │   │ (worktree) │   │ vitest +   │   │ 리뷰 게이트│   │ 링, 통제   │
 │            │   │            │   │            │   │ ego-lite   │   │ hook       │   │ 구간 이탈  │
 │            │   │            │   │            │   │ e2e        │   │            │   │ 시 진단    │
 └────────────┘   └────────────┘   └────────────┘   └─────┬──────┘   └────────────┘   └─────┬──────┘
                                                            │ 실패                            │
                                                            └───────────────────────────────▶│
                                                                                               │
        ┌──────────────────────────────────────────────────────────────────────────────────┘
        │  createTicket() — labels: ["sdlc-auto"], body에 depth:N+1 기록
        ▼
 Linear 티켓 (신규, 01 intent로 회귀 → 루프가 닫힌다)
```

04 test 실패는 05 deploy를 건너뛰고 바로 06 maintain으로 넘어가 진단 티켓을 만들 수도 있고(위 다이어그램의 "실패" 화살표), 05 deploy 이후 배포된 코드에서 문제가 관측될 수도 있다(06이 배포 모니터링에서 감지). 어느 경로든 신규 티켓은 같은 `createTicket()` 한 곳으로 모인다.

## 2. 단계별 입출력 아티팩트

| 단계 | 입력 | 출력 | 실행 방식 |
| --- | --- | --- | --- |
| 01 intent | Linear 티켓(title, body, labels) | `docs/intent/<id>.md` | `claude -p` |
| 02 spec | `docs/intent/<id>.md` | `docs/spec/<id>.md` | `claude -p` |
| 03 build | `docs/spec/<id>.md` | `plan.md` + 코드 diff (git worktree 안에서) | `claude -p` (worktree) |
| 04 test | 코드 diff, `plan.md` | 단위 테스트 결과(pytest/vitest), e2e 결과(ego-lite) | pytest/vitest + ego-lite |
| 05 deploy | 통과한 코드 diff, 04 결과 | PR (GitHub) | PR 생성 + 리뷰 게이트 hook |
| 06 maintain | 배포 상태, 04/05 실패 로그 | 신규 Linear 티켓(통제 구간 이탈 시에만) | 모니터링 + `createTicket()` |

모든 단계는 부가적으로 `~/.claude/projects/<project>/<session-id>.jsonl` 세션 트랜스크립트를 남긴다. 이건 파이프라인이 소비하는 아티팩트가 아니라 `claude -p`를 쓴 부수 효과이며, zoetrope가 읽는 유일한 입력이다. 자세한 내용은 `zoetrope.md` 참조.

## 3. ticket-source 어댑터

트리거 소스를 바꿀 수 있어야 한다는 요구(intent.md 8행)에 따라, 티켓 시스템에 의존하는 부분은 다음 인터페이스 하나로 격리한다.

```ts
interface TicketSource {
  verify(req: IncomingRequest): boolean;        // 서명 검증
  parse(req: IncomingRequest): Ticket | null;   // 이벤트 → 공통 Ticket
  createTicket(t: NewTicket): Promise<string>;  // 06 단계가 되돌려 만드는 티켓
  comment(id: string, body: string): Promise<void>;
}

interface Ticket { id: string; title: string; body: string; labels: string[]; url: string; }
```

기본 구현은 `adapters/linear.ts`. Jira로 바꾸려면 정확히 다음만 하면 된다.

1. `adapters/jira.ts`를 만들어 `TicketSource`를 구현한다.
   - `verify()` — Jira webhook의 서명(또는 공유 시크릿) 검증.
   - `parse()` — Jira 이슈 webhook payload를 공통 `Ticket` 셰이프로 매핑.
   - `createTicket()` — Jira REST API로 이슈 생성, 반환값은 새 이슈 ID.
   - `comment()` — 해당 이슈에 댓글 추가.
2. runner가 로드하는 어댑터를 `adapters/linear.ts` 대신 `adapters/jira.ts`로 교체한다.

파이프라인의 01~06 단계 로직, `claude -p` 호출, 아티팩트 경로는 이 인터페이스보다 위 계층이므로 전혀 손댈 필요가 없다. Jira 어댑터 자체의 구현은 이 프로젝트 범위 밖이며(§5), 인터페이스와 위 절차만 확정한다.

## 4. 3층 가드레일이 걸리는 지점

원문의 3층 가드레일(CLAUDE.md / skills / hooks)을 그대로 따른다. 층마다 성격이 다르고, 걸리는 단계도 다르다.

| 계층 | 성격 | 걸리는 단계 |
| --- | --- | --- |
| `CLAUDE.md` | 저장소 컨텍스트, 1페이지 이내 | 01~06 전 단계 — `claude -p`는 매 호출마다 이걸 읽는다 |
| `.claude/skills/` | 조언 성격의 조직 지식 (스펙 작성 패턴, 빌드 관례 등) | 주로 02 spec(설계를 skills로 유도), 03 build |
| `.claude/hooks/` | 결정론적 차단 (조언이 아니라 강제) | 03 build — 보호 경로 편집 차단, 자동 포맷·린트, 자격 증명 diff 포함 시 차단, 미승인 패키지 설치 차단 / 05 deploy — 프로덕션 배포 게이트, exit code 2로 차단하고 메시지 반환 |

CLAUDE.md와 skills는 "이렇게 하는 게 좋다"는 유도이고, hooks만 실제로 실행을 막을 수 있다. 그래서 되돌릴 수 없는 지점(코드 변경, 배포)에 hooks를 건다.

## 5. 무한 루프 방지

06 maintain이 만든 티켓이 다시 01을 트리거하는 구조이므로, 같은 문제가 계속 티켓을 재생성하며 무한히 도는 것을 막아야 한다.

- **자동 생성 티켓 마커 라벨** — `createTicket()`이 만드는 모든 티켓은 `labels: ["sdlc-auto"]`를 갖는다. 01 intent 단계 진입 전에 이 라벨을 보고 "이 티켓은 파이프라인이 만든 것"임을 구분할 수 있다.
- **깊이 제한** — 자동 생성 티켓의 body(또는 커스텀 필드)에 `depth:N`을 기록한다. 06이 티켓을 만들 때 원인 티켓의 depth에 1을 더해 기록하고, runner는 이 값이 설계상 정한 상한(예: 3)을 넘으면 새 티켓을 만들지 않고 사람에게 에스컬레이션(댓글 + 알림)한다.

두 장치 모두 `Ticket`/`NewTicket` 인터페이스의 `labels`, `body` 필드만으로 표현 가능해서 어댑터 교체와 무관하게 동작한다. runner 쪽 실제 상한값과 에스컬레이션 방식은 `runner/` 구현이 확정하는 세부사항이다.

## 6. 범위 밖

이 설계가 다루지 않는 것.

- GitHub Actions 워크플로 — 실행기는 로컬 러너 하나뿐이다.
- Jira 어댑터의 실제 구현 — 인터페이스와 교체 절차만 정의한다.
- 멀티 저장소 지원 — 데모/파이프라인은 단일 저장소를 전제로 한다.
- 인증·과금·배포 인프라 — 프로덕션 배포 파이프라인 자체(클라우드 배포, 과금, 인증 체계)는 다루지 않는다. 05 deploy는 PR 생성과 리뷰 게이트까지다.
