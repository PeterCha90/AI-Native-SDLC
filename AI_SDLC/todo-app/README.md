# todo-app — AI-native SDLC 시연 무대

AI-SDLC 파이프라인이 실제로 돌아가는 대상 앱이다. 러너(`../runner`)의 `repoPath`가 이 폴더를 가리킨다. 두 가지 루프를 한 앱에서 보여준다.

- **개발 루프 (01~05)** — 일부러 심어둔 버그를 e2e가 잡고, 파이프라인이 intent → spec → plan → 코드 수정 + 회귀 테스트 → PR 까지 간다.
- **운영 루프 (06)** — 운영 중 에러 로그를 모니터가 σ로 판정하고, 3σ면 클로드가 원인을 진단해 Linear 티켓을 연다. 그 티켓이 다시 01을 연다.

## 파이프라인을 직접 돌려보려면 — 복사해서 쓴다

이 폴더는 `PeterCha90/AI-Native-SDLC` 저장소 안의 전시용이다. 05 Deploy는 `gh pr create`로 PR을 여는데,
이 폴더를 그대로 쓰면 그 PR이 내가 쓸 권한 없는 원본 저장소로 올라간다. 파이프라인을 PR까지 끝까지
돌려보려면 내 GitHub 저장소로 복사해서 쓴다.

```bash
git clone https://github.com/PeterCha90/AI-Native-SDLC.git
cp -r AI-Native-SDLC/AI_SDLC/todo-app ~/my-todo && cd ~/my-todo
git init && git add . && git commit -m "init: todo-app"
gh repo create my-todo --private --source=. --push   # 05 Deploy가 여기에 PR을 올린다
npm install
npx ai-sdlc-runner init     # .claude/CLAUDE.md·REVIEW.md·ops/ 가 여기서 처음 생긴다
npx ai-sdlc-runner start
```

아래 "처음 시작하기"·"처음 받았다면 — 5분 확인"의 명령은 복사한 폴더(`~/my-todo`) 안에서도 그대로
쓴다 — 전부 상대 경로다. `.claude/`가 저장소에 없는 것도 똑같다: 위 `npx ai-sdlc-runner init`(또는
`/sdlc-init`)이 거기서 처음 만든다.

## 처음 시작하기 — SDLC 플러그인 켜기

이 예시 앱은 `.claude/`를 저장소에 커밋해 두지 않는다 — 클론(또는 위처럼 복사)한 사람이 직접 만들어
보게 한 것이다("생성하는 재미"). 파이프라인이 이 폴더에서 실제로 걸리는 걸 보려면 먼저 아래를 한다.

1. 플러그인을 설치한다: `claude plugin marketplace add PeterCha90/AI-Native-SDLC && claude plugin install ai-native-sdlc@ai-sdlc`
   (또는 이 폴더 안에서 `--scope project`를 붙이면 `.claude/settings.json`까지 CLI가 바로 써준다)
2. 이 폴더(원본이면 `cd AI_SDLC/todo-app`, 복사했으면 `cd ~/my-todo`)에서 Claude Code를 열고
   `/sdlc-init`을 실행한다 — 없으면 `.claude/CLAUDE.md`·`REVIEW.md`·`ops/bands.yaml`·`ops/detect.sh`를
   만든다(이미 있는 파일은 건드리지 않는다).
3. 아래 "처음 받았다면 — 5분 확인"으로 앱 자체를 확인한다.

## 처음 받았다면 — 5분 확인

```bash
cd AI_SDLC/todo-app
npm install
npm test           # 서버 API·모니터 테스트. 전부 통과한다(심어둔 버그는 테스트가 없다)
npm run dev        # 다른 터미널에서 켜 둔다 — API :4100, 화면 :5180
npm run e2e        # exit 1 — 심어둔 버그가 재현된다
```

`npm run e2e`가 `FAIL: 같은 제목을 두 번 추가하면 서버가 500 로 죽는다`로 끝나면 정상이다. 브라우저로 http://localhost:5180 을 열어 같은 할 일을 두 번 추가해 봐도 된다. `ego-browser`가 없어도 e2e는 돈다(화면은 HTML 응답만 확인).

## 심어둔 버그

**같은 제목의 할 일을 두 번 추가하면 500.**

- 서버(`server/index.mjs`의 `POST /api/todos`)에는 "끝나지 않은 같은 할 일이 있으면 409로 알려준다"는 중복 처리가 있다. 그런데 에러 메시지에 날짜를 넣으면서 `createdAt`(ISO 문자열)에 `toLocaleDateString`을 호출해 TypeError로 죽는다.
- 화면(`src/app/App.jsx`)은 409를 받으면 입력창 아래에 "이미 목록에 있는 할 일이에요"를 보여주게 돼 있다. 버그 때문에 사용자는 대신 "서버와의 연결이 잠시 불안정해요 · 500"을 본다.
- `test/server.test.mjs`에는 중복 케이스가 **일부러 없다**. 파이프라인이 고치면서 회귀 테스트를 추가하는 것이 시연 포인트다.
- 환경 변수 토글은 없다. 파이프라인은 worktree 브랜치에서 고치고 PR을 연다. 다시 시연하려면 그 PR을 머지하지 않고 닫는다 — main은 버그 상태 그대로다.

## e2e — `npm run e2e` (`e2e/check.sh`)

`npm run dev`가 떠 있어야 한다.

1. 화면이 뜨는지 본다. `ego-browser`가 있으면 실제 브라우저로 열어 렌더링된 글자를 읽고, 없으면 HTML 응답만 확인한다.
2. 같은 제목을 API로 두 번 추가한다. 두 번째가 4xx(409)면 통과, 5xx면 버그 재현이다.
3. 만든 항목을 지운다.

| exit | 뜻 |
| --- | --- |
| 0 | 통과 |
| 1 | 버그 재현 (또는 화면이 안 뜸) |
| 2 | 환경 문제 — 서버가 안 떠 있음. 06 Maintain이 장애로 세지 않도록 버그와 구분한다 |

## 운영 루프 — 모니터

```
브라우저 ──► TODO API(:4100) ──► logs/access.jsonl ◄── 모니터(15초마다, 스크립트)
                                                        │ 최근 2분 5xx·4xx 비율 계산
                                                        ▼
                                                   ops/detect.sh (σ 판정, 모델 없음)
                                                        │ 3σ 이상일 때만
                                                        ▼
                                       claude -p  (sdlc-maintain 스킬, 읽기 전용 + Linear MCP)
                                         · 로그와 서버 코드를 읽고 원인 추정
                                         · 이미 열린 장애 티켓과 같은 사건인지 확인
                                         · docs/intent/INC-*.md 작성 → Linear 티켓 생성
                                                        │
                                                        ▼
                                          AI-SDLC 러너가 새 티켓으로 받아 01 Plan 시작
```

역할을 나눴다. **"언제 움직일지"는 스크립트**가 정한다. 싸고, 같은 로그엔 항상 같은 판정이 나오고, 폭주하지 않는다. **"무엇이 문제이고 뭘 해야 하는지"는 클로드**가 정한다. 틀에 숫자만 채운 티켓이 아니라 원인 추정과 intent 문서가 담긴 티켓이 나온다.

AI-SDLC 러너의 06 단계는 **티켓 하나를 처리한 직후 그 실행의 테스트 결과만** 본다. 배포 뒤 운영 중에 터지는 에러는 이 모니터가 잡는다.

## Linear 인증 — 모니터에는 API 키가 필요 없다

| 누가 | Linear에 하는 일 | 인증 |
| --- | --- | --- |
| 클로드 (모니터가 3σ에서 부름) | 티켓 생성, 중복 확인, 회복 코멘트 | Linear MCP (`claude mcp list`에서 `linear ✔ Connected`) |
| AI-SDLC 러너(+슬랙봇) | 새 티켓 감지, 게이트 상태 확인 | `LINEAR_API_KEY` |
| 모니터 스크립트 | 없음. 클로드가 실패했을 때만 틀 티켓을 대신 연다 | `LINEAR_API_KEY`가 있으면 Linear, 없으면 `ops/outbox/` |

티켓이 들어갈 팀은 `../runner/sdlc.config.json`의 `linearTeamId`다. 다른 팀이면 `LINEAR_TEAM_ID`로 덮어쓴다.

## 실행

```bash
npm run dev        # 터미널 1 — API 서버(:4100) + 화면(:5180)
npm run monitor    # 터미널 2 — 모니터. 판정 로그를 여기서 본다
```

모니터는 키 파일로 `todo-app/.env`를 먼저, 없으면 `../.env`(러너와 같이 쓰는 파일)를 읽는다.

화면은 두 개다. 브라우저 창 두 개를 나란히 띄운다.

| 주소 | 누가 보나 | 내용 |
| --- | --- | --- |
| http://localhost:5180 | 사용자 | **Daybook** — 할 일 앱. 시연용 장치가 전혀 없는 평범한 제품 화면 |
| http://localhost:5180/ops | 운영자 | **Daybook Ops** — 에러율 추이, 모니터 상태, 사건과 클로드 진단, 모니터 활동, 장애 주입, 에러 로그 |

리허설할 때는 `MONITOR_DRY_RUN=1 npm run monitor`로 띄운다. 클로드가 진단까지는 똑같이 하지만 Linear 도구를 받지 않고, 티켓 초안을 `ops/outbox/*.md`에 쓴다.

## 시연 순서

1. 왼쪽에 앱, 오른쪽에 Ops 콘솔을 띄운다. 콘솔 모니터 카드가 **감시 중**인지 확인한다.
2. 앱에서 할 일을 몇 개 추가하고 체크한다. 콘솔의 **트래픽 발생 → 정상 요청**으로 표본을 채운다(최소 10건 전에는 판정을 미룬다).
3. **코드 버그로 인한 장애.** 앱에서 같은 할 일을 두 번 추가한다(몇 명이 그런다고 치고 콘솔의 **같은 할 일 반복 추가**를 눌러도 된다). 앱 하단에 "서버와의 연결이 잠시 불안정해요 · 500" 알림이 뜬다.
4. 15초 안에 콘솔 그래프의 5xx 선이 3σ 점선을 넘고, **사건** 카드에 "클로드가 로그와 코드를 읽고 원인을 찾는 중…"이 뜬다.
5. 1~3분 뒤 티켓 번호(↗ Linear 링크)와 **추정 원인**이 뜬다. 클로드가 `server/index.mjs`의 TypeError를 짚어 "코드 버그"로 분류한다. Linear 티켓에는 진단과 intent 문서가 담겨 있고, `docs/intent/INC-*.md`도 생긴다. 장애가 계속돼도 같은 지표로는 클로드를 **다시 부르지 않는다**. 러너가 떠 있으면 이 티켓으로 01 Plan부터 파이프라인이 돈다.
6. **의존성 장애와 비교.** 콘솔의 **장애 주입 → 서버 오류 30%**는 DB 타임아웃을 흉내 낸다. 같은 5xx지만 클로드는 "코드 버그가 아니라 의존성 장애(주입)"로 구분해 진단한다.
7. 앱에서 빈 제목으로 추가를 누르면 입력창 아래에 서버의 400 응답이 뜬다. 이런 요청이 몰리면(콘솔의 **잘못된 입력 / 없는 리소스**) 4xx 비율이 따로 판정돼 **별도 티켓**이 열린다.
8. 장애를 **끔**으로 돌리고 정상 요청을 보낸다. 창(2분)에서 에러가 빠지면 모니터가 티켓에 **회복 코멘트**를 달고 사건을 닫는다. 콘솔의 **최근 해결**로 옮겨간다.

터미널에서도 같은 요청을 보낼 수 있다: `npm run traffic -- ok 30`, `npm run traffic -- 4xx 20`, `npm run traffic -- mixed 40`, `npm run traffic -- dup 8`.
처음 상태로 돌리려면 `npm run reset`(로그·모니터 상태·outbox 삭제). 서버를 다시 띄우면 할 일 목록도 초기값으로 돌아간다.

## 판정 기준 — `ops/bands.yaml`

| 지표 | 1σ 기록 | 2σ 진단 대상 | 3σ 티켓 |
| --- | --- | --- | --- |
| `api_5xx_rate` | 2% | 4% | 6% 이상 |
| `api_4xx_rate` | 6.25% | 12.5% | 18.75% 이상 |
| `e2e_failure_rate` | — | — | 실패(1) = 10σ |

`e2e_failure_rate`는 모니터가 아니라 러너가 쓴다. 파이프라인 06 단계에서 이번 실행의 e2e 결과(통과 0, 실패 1)를 넘긴다.

`ops/detect.sh`는 `../plugin/templates/ops/detect.sh`와 같은 스크립트다(self-check 대상 지표만 `api_5xx_rate`로 바꿨다). 판정은 `|값 - baseline| / sigma` 산수뿐이고 모델은 관여하지 않는다.

## 설정 (환경 변수)

| 변수 | 기본값 | 뜻 |
| --- | --- | --- |
| `MONITOR_INTERVAL_SEC` | 15 | 판정 주기 |
| `MONITOR_WINDOW_SEC` | 120 | 비율을 계산할 최근 구간. 시연에서 회복을 빨리 보려면 60 |
| `MONITOR_MIN_REQUESTS` | 10 | 이보다 요청이 적으면 판정하지 않는다(1건 중 1건 실패 = 100% 방지) |
| `MONITOR_LABELS` | `sdlc-auto,incident` | 티켓 라벨. `sdlc-auto`가 있어야 러너가 깊이 제한을 센다 |
| `MONITOR_SDLC_DEPTH` | 1 | 티켓 본문의 `sdlc-depth` 값 |
| `MONITOR_DRY_RUN=1` | — | 클로드는 진단만 하고 티켓은 outbox에 쓴다 |
| `MONITOR_CLAUDE=0` | — | 클로드를 부르지 않고 틀 티켓만 쓴다 |
| `MONITOR_CLAUDE_MODEL` | `sonnet` | 진단 세션 모델 |
| `MONITOR_CLAUDE_TIMEOUT_SEC` | 300 | 이 시간을 넘기면 세션을 끊고 틀 티켓으로 대신 연다 |
| `LINEAR_TEAM_ID` | runner 설정값 | 티켓을 열 팀 |
| `LINEAR_API_KEY` | — | 대체 경로(클로드 실패)에서만 쓴다 |

## 상시 운영이라면

`npm run monitor`는 시연용으로 계속 떠 있는 루프다. 실제로는 한 번 판정하고 끝나는 `--once`를 스케줄러에 건다. 사건 상태(`ops/.monitor-state.json`)가 파일에 남으므로 실행 사이에도 중복 티켓이 생기지 않는다.

```cron
* * * * * cd /path/to/todo-app && node ops/monitor.mjs --once >> logs/monitor.log 2>&1
```

## 파일

| 경로 | 역할 |
| --- | --- |
| `server/index.mjs` | TODO API. 요청마다 `logs/access.jsonl`에 기록. `/api/_ops/*`(장애 주입, 콘솔 통계)는 기록하지 않는다 |
| `src/app/` | Daybook 할 일 앱 (`index.html`) |
| `src/ops/` | Daybook Ops 관측 콘솔 (`ops.html`, 개발 서버에서는 `/ops`) |
| `ops/monitor.mjs` | 주기 판정, 3σ 에서 클로드 호출, 중복 방지, 회복 처리 |
| `ops/claude-triage.mjs` | `claude -p` 호출. 프롬프트, 도구 제한(`--tools`, `dontAsk`, `Edit(docs/intent/**)`), 결과 스키마 |
| `ops/metrics.mjs` | 로그 읽기와 비율 계산. 서버 패널과 모니터가 같이 쓴다 |
| `ops/detect.sh`, `ops/bands.yaml` | σ 판정 |
| `test/server.test.mjs` | `npm test` — API 기본 동작(CRUD, 400, 404, 405, 접근 로그). 중복 케이스는 일부러 없다 |
| `test/monitor.test.mjs` | `npm test` — 판정·중복 방지·회복·클로드 위임과 실패 시 대체·도구 제한 인자 |
| `e2e/check.sh` | `npm run e2e` — 화면 렌더링 + 중복 추가 버그 재현 |
| `.claude/CLAUDE.md`, `REVIEW.md` | 파이프라인이 이 저장소에서 작업할 때 읽는 규칙과 리뷰 기준. 저장소에 커밋돼 있지 않다 — 없으면 `/sdlc-init`이 만든다(위 "처음 시작하기" 참고) |
| `.claude/settings.json` | 이 폴더에서 Claude Code를 열면 `ai-native-sdlc` 플러그인을 자동으로 켠다(`..` 마켓플레이스). 저장소에 커밋돼 있지 않다 — 플러그인을 `--scope project`로 설치하면 생긴다 |
