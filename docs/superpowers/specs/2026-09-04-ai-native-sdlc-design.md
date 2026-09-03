# AI-Native SDLC: 자동화 파이프라인 + 발표자료 설계

- 작성일: 2026-09-04
- 원문: https://claude.com/blog/the-ai-native-sdlc-playbook (Louis Claxton, 2026-08-21)
- 참고: https://www.youtube.com/watch?v=LoMOPj-lO8U (Rob Shocks, 16:21)
- 출처 intent: `AI_SDLC/docs/intent.md`

## 1. 개요

두 개의 독립 산출물을 만든다.

- **Part 2 (선행)**: 원문의 개념과 before/after를 설명하는 Remotion 애니메이션 발표자료. `slides/`.
- **Part 1 (후행)**: Linear 티켓 생성을 인지해 AI-SDLC 파이프라인을 자동 실행하는 Claude Code 플러그인, zoetrope 시각화, 데모 프로젝트, 시연 시나리오.

Part 2를 먼저 완성한다. 개념과 단계 이름을 확정해야 Part 1의 파이프라인 단계가 원문과 어긋나지 않는다.

## 2. 확정된 결정

| 항목 | 결정 | 근거 |
| --- | --- | --- |
| 진행 순서 | Part 2 → Part 1 | 용어·단계 정의를 먼저 고정 |
| 산출물 형태 | Claude Code 플러그인 (GitHub 배포) | intent의 "누구나 참고해서 반영할 수 있는" 요구 |
| 실행기 | 로컬 러너 단일 (Node 데몬) | 시연 시 `zoe` 실시간 모니터링이 가능 |
| CI | GitHub Actions 사용하지 않음 | 요구에 없었고, 실시간 시연 가치를 해침 |
| 티켓 트리거 | Linear webhook → 로컬 수신기 | ticket-source 어댑터로 Jira 등 교체 가능 |
| e2e | ego-lite 기본, Aside 대체 | intent 명시 |
| 시각화 | zoetrope (`zoe`) | 아래 3절 제약 참조 |
| 발표자료 | 한국어, 18슬라이드 | 10~15분 분량 |

## 3. 핵심 제약: zoetrope는 임의 파이프라인을 그리지 못한다

zoetrope는 Claude Code 세션 트랜스크립트 전용 뷰어다. 자체 설정 DSL이 없고, 입력은
`~/.claude/projects/<project>/<session-id>.jsonl` 형식 하나뿐이다. 이 형식은 Claude Code
내부 포맷이며 문서화되어 있지 않다.

따라서 파이프라인을 임의 구조로 만들고 zoetrope에 먹이는 설계는 불가능하다. 대신 **파이프라인의
각 단계를 실제 `claude -p` 헤드리스 세션으로 실행한다.** 그러면 트랜스크립트가 부수적으로 생성되고
zoetrope가 그것을 그대로 그린다. 이 제약이 오히려 설계를 단순하게 만든다. 별도의 시각화 데이터
포맷을 발명할 필요가 없다.

배포 형태:

- CLI: `brew install furkankly/tap/zoetrope` 또는 `cargo install zoetrope` → `zoe`
- 브라우저: https://zoetrope.furkankly.dev/app (WASM, `.jsonl` 드래그앤드롭)

주요 명령:

```bash
zoe                          # 현재 프로젝트의 라이브 세션 추적
zoe <file.jsonl> --follow    # 기록을 라이브 엣지에서 열기
zoe inspect <file.jsonl>     # 헤드리스로 세션 트리 출력
```

## 4. Part 2 — Remotion 발표자료

### 4.1 슬라이드 구성 (18장)

| # | 제목 | 내용 / 애니메이션 |
| --- | --- | --- |
| 1 | 타이틀 | AI-Native SDLC |
| 2 | 코드는 더 이상 병목이 아니다 | 원문 Figure 1. build 단계 막대가 시간 단위로 붕괴 |
| 3 | 그럼 병목은 어디로 갔나 | 나머지 5단계가 사람 속도로 남아있는 대비 |
| 4 | AI-native SDLC란 무엇인가 | 원문 Figure 2. 선형 파이프라인이 닫힌 루프로 변형 |
| 5 | 6단계 개요 | 01 Plan ~ 06 Maintain 마커 등장 |
| 6 | Before / After 대조표 | 6행이 순차적으로 뒤집힘 |
| 7 | 아티팩트 체인 | intent.md → spec.md → plan.md → diff+tests → PR → incident |
| 8 | 01 Plan | 핸드오프 유실 vs `intent.md` |
| 9 | 02 Design | 분리된 단계 vs 한 세션 압축, `spec.md` |
| 10 | 03 Build ① | plan mode를 기본 시작점으로 |
| 11 | 03 Build ② | CLAUDE.md / skills / hooks 3층 가드레일 |
| 12 | 03 Build ③ | 병렬 세션 + worktree + 서브에이전트 |
| 13 | 04 Test ① | 늦은 피드백 vs 자기 검증 루프 |
| 14 | 04 Test ② | CI 지속 평가 20~50개 |
| 15 | 05 Deploy ① | 계층형 리뷰, 사람은 판단에 집중 |
| 16 | 05 Deploy ② | hooks가 승인 게이트, exit code 2로 차단 |
| 17 | 06 Maintain | 1σ 기록 / 2σ 읽기전용 진단 / 3σ PR 제안 |
| 18 | 루프 닫힘 + 도입 순서 | incident → intent.md → 1단계 회귀, 원문 Figure 3 |

### 4.2 원문 대조표 (슬라이드 6의 원본 데이터)

| 단계 | 전통적 방식 | AI-native |
| --- | --- | --- |
| Plan | 위원회가 요구사항 수집, 워크숍과 승인으로 정제, 손으로 작성 | Claude가 문제점을 `intent.md`로 수집. 사람이 읽고 기계가 실행 가능 |
| Design | 분석가가 스펙 작성 후 디자이너가 해석 | 요구사항과 설계를 한 세션으로 압축, skills로 유도, git으로 버전 관리 |
| Build | 테스트와 코드를 손으로 작성, 문서는 개발 후에 작성 | AI가 테스트와 코드 생성, 조직 지식은 버전 관리되는 CLAUDE.md와 skills에 |
| Test | 단계 경계마다 QA 게이트 | 구현 전반에 지속 평가가 엮여 있음 |
| Deploy | 사람이 모든 줄을 리뷰, 거버넌스는 리뷰 사이클에서 일관성 없이 발생 | 계층형 에이전트 리뷰, 사람 리뷰는 규제·핵심 코드에 한정, hooks가 승인 게이트 |
| Maintain | 사람이 프로덕션에서 버그를 감시 | 에이전트가 배포를 모니터링, 통제 구간 이탈 시 진단해 새 `intent.md`로 회신 |

원문 단서: "대부분의 조직은 두 열 사이 어딘가에 있다."

### 4.3 인용 (한국어 나레이션 + 영어 원문 병기)

- "코드는 더 이상 병목이 아니다. 당신의 프로세스가 병목이다."
- "The agent does everything up to the production gate and nothing past it."
- "The agent that wrote the code has no way to approve it."
- "Coverage is dated from the last run, not from the first."
- "The loop keeps running, and human judgement stays above it."

### 4.4 수치

- build 단계 2배 속도 향상 주장
- 평가 세트 20~50개 실제 작업, 프로덕션 사고는 영구 평가로 편입
- 리뷰 nit 상한 5개, 나머지는 개수로 요약
- 모니터링 1σ 기록 / 2σ 읽기전용 진단 / 3σ 제안, 30일 롤링 기준선
- CLAUDE.md는 1페이지 이내, 같은 실수 2회 반복 시 CLAUDE.md에 기록
- 병렬 세션은 2~3개가 합리적 출발점

### 4.5 기술 구성

- Remotion, TypeScript, 1920x1080, 30fps
- 슬라이드 1장 = 1 컴포넌트 파일. `slides/src/slides/NN-name.tsx`
- 공용 요소는 `slides/src/components/` (타이틀, 대조 카드, 단계 마커, 코드 블록)
- 디자인 토큰은 `slides/src/theme.ts` 한 곳
- 나레이션 대본은 `slides/script.md`

## 5. Part 1 — AI-SDLC 자동화 플러그인

### 5.1 구조

```
Linear webhook ──> ticket-source adapter ──> local runner (Node 데몬)
                   (Jira/GitHub Issues 교체 지점)      │
                                                       ├─ 01 intent   claude -p → docs/intent/<id>.md
                                                       ├─ 02 spec     claude -p → docs/spec/<id>.md
                                                       ├─ 03 build    claude -p (worktree) → plan.md + 코드
                                                       ├─ 04 test     pytest/vitest + ego-lite e2e
                                                       ├─ 05 deploy   PR 생성 + 리뷰 게이트 훅
                                                       └─ 06 maintain 실패 감지 → Linear 티켓 생성 ──┐
                                                                                                      │
              각 단계가 ~/.claude/projects/ 에 JSONL 기록 ──> zoe --follow 실시간 그래프              │
                                                                                                      │
              └────────────────────────── 루프 회귀 ──────────────────────────────────────────────────┘
```

### 5.2 ticket-source 어댑터 인터페이스

교체 가능해야 하는 유일한 지점. 최소 인터페이스:

```ts
interface TicketSource {
  verify(req: IncomingRequest): boolean;        // 서명 검증
  parse(req: IncomingRequest): Ticket | null;   // 이벤트 → 공통 Ticket
  createTicket(t: NewTicket): Promise<string>;  // 06 단계가 되돌려 만드는 티켓
  comment(id: string, body: string): Promise<void>;
}

interface Ticket { id: string; title: string; body: string; labels: string[]; url: string; }
```

`adapters/linear.ts`를 기본 제공. `adapters/jira.ts`는 같은 인터페이스를 구현하면 드롭인 교체.

### 5.3 훅 구성

원문의 3층 가드레일을 그대로 따른다.

- `CLAUDE.md` — 저장소 컨텍스트, 1페이지 이내
- `.claude/skills/` — 조언 성격의 조직 지식
- `.claude/hooks/` — 결정론적 차단
  - 보호 경로 편집 차단
  - 자동 포맷·린트
  - 자격 증명이 diff에 포함되면 차단
  - 승인되지 않은 패키지 설치 차단
  - 프로덕션 배포 게이트 (exit code 2로 차단하고 메시지 반환)

### 5.4 e2e 리뷰

기본값 ego-lite. 헤드리스 호출 형태:

```bash
ego-browser nodejs <<'EOF'
const task = await useOrCreateTaskSpace('e2e review')
await openOrReuseTab('http://localhost:5173', { wait: true, timeout: 20 })
cliLog(await snapshotText())
EOF
```

`cliLog`는 stdout이 아니라 **stderr**로 출력한다. 호출부는 `2>&1` 병합이 필요하다.
준비 상태 확인은 `printf 'cliLog("ok")\n' | ego-browser nodejs 2>&1`.

Aside CLI는 대체 경로로 문서에만 남긴다. `aside repl`은 TTY를 요구해 헤드리스에 부적합하다.

### 5.5 데모 프로젝트

- React + Vite 프런트엔드, FastAPI 백엔드
- 의도적으로 작은 버그를 심는다. e2e가 잡아내고 06 단계가 Linear 티켓을 자동 생성한다
- 그 티켓이 01 단계를 다시 트리거해 루프가 도는 것을 `zoe`로 관객이 본다
- 시연 시나리오는 `AI_SDLC/docs/demo-scenario.md`

## 6. 범위 밖

- GitHub Actions 워크플로
- Jira 어댑터 실제 구현 (인터페이스와 문서만)
- 멀티 저장소 지원
- 인증·과금·배포 인프라

## 7. 검증 방법

- Part 2: `npx remotion render`가 통과하고 18장이 모두 렌더된다
- Part 1: 데모 저장소에서 티켓 생성 → 6단계 통과 → e2e 실패 → 신규 티켓 자동 생성까지 1회 완주
- zoetrope: `zoe inspect <session>.jsonl`이 세션 트리를 출력한다
