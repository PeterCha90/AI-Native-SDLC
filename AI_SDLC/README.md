<p align="center">
  <img src="https://img.shields.io/badge/AI--native-SDLC-blueviolet?style=for-the-badge" alt="AI-native SDLC" />
  <img src="https://img.shields.io/badge/version-0.1.0-blue?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-orange?style=for-the-badge" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=for-the-badge" alt="Node >= 22" />
</p>

<h1 align="center">🔁 AI-SDLC</h1>
<h3 align="center">Linear 티켓 하나가 6단계 개발 파이프라인이 되는 로컬 러너</h3>

- Linear에 티켓을 만들면 **Plan → Design → Build → Test → Deploy → Maintain** 6단계가 각각 `claude -p` 세션으로 실행된다. 단계마다 **담당 역할의 사람이 Linear 카드를 Done으로 옮겨야** 다음 단계로 넘어가고, 배포 뒤 이상이 감지되면 **새 티켓이 자동으로 생겨 01로 되돌아간다.** 전 과정은 러너가 띄우는 대시보드 한 화면에서 보인다.

원문: [The AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook) — "코드는 더 이상 병목이 아니다. 프로세스가 병목이다."

---

<p align="center">
  <img src="docs/assets/dashboard.png" alt="AI-SDLC 파이프라인 대시보드" width="100%" />
</p>

`http://localhost:3939/` — 러너가 직접 띄우는 대시보드. 아래 카드 `ENG-42`는 6단계를 모두 지나 06에서 후속 티켓 `ENG-49`를 만들었다. 위 카드 `ENG-49`는 그렇게 생긴 자동 티켓이 01 Plan 게이트에서 Product Owner 승인을 기다리는 중이다.

---

## 한눈에 보기

티켓 하나가 들어오면 이 순서로 흐른다. 가운데 굵은 줄이 사람이 개입하는 지점이다.

```
 Linear 티켓 생성 ──webhook──▶ 러너
                                │
 00 Setup    Linear MCP로 게이트용 하위 이슈 6개 생성
                                │
 01 Plan     intent.md 작성            ━━ Product Owner 승인 ━━
 02 Design   spec.md 작성              ━━ Product Owner 승인 ━━
 03 Build    plan.md 작성              ━━ Engineer 승인 ━━  → 승인 뒤에만 코드 편집
 04 Test     실패 테스트로 재현 → 수정 → 단위·e2e 테스트  ━━ Code Owner 승인 ━━
 05 Deploy   3패스 리뷰 → PR            ━━ Release Manager 승인 ━━
 06 Maintain detect.sh가 지표를 σ로 판정  ━━ Service Owner 트리아지 ━━
                                │
                   3σ 이탈이면 새 Linear 티켓 (sdlc-auto) ──▶ 다시 01 Plan
```

| 단계 | 에이전트가 하는 일 | 산출물 | 승인자 | 막는 장치 (hook) |
| --- | --- | --- | --- | --- |
| `00 Setup` | 원 티켓 아래 게이트 하위 이슈 6개 생성 | `.state/<key>.gates.json` | — | 게이트 맵이 없으면 러너가 중단 |
| `01 Plan` | `sdlc-intent` 스킬로 문제·목표·제약·미해결 질문 정리 | `docs/intent/<key>.md` | Product Owner | — |
| `02 Design` | `sdlc-spec` 스킬로 설계, 정책 충돌을 항목 바로 아래 표시 | `docs/spec/<key>.md` | Product Owner | — |
| `03 Build` | `sdlc-plan`으로 계획 → 승인 후 구현 | `docs/plan/<key>.md`, 코드 diff | Engineer | `plan-drift` `guard-protected-paths` `block-secrets` `format-lint` |
| `04 Test` | `sdlc-test`로 피드백 루프, `verifier`·`e2e-reviewer`로 독립 검증 | 테스트·e2e 결과 | Code Owner | `protect-tests` `verify-before-done` `config-eval` |
| `05 Deploy` | `sdlc-review`로 `REVIEW.md` 3패스 리뷰, PR 생성 | PR | Release Manager | `production-gate` |
| `06 Maintain` | `ops/detect.sh`가 σ 티어 판정, 3σ면 `sdlc-maintain`이 새 티켓 작성 | 새 `intent.md`, 새 Linear 티켓 | Service Owner | 자동 티켓 깊이 상한 3 |

에이전트는 스킬과 `CLAUDE.md`를 따르도록 유도될 뿐이다. 실제로 행동을 멈추는 건 hook과 승인 게이트뿐이다. 게이트 판정도 모델이 아니라 Linear 카드 상태를 읽는 코드가 한다.

### 게이트 조작법

승인자는 카드만 옮기면 된다. 따로 배울 명령은 없다.

| Linear 게이트 카드 | 러너 동작 |
| --- | --- |
| `Done` 으로 옮김 | 승인 — 다음 단계 진행 |
| `Canceled` 로 옮김 | 반려 — 파이프라인 중단, 마지막 코멘트를 사유로 기록 |
| 그대로 둠 | 대기 — 10초마다 확인, 30분 넘으면 중단 |

### 06 Maintain의 σ 티어

감지는 모델 없이 `demo/ops/detect.sh`가 `demo/ops/bands.yaml`의 기준선과 비교해서 한다. 에이전트는 티어가 허락한 만큼만 개입한다.

| 티어 | 대응 |
| --- | --- |
| `1σ` 이하 | 기록만 남긴다. 에이전트는 관여하지 않는다 |
| `2σ` | `claude -p`를 읽기 전용으로 띄워 원인만 진단한다 |
| `3σ` | 진단을 새 `intent.md`로 쓰고 Linear에 `sdlc-auto` 티켓을 만든다 → 01로 복귀 |

자동 티켓은 본문에 `sdlc-depth: N`을 달고, 깊이 3에 닿으면 더 만들지 않고 사람에게 넘긴다. 무한 루프를 막는 장치다.

---

## 설치

필요한 것: Node 22 이상, [Claude Code](https://claude.com/claude-code) CLI(`claude`), Python 3(데모 앱 백엔드), Linear 워크스페이스와 API 키.

셸에서, 저장소 루트 기준:

```bash
cd AI_SDLC/runner
npm install

cd ../demo
make install
```

플러그인은 따로 설치하지 않아도 된다. `demo/.claude/settings.json`이 로컬 마켓플레이스(`AI_SDLC/.claude-plugin/marketplace.json`)를 등록해 두어서, `demo/`에서 실행되는 모든 `claude -p`가 스킬·hook·서브에이전트를 자동으로 불러온다.

설치가 끝나면 Linear 없이 대시보드부터 띄워 보자:

```bash
cd AI_SDLC/runner
npm run dashboard:demo
```

`http://localhost:3939/`을 열었을 때 맨 위 스크린샷과 같은 화면이 보이면 준비된 것이다. 가짜 실행 기록 두 건(`ENG-42`, `ENG-49`)을 `.state-demo/`에 써 넣고 그걸 보여 주는 것이라 API 키가 필요 없다.

---

## 실제로 돌리기

### 1. 러너 설정

`runner/sdlc.config.json`에서 `linearTeamId`와 `repoPath`(파이프라인이 작업할 저장소, 기본값 `../demo`)를 확인한다. 비밀값은 설정 파일에 넣지 말고 환경변수로만 넘긴다.

```bash
export LINEAR_API_KEY=lin_api_...
export LINEAR_WEBHOOK_SECRET=...     # 3단계에서 Linear가 알려 준다
```

### 2. 러너 실행

```bash
cd AI_SDLC/runner
npm start
```

webhook 주소, 세션 로그 디렉터리, 대시보드 주소가 출력된다. 필수 값이 빠져 있으면 무엇이 없는지 알려 주고 바로 종료한다.

### 3. Linear webhook 연결

Linear는 공개 URL이 필요하니 러너 포트를 터널로 연다:

```bash
ngrok http 3939        # 또는 cloudflared tunnel --url http://localhost:3939
```

Linear → Settings → API → Webhooks에서 `<터널 URL>/webhook/linear`를 추가하고 Issue 이벤트를 구독한다. 이때 나오는 signing secret을 `LINEAR_WEBHOOK_SECRET`에 넣고 러너를 다시 시작한다. 러너는 시작할 때만 환경변수를 읽는다.

### 4. 티켓 만들고 지켜보기

1. Linear에 티켓을 하나 만든다. 예: `할 일 제목이 비어 있어도 저장된다`.
2. 브라우저에서 `http://localhost:3939/`을 연다. 새 카드가 생기고 `00 Setup`이 실행 중으로 바뀐다.
3. 원 티켓 아래에 `[gate] 01-plan — 승인자: Product Owner` 같은 하위 이슈 6개가 생긴다.
4. `01 Plan`이 끝나면 대시보드에 노란 **승인 대기** 칩이 뜬다. 칩의 `Linear 게이트 열기 →`로 카드를 열고, 요약 코멘트와 `docs/intent/<key>.md`를 확인한 뒤 카드를 **Done**으로 옮긴다.
5. 같은 방식으로 06까지 승인한다. `03 Build`는 계획을 승인한 뒤에야 코드를 편집한다.
6. 테스트나 배포가 실패해 06이 3σ로 판정하면 카드 상단에 `↺ 06 → ENG-xx → 01`이 나타나고, 새 티켓의 카드가 목록 맨 위에 생긴다.

### 리허설 모드

사람 승인 없이 흐름만 빠르게 확인하려면:

```bash
SDLC_AUTO_APPROVE=1 npm start
```

`00 Setup`과 게이트 6개를 모두 건너뛴다. 로그와 대시보드에 `리허설 모드(자동 승인)`가 표시되니 실제 승인과 헷갈릴 일은 없다.

---

## 설정

`runner/sdlc.config.json`:

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| `ticketSource` | `linear` | `jira`로 바꿀 수 있지만 Jira 어댑터는 인터페이스만 있다 |
| `repoPath` | `../demo` | 파이프라인이 작업할 저장소 경로 |
| `port` | `3939` | webhook과 대시보드가 쓰는 포트, `PORT` 환경변수가 우선한다 |
| `useWorktree` | `true` | 티켓마다 `sdlc/<key>` 브랜치 worktree를 만들어 그 안에서 작업한다 |
| `gateRoles` | PO / PO / Engineer / Code Owner / Release Manager / Service Owner | 단계별 승인자 표시 이름 |
| `gatePollIntervalMs` | `10000` | 게이트 상태를 확인하는 간격 |
| `gateTimeoutMs` | `1800000` | 이 시간 동안 아무도 승인하지 않으면 중단한다 (30분) |
| `maxAutoTicketDepth` | `3` | 06이 연쇄로 만들 수 있는 자동 티켓의 최대 깊이 |
| `detectScript` / `detectMetric` | `ops/detect.sh` / `e2e_failure_rate` | 06 감지 스크립트와 판정 지표 |

환경변수:

| 변수 | 설명 |
| --- | --- |
| `LINEAR_API_KEY` | 필수. 게이트 상태 조회와 코멘트에 쓴다 |
| `LINEAR_WEBHOOK_SECRET` | 필수. webhook 서명 검증용 |
| `SDLC_AUTO_APPROVE` | `1`이면 리허설 모드 |
| `SDLC_CONFIG_PATH` | 다른 설정 파일을 쓸 때 |

---

## 트러블슈팅

| 증상 | 해결 |
| --- | --- |
| `npm start`가 바로 종료된다 | 출력된 `[config]` 메시지대로 `LINEAR_API_KEY`, `LINEAR_WEBHOOK_SECRET`, `linearTeamId`를 채운다 |
| 티켓을 만들어도 대시보드에 카드가 안 생긴다 | 터널이 살아 있는지, webhook URL 끝이 `/webhook/linear`인지 확인한다. 서명이 틀리면 러너 로그에 401이 찍힌다 |
| `no approval-gate map` 으로 중단된다 | `00 Setup`이 Linear MCP로 하위 이슈를 만들지 못한 것이다. Claude Code에 Linear MCP가 연결돼 있는지 확인하거나 리허설 모드로 돌린다 |
| 승인했는데 다음 단계로 안 넘어간다 | 카드 상태가 Done 계열(`completed`)인지 확인한다. 10초 간격으로 확인하니 조금 기다린다 |
| `03 Build`에서 커밋이 막힌다 | `plan-drift` hook이 `plan.md`에 없는 파일 변경을 막은 것이다. 계획을 고쳐 다시 승인받거나 변경을 되돌린다 |
| 대시보드가 비어 있다 | 아직 실행 기록이 없는 것이다. `npm run dashboard:demo`로 화면부터 확인할 수 있다 |

---

## 프로젝트 구조

```
AI_SDLC/
├── runner/                     # 로컬 러너 (Node, 의존성은 개발용 타입뿐)
│   ├── src/index.ts            # webhook 수신 + 대시보드 서버
│   ├── src/pipeline.ts         # 00~06 단계 실행과 게이트 대기
│   ├── src/gate.ts             # Linear 카드 상태 → 승인/반려/대기 판정
│   ├── src/dashboard.html      # 대시보드 페이지 (빌드 없음)
│   ├── src/adapters/           # 티켓 소스 어댑터 (linear, jira 스텁)
│   └── sdlc.config.json        # 비밀값이 아닌 설정
├── plugin/                     # Claude Code 플러그인
│   ├── skills/                 # sdlc-intent, spec, plan, test, e2e, review, maintain
│   ├── hooks/                  # 되돌리기 어려운 지점을 막는 hook 8개
│   ├── agents/                 # verifier, e2e-reviewer 서브에이전트
│   └── commands/               # /sdlc-run, /sdlc-status, /sdlc-visualize
├── demo/                       # 파이프라인이 고칠 대상인 할 일 앱 (React + FastAPI)
│   ├── CLAUDE.md               # 모든 단계가 매번 읽는 저장소 규칙
│   ├── REVIEW.md               # 05 리뷰 정책
│   └── ops/                    # bands.yaml, detect.sh — 06 감지 계층
└── docs/
    ├── architecture.md         # 전체 구조와 설계 이유
    ├── stage-map.md            # 단계 × 스킬/hook/승인자 대응표와 확인 명령
    ├── demo-scenario.md        # 시연 대본과 실패 대비
    └── intent.md               # 원본 요구사항 (수정 금지)
```

더 읽을 것: 단계별로 무엇을 어떻게 확인하는지는 [`docs/stage-map.md`](docs/stage-map.md), 설계 이유는 [`docs/architecture.md`](docs/architecture.md), 러너 API와 테스트는 [`runner/README.md`](runner/README.md), 플러그인 구성은 [`plugin/README.md`](plugin/README.md)에 있다.

---

<p align="center">
  Made by <a href="https://github.com/PeterCha90">Peter Cha</a>
</p>
