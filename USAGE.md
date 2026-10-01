# 사용 설명서

이 저장소에는 `AI_SDLC/`가 들어 있다 — Linear 티켓을 받아 6단계 파이프라인을 자동 실행하는 Claude Code 플러그인 + 로컬 러너(+ Slack 봇) + 데모 앱.

원문: https://claude.com/blog/the-ai-native-sdlc-playbook

---

## 1. 플러그인을 내 저장소에 적용하기

`AI_SDLC/plugin/`이 Claude Code 플러그인이다. 원문의 6단계와 3층 가드레일을 담고 있다.

### 들어있는 것

7 skill + 8 hook + 2 subagent + 2 command(아래 표. `/sdlc-init`은 "저장소 준비"에서 따로 다룬다). 각 파일이 어느 단계에서 정확히 뭘 하고 시연에서 어떻게
확인하는지는 단계별로 `AI_SDLC/docs/stage-map.md`에 정리돼 있다 — 여기서는 한 줄씩만 짚는다.

| 종류 | 이름 | 하는 일 |
| --- | --- | --- |
| skill | `sdlc-intent` | 티켓·로그·대화에서 `intent.md`를 만든다 (01 Plan) |
| skill | `sdlc-spec` | `intent.md` → `spec.md`. 정책 충돌은 해당 설계 항목 바로 아래 인라인 표시 (02 Design) |
| skill | `sdlc-plan` | `spec.md` → `plan.md`. "무엇이 깨질 수 있는가"로 계획을 심문한다. 코드는 아직 안 건드린다 (03 Build 착수) |
| skill | `sdlc-test` | 성공 기준을 실제로 실행→읽기→고치기 피드백 루프를 통과할 때까지 반복. 버그 수정이면 실패하는 테스트로 먼저 재현 (04 Test) |
| skill | `sdlc-e2e` | ego-lite로 화면을 열어 e2e 검증 (04 Test) |
| skill | `sdlc-review` | PR을 Bugs/Security/Compliance 3패스로 리뷰. nit은 최대 5개. 스스로 승인·차단하지 않는다 (05 Deploy) |
| skill | `sdlc-maintain` | `ops/detect.sh`의 σ-tier breach를 받아 진단하고, 3σ면 새 intent.md와 Linear 티켓을 만든다 (06 Maintain) |
| command | `/sdlc-run` | 티켓 키를 받아 6단계를 사람 승인을 받으며 진행 |
| command | `/sdlc-status` | 진행 상태와 세션 트랜스크립트 경로, Linear 게이트 하위 이슈 링크 |
| agent | `verifier` | `plan.md`의 성공 기준 충족 여부만 확인. 수정 권한 없음, 신선한 컨텍스트에서 한 번만 돈다 |
| agent | `e2e-reviewer` | ego-lite로 화면을 열어 스냅샷을 요구사항과 대조. 수정 권한 없음 |
| hook | `guard-protected-paths.sh` | `.env*`, `infra/`, `.github/workflows/` 편집 차단 |
| hook | `block-secrets.sh` | 편집 내용에 자격 증명 패턴이 있으면 차단 |
| hook | `protect-tests.sh` | `SDLC_BUGFIX=1`인 동안 테스트 파일 편집 차단 — 테스트를 고쳐서 통과시키는 걸 막는다 |
| hook | `format-lint.sh` | 편집 직후 자동 포맷, 린트 실패는 되돌려줘 자가 수정시킨다 |
| hook | `plan-drift.sh` | `git commit` 시 스테이지된 파일이 `plan.md`의 "변경할 파일"에 없으면 차단 |
| hook | `verify-before-done.sh` | **Stop 훅.** `plan.md`의 "성공 기준" 명령을 세션에서 한 번도 안 돌렸으면 완료를 막는다 |
| hook | `config-eval.sh` | `CLAUDE.md`나 `.claude/**`가 바뀌면 테스트 스위트를 돌려 깨졌는지 확인한다 |
| hook | `production-gate.sh` | `RELEASE_APPROVED` 없으면 프로덕션 배포로 보이는 명령을 차단 |

훅은 차단할 때 **exit code 2**로 끝내고 사유를 stderr로 낸다. 그래야 Claude가 왜 막혔는지 알고 다른 방법을 찾는다.

### 설치

**권장 — CLI 두 줄** (클론 불필요):

```bash
claude plugin marketplace add PeterCha90/AI-Native-SDLC
claude plugin install ai-native-sdlc@ai-sdlc     # 팀 공유는 --scope project
```

설치 후 Claude Code를 재시작한다. 이 저장소를 클론해 두고 개발 중이라면 아래 두 방법도 된다.

**(a) 세션 단위, 설치 없이**

```bash
claude --plugin-dir <AI_SDLC/plugin 경로>
```

**(b) 저장소 단위, 자동으로**

프로젝트 저장소에 `.claude/settings.json`을 두고 로컬 마켓플레이스를 등록하면, 그 디렉토리에서
`claude`를 띄울 때마다 자동으로 붙는다. `claude plugin install ai-native-sdlc@ai-sdlc --scope project`처럼
`--scope project`를 붙여 설치하면 이 파일을 직접 쓸 필요 없이 CLI가 만들어준다. 손으로 쓴다면 이런
내용이다:

```json
{
  "extraKnownMarketplaces": {
    "ai-sdlc-local": {
      "source": {
        "source": "directory",
        "path": ".."
      }
    }
  },
  "enabledPlugins": {
    "ai-native-sdlc@ai-sdlc-local": true
  }
}
```

**주의 (실측 확인됨, 실패가 조용하다):** `source.source`는 반드시 `"directory"`여야 한다 — `"local"`은
아예 동작하지 않는다. `path`는 프로젝트 디렉토리 기준 **상대 경로**여야 한다. 절대 경로를 넣으면
에러 한 줄 없이 스킬이 하나도 로드되지 않는다. 로드됐는지 확인하는 방법은 §6 참고.

이 저장소의 예시 앱(`AI_SDLC/todo-app/`)은 이 파일을 커밋해 두지 않는다 — 클론한 사람이 아래 "저장소
준비"를 직접 따라 하며 `.claude/`가 생기는 과정을 보게 하려는 것이다("생성하는 재미"). `AI_SDLC/todo-app/`
안에서 위 두 방법(추천 CLI 두 줄, 또는 `--scope project`) 중 하나로 설치하면 확인할 수 있다.

### 저장소 준비

대상 저장소에서 Claude Code를 열고 `/sdlc-init`을 실행한다. `.claude/CLAUDE.md`·`REVIEW.md`·`ops/bands.yaml`·`ops/detect.sh`를 깔고(기존 파일은 덮어쓰지 않음) `.claude/CLAUDE.md`의 명령어 칸을 채운다. SDLC용 `CLAUDE.md`를 루트가 아니라 `.claude/` 아래에 두는 건, 루트에 팀의 `CLAUDE.md`가 이미 있어도 SDLC 규칙이 빠지지 않게 하려는 것이다(Claude Code는 둘 다 읽는다). 그다음 `.claude/CLAUDE.md`를 자기 저장소에 맞게 고친다. 규칙 두 개만 지키면 된다.

- **1페이지를 넘기지 말 것.** 길어지면 읽히지 않는다
- **같은 실수를 두 번 하면 그 교정을 여기에 적을 것.** 이게 이 파일이 자라는 유일한 방법이다

실제로 채워 넣은 예시를 보려면 `AI_SDLC/todo-app`에서 플러그인을 설치하고(위 두 방법 중 하나) `/sdlc-init`을
실행한다 — `.claude/CLAUDE.md`가 그 자리에 생긴다. 앞서 말했듯 이 파일은 저장소에 커밋돼 있지 않다.

03 단계 이후부터는 CLAUDE.md 말고도 파이프라인이 기대하는 파일이 두 개 더 있다(둘 다 `/sdlc-init`이 없으면 만든다).

- `REVIEW.md` — 05 Deploy의 `sdlc-review`가 따르는 리뷰 정책 문서(Important/Nit 기준, nit 5건 상한,
  리뷰가 지적하지 말아야 할 것). `AI_SDLC/todo-app/REVIEW.md`(없으면 `/sdlc-init`이 만든다)
- `ops/bands.yaml` + `ops/detect.sh` — 06 Maintain이 이상 여부(tier)를 판정할 때 쓰는 지표 기준값과
  결정론적 스크립트. 예시: `AI_SDLC/todo-app/ops/`(이미 저장소에 커밋돼 있다)

---

## 2. 파이프라인 돌리기

`AI_SDLC/runner/`가 Linear webhook을 받아 6단계를 실행하는 로컬 데몬이다.
각 단계는 `claude -p --plugin-dir AI_SDLC/plugin` 헤드리스 세션으로 돈다.

### 준비

```bash
cd AI_SDLC/runner
npm install

export LINEAR_WEBHOOK_SECRET=...   # Linear webhook 설정 화면에서 발급, 서명 검증에 쓴다
export LINEAR_API_KEY=...          # 게이트 상태 폴링·코멘트·후속 티켓 생성에 쓴다 (GraphQL API)
```

비밀값은 이 두 환경변수로만 받는다. `sdlc.config.json`에 적지 말 것. `linearTeamId`는 환경변수가 아니라
`sdlc.config.json`에 직접 적는 값이다(`REPLACE_WITH_LINEAR_TEAM_ID` 자리를 채운다). 나머지 설정(포트,
대상 저장소 경로, e2e 드라이버, worktree 사용 여부, 게이트 역할/폴링 간격/타임아웃)도 `sdlc.config.json`에
있다. `repoPath`는 `../todo-app`으로 고정돼 있다 — 러너는 이 저장소의 `AI_SDLC/todo-app/`을 대상으로 돈다.

**`LINEAR_API_KEY`만으로는 부족하다.** 첫 단계인 `00-setup`은 이 환경변수를 안 쓴다 — Claude Code 세션
안에서 **Linear MCP 커넥터**로 승인 게이트 하위 이슈 6개를 만든다. 즉 파이프라인을 돌리는 `claude` 세션이
Linear에 MCP로 인증되어 있어야 한다. `LINEAR_API_KEY`는 그다음부터, 러너 프로세스 자신이 게이트 상태를
폴링하고 코멘트를 남기고(GraphQL) 06 Maintain에서 후속 티켓을 만들 때 쓴다. 역할이 갈린다 — **에이전트는
MCP로 Linear에 쓰고, 러너는 API 키로 GraphQL을 통해 읽는다.** 둘 중 하나만 되어 있으면 게이트가 아예
안 만들어지거나(MCP 미인증), 만들어진 게이트를 러너가 못 읽는다(API 키 누락).

### 실행

```bash
npm start
curl -s localhost:3939/health    # {"status":"ok"} 나오면 정상
```

Linear webhook을 로컬로 넣으려면 터널이 필요하다. webhook URL은 `POST /webhook/linear`.

### 승인 게이트 — Linear 카드를 옮기는 것이 승인이다

티켓이 들어오면 `00-setup` 단계가 원본 티켓 아래 하위 이슈 6개를 만든다. 하나가 게이트 하나, 제목은
`[gate] <stage> — 승인자: <역할>`이고, 매핑은 `runner/.state/<key>.gates.json`에 쓰인다.

승인 신호는 매직 문자열이 아니라 Linear의 기본 상태 전이다 — 하위 이슈를 **Done**으로 옮기면 승인,
**Canceled**로 옮기고 사유를 코멘트로 남기면 반려다. 그 외 상태는 대기: 러너가 `gatePollIntervalMs`
(기본 10초) 간격으로 폴링하다가 `gateTimeoutMs`(기본 30분)를 넘기면 타임아웃으로 처리한다. 둘 다
`sdlc.config.json`에서 조절한다.

역할은 `gateRoles`에서 온다: 01 Plan·02 Design은 Product Owner, 03 Build는 Engineer, 04 Test는
Code Owner, 05 Deploy는 Release Manager, 06 Maintain은 Service Owner.

게이트 맵 파일이 없거나 형식이 깨졌으면 러너는 **파이프라인을 아예 시작하지 않고 중단한다**
(`gate.ts`의 `readGateMap`). 게이트 없이 6단계가 조용히 다 도는 경로는 의도적으로 만들지 않았다 — 그런
경로가 있으면 승인 없는 배포가 "그냥 아직 아무도 못 봤을 뿐"인 상태로 방치되기 쉽다.

리허설용으로 `SDLC_AUTO_APPROVE=1`을 설정하면 모든 게이트를 건너뛴다. 건너뛸 때마다 그 사실을 로그에
남긴다 — 조용히 넘어가지 않는다.

### 6단계가 하는 일

`03 Build`는 게이트를 사이에 두고 계획과 구현으로 쪼개져 있다.

| 단계 | 입력 | 출력 |
| --- | --- | --- |
| 00 setup | 원본 Linear 티켓 | Linear 하위 이슈 6개, `runner/.state/<key>.gates.json` |
| 01 Plan (`sdlc-intent`) | Linear 티켓 | `docs/intent/<key>.md` |
| 02 Design (`sdlc-spec`) | intent.md | `docs/spec/<key>.md` |
| 03 Build — 계획 (`sdlc-plan`) | spec.md | `docs/plan/<key>.md`. 코드는 건드리지 않는다 |
| 03 Build — 구현 | 승인된 plan.md | 코드 diff (worktree 안에서) |
| 04 Test (`sdlc-test` + `sdlc-e2e`) | 코드 | 유닛 테스트 + e2e 결과 |
| 05 Deploy (`sdlc-review`) | 통과한 코드 | PR (`gh pr create`) + 리뷰 결과. 프로덕션 게이트는 넘지 않는다 |
| 06 Maintain (`sdlc-maintain`) | 04/05 결과 + `ops/detect.sh` 티어 | 티어에 따라: 기록만 / read-only 진단 / 새 intent.md + Linear 후속 티켓 |

각 단계는 스킬을 이름으로 호출하는 프롬프트로 실행되고 `--plugin-dir`로 플러그인을 붙인 채 돈다. 각 단계가
정확히 어떤 훅·파일과 맞물리는지, 시연에서 뭘 보여주면 되는지는 `AI_SDLC/docs/stage-map.md`에 단계별로
정리돼 있다 — 여기서 중복 설명하지 않는다.

### 무한 루프 방지

루프를 닫는 티켓은 06 Maintain이 감지 티어 **3(3σ 이탈)**일 때만 만든다. 그 티켓에는 `sdlc-auto` 라벨이
붙고 본문에 `sdlc-depth: N`이 기록된다. `sdlc.config.json`의 `maxAutoTicketDepth`(기본 3)를 넘으면
티켓을 더 만들지 않고 원본 티켓에 댓글만 남긴다. 사람이 만든 티켓은 라벨이 없으므로 깊이에 포함되지 않는다.

티어는 `ops/detect.sh`가 정한다 — 모델이 전혀 관여하지 않는 순수 스크립트다. `ops/bands.yaml`의
baseline/sigma로 `deviation = |value - baseline| / sigma`를 계산해 1σ(`log`, 기록만)/2σ(`diagnose`,
read-only 진단)/3σ(`act`, intent.md + 티켓)로 나눈다. tier 경계와 각 tier에서 에이전트가 가진 권한은
`stage-map.md`의 06 Maintain 절 참고.

### 검증

```bash
cd AI_SDLC/runner && npm run typecheck && npm test
bash AI_SDLC/todo-app/ops/detect.sh --self-check
```

실제로 돌려서 확인한 결과: `npm run typecheck`는 에러 없이 통과, `npm test`는 25개 테스트 전부 통과
(서명 검증, 이벤트 파싱, 게이트 폴링/타임아웃/자동승인, 루프 깊이 제한, tier 파싱), `detect.sh --self-check`는
`self-check: PASS`(tier 경계 4개 assert)를 출력한다.

---

## 3. Slack으로 흐름 보기

진행 상황을 보여주는 화면은 두 곳뿐이다 — **Linear 원 티켓 아래 게이트 하위 이슈 6개**(00 Setup이
만든다. 카드마다 승인자 역할과 상태가 그대로 보인다)와, 러너의 **Slack 봇**이 켜져 있다면 그 티켓의
**Slack 스레드**(알림, 단계 진행 줄, 게이트 메시지와 승인/반려 버튼이 실시간으로 올라온다).

```bash
curl -s localhost:3939/health   # {"status":"ok"} 나오면 러너가 떠 있는 것
```

Slack 봇을 만들고 켜는 방법(매니페스트로 앱 만들기 → 토큰 발급 → 채널 초대 → `sdlc.config.json` 설정 →
`npm start`)은 [`AI_SDLC/README.md`의 "3-C. Slack으로 쓰기"](AI_SDLC/README.md#3-c-slack으로-쓰기)에
순서대로 있다. Slack 없이도 파이프라인은 그대로 돌고, 승인은 Linear 카드로 계속할 수 있다 — Slack 버튼은
그 카드를 옮기는 또 하나의 손일 뿐이다.

세션 트랜스크립트 경로(`~/.claude/projects/<슬러그>/<세션id>.jsonl`)는 `/sdlc-status`로 확인한다.

---

## 4. 데모 앱과 시연

`AI_SDLC/todo-app/`이 시연용 앱이다. 프레임워크 없는 Node API 서버(`server/index.mjs`, :4100, 메모리 저장 —
재시작하면 시드 3건으로 돌아간다)와 React/Vite 멀티페이지 UI(:5180)로 이루어진다. `/`는 사용자용 할 일 앱
"Daybook", `/ops`는 관측 콘솔 "Daybook Ops"다.

```bash
cd AI_SDLC/todo-app
npm install
npm run dev        # API :4100 + UI :5180
npm test           # node --test (서버 API 테스트 + 모니터 테스트). 04 TEST 단계가 부르는 단일 명령
npm run build
npm run e2e        # bash e2e/check.sh. npm run dev가 떠 있어야 한다
```

러너는 `package.json`에서 `npm test`를 감지해 04 TEST에서 쓴다. 자세한 사용법은
`AI_SDLC/todo-app/README.md`에 있다.

파이프라인이 실제로 참조하는 파일도 있다. `ops/`는 저장소에 커밋돼 있고, `.claude/CLAUDE.md`·`REVIEW.md`는
플러그인 설치 후 `/sdlc-init`을 실행해야 생긴다(§1 "저장소 준비" 참고 — 이 예시 앱은 `.claude/`를
커밋해 두지 않는다).

- `.claude/CLAUDE.md` — 03 Build가 매 세션 읽는 컨텍스트(명령어/컨벤션/아키텍처/반복된 실수). 없으면 `/sdlc-init`이 만든다
- `REVIEW.md` — 05 Deploy의 `sdlc-review`가 따르는 리뷰 정책(없으면 `/sdlc-init`이 만든다)
- `ops/bands.yaml` + `ops/detect.sh` — 06 Maintain이 티어를 판정할 때 쓰는 기준·스크립트(이미 커밋돼 있다)

### 심어둔 버그

같은 제목의 미완료 할 일을 한 번 더 추가하면 409("이미 있음")가 나와야 하는데, 서버가 500으로 죽는다.
`server/index.mjs`의 `POST /api/todos`가 `dup.createdAt.toLocaleDateString("ko-KR")`을 부르는데
`createdAt`은 ISO 문자열이라 `TypeError`가 난다. `test/server.test.mjs`에는 중복 케이스 테스트가 일부러 없다.

환경변수 토글은 없다. 파이프라인이 worktree 브랜치와 PR로 고친다. 시연을 다시 돌리려면 그 PR을 머지하지
말고 닫는다 — main은 계속 버그가 있는 상태로 남는다.

확인: `npm run dev`를 띄운 상태에서 `npm run e2e`를 돌린다. 같은 제목을 두 번 POST해서 두 번째가 4xx(409)면
**exit 0**(PASS), 5xx면 **exit 1**(버그 재현, 시연 시작 상태), 서버에 닿지 않으면 **exit 2**(환경 문제)다.
ego-browser가 설치돼 있으면 화면 렌더링까지 확인하고, 없으면 HTML 응답만 확인하므로 저장소를 클론한 누구나
돌릴 수 있다.

### 프로덕션 모니터링

todo-app은 장애 감지부터 티켓 생성까지 한 앱에서 보여준다.

- `npm run monitor` — `ops/monitor.mjs`가 15초마다 `logs/access.jsonl`을 읽고 최근 2분(최소 10건)의
  5xx/4xx 비율을 계산한다. 판정은 `ops/detect.sh`가 한다(모델 미관여). 1회만 돌리려면 `npm run monitor:once`.
- 3σ 이탈이면 `claude -p`로 `sdlc-maintain` 스킬을 부른다. 도구는 Read/Glob/Grep/Skill, `Edit(docs/intent/**)`,
  Linear MCP만 허용된다. Claude가 로그와 코드를 진단하고 `docs/intent/INC-*.md`를 쓴 뒤 Linear MCP로 티켓
  (라벨 `sdlc-auto`, `incident`, `sdlc-depth: 1`)을 만든다. 모니터에는 `LINEAR_API_KEY`가 필요 없다.
- 이미 올라간 장애는 다시 트리거하지 않고, 복구되면 그 티켓에 댓글을 단다. `MONITOR_DRY_RUN=1`이면 티켓 대신
  초안을 `ops/outbox/`에 쓴다.
- `/ops` 콘솔의 카오스 주입(서버 500 비율 0/10/30/60%)은 의존성 장애를 흉내 낸 것이지 코드 버그가 아니다.
  Claude의 진단은 이 둘을 구분한다.
- 트래픽은 `npm run traffic -- ok|4xx|mixed|dup N`으로 만들고, `npm run reset`으로 초기화한다.

시연 흐름: 사용자가 같은 할 일을 두 번 추가 → 500 → 모니터 3σ 감지 → Claude가 "`server/index.mjs` 코드
버그"로 진단 → Linear 티켓 → 러너가 01~06 실행(수정 + 회귀 테스트 추가) → PR → 지표 회복.

### 시연 대본

`AI_SDLC/docs/demo-scenario.md`에 8구간 시간대별 대본이 있다. 준비 체크리스트, 대사, 실패 대비, Q&A 7문항 포함.
클라이맥스는 중복 제목 500이 모니터 3σ 감지 → Claude 진단 → Linear 티켓으로 이어지고, 러너가 그 티켓을 받아 04단계 e2e가 버그를 잡고 고치는 지점이다.

시연의 눈에 보이는 축은 이제 여섯 장의 Linear 카드다. 티켓 하나가 들어오면 `00-setup`이 승인 게이트
하위 이슈 6개를 만들고, 각 단계가 끝날 때마다 담당자가 그 카드를 Done(승인) 또는 Canceled(반려)로
옮기는 것 자체가 파이프라인이 실제로 사람 손을 거쳐 진행되고 있다는 증거가 된다. 관객에게는 이 여섯
장이 하나씩 옮겨지는 걸 보여주는 게 핵심이다.

---

## 5. Linear 말고 Jira를 쓴다면

교체 지점은 딱 한 곳이다. `AI_SDLC/runner/src/adapters/`. `TicketSource` 인터페이스가 이제 메서드
6개다(이전엔 3개) — 승인 게이트가 생기면서 하위 이슈 생성, 상태 조회, 코멘트 조회가 추가됐다.

```ts
export interface TicketSource {
  name: string;
  verify(headers, rawBody): boolean;                      // 서명 검증
  parse(rawBody): Ticket | null;                          // 이벤트 → 공통 Ticket, 관심 없으면 null
  createTicket(t: NewTicket): Promise<Ticket>;
  comment(ticketId: string, body: string): Promise<void>;
  createSubIssue(parentId: string, t: NewTicket): Promise<Ticket>;  // 00-setup의 게이트 하위 이슈 생성
  getStateType(issueId: string): Promise<StateType>;                // 게이트 폴링이 읽는 현재 상태
  listComments(issueId: string): Promise<IssueComment[]>;           // 반려 사유 코멘트 읽기
}
```

`adapters/jira.ts`가 이 인터페이스를 구현한 스텁으로 이미 들어 있고, 메서드마다 뭘 채워야 하는지
주석으로 안내가 붙어 있다.

가장 신경 쓸 곳은 `getStateType`이다. Jira의 상태 카테고리는 `new`/`indeterminate`/`done` 세 가지뿐이고
별도의 "취소됨" 카테고리가 없다. `done`을 그대로 `completed`로만 매핑하면 **게이트를 반려할 방법이
사라진다** — 프로젝트의 Canceled/Won't Do 해결(resolution)을 명시적으로 `"canceled"`로 매핑해야 한다.

각 메서드를 채우고 `sdlc.config.json`의 `ticketSource`를 `"jira"`로 바꾸면 파이프라인 나머지는 손대지
않아도 된다.

---

## 6. 문제가 생기면

| 증상 | 확인할 것 |
| --- | --- |
| 러너가 즉시 종료 | 필수 환경변수(`LINEAR_API_KEY`, webhook 모드면 `LINEAR_WEBHOOK_SECRET`, Slack을 쓴다면 `SLACK_BOT_TOKEN`/`SLACK_APP_TOKEN`)가 셸에 있는지, `sdlc.config.json`의 `linearTeamId`가 `REPLACE_WITH_LINEAR_TEAM_ID` 그대로 남아있지 않은지 |
| webhook이 401 | Linear 설정의 시크릿과 `LINEAR_WEBHOOK_SECRET`이 같은지 |
| 스킬/훅이 하나도 안 붙음 | `.claude/settings.json`의 마켓플레이스 `source.source`가 `"directory"`인지(`"local"`은 동작하지 않는다), `path`가 절대 경로가 아니라 프로젝트 기준 **상대 경로**인지 확인. 실패해도 에러가 안 뜬다. 확인: `cd AI_SDLC/todo-app && claude -p "네가 쓸 수 있는 sdlc-* 스킬 이름만 한 줄씩 출력해라." < /dev/null` — 9개(스킬 7 + 커맨드 2, `/sdlc-init`은 별도)가 나와야 정상, 안 나오면 `path`부터 의심 |
| `00-setup`이 게이트 맵을 못 만듦(`no approval-gate map` 에러로 파이프라인 중단) | Linear MCP가 파이프라인을 돌리는 `claude` 세션에 인증되어 있는지 확인 — `LINEAR_API_KEY` 환경변수와는 별개의 인증이다. 리허설만 필요하면 `SDLC_AUTO_APPROVE=1`로 우회 |
| 게이트가 계속 대기 상태로 멈춤 | 담당자가 하위 이슈를 Done/Canceled로 안 옮기면 `gateTimeoutMs`(기본 30분) 뒤 타임아웃으로 처리되고 그 단계에서 멈춘다. 카드를 옮기거나 `gateTimeoutMs`를 늘린다 |
| e2e가 아무것도 안 뱉음 | `cliLog`는 stdout이 아니라 **stderr**로 출력한다. `2>&1` 병합했는지 |
| ego-lite가 "Please complete the onboarding process first" | 앱을 한 번 실행해 GUI 온보딩을 마쳐야 한다. 확인: `printf 'cliLog("ok")\n' \| ego-browser nodejs 2>&1` |
| Slack 채널에 알림이 안 온다(`not_in_channel`) | 채널에 `/invite @AI-SDLC`로 봇을 초대했는지 확인한다 |
| Slack 버튼을 눌러도 반응이 없다 | `curl -s localhost:3939/health`로 러너가 떠 있는지 먼저 확인하고, Socket Mode 연결이 끊기지 않았는지 로그를 본다. 끊긴 동안에도 Linear 카드를 직접 옮기면 승인은 그대로 된다 |
| 훅이 모든 편집을 막음 | 훅 스크립트는 입력이 이상하면 통과시키도록(fail open) 되어 있다. `bash -n`으로 문법부터 확인 |

---

## 더 읽을 것

- `AI_SDLC/docs/architecture.md` — 6단계 전체 흐름과 아티팩트 표
- `AI_SDLC/docs/demo-scenario.md` — 시연 대본
- `AI_SDLC/README.md`의 "3-C. Slack으로 쓰기" — Slack 앱 만들기부터 사용법까지
- `docs/superpowers/specs/2026-09-04-ai-native-sdlc-design.md` — 이 프로젝트의 설계 문서와 범위 밖 항목
- `docs/superpowers/specs/2026-10-01-sdlc-slack-bot-design.md` — Slack 봇 설계 문서
