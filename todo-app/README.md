# todo-app — 에러가 나면 티켓이 저절로 생기는 TODO 앱

AI-SDLC 06 Maintain 단계의 "운영 중 이상 감지 → 티켓 → 01 Plan" 흐름을 눈으로 보여주는 시연용 앱이다.

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

티켓이 들어갈 팀은 `AI_SDLC/runner/sdlc.config.json`의 `linearTeamId`다. 다른 팀이면 `LINEAR_TEAM_ID`로 덮어쓴다.

## 실행

```bash
npm install
npm run dev        # 터미널 1 — API 서버(:4100) + 화면(:5180)
npm run monitor    # 터미널 2 — 모니터. 판정 로그를 여기서 본다
```

화면은 두 개다. 브라우저 창 두 개를 나란히 띄운다.

| 주소 | 누가 보나 | 내용 |
| --- | --- | --- |
| http://localhost:5180 | 사용자 | **Daybook** — 할 일 앱. 시연용 장치가 전혀 없는 평범한 제품 화면 |
| http://localhost:5180/ops | 운영자 | **Daybook Ops** — 에러율 추이, 모니터 상태, 사건과 클로드 진단, 모니터 활동, 장애 주입, 에러 로그 |

리허설할 때는 `MONITOR_DRY_RUN=1 npm run monitor`로 띄운다. 클로드가 진단까지는 똑같이 하지만 Linear 도구를 받지 않고, 티켓 초안을 `ops/outbox/*.md`에 쓴다.

## 시연 순서

1. 왼쪽에 앱, 오른쪽에 Ops 콘솔을 띄운다. 콘솔 모니터 카드가 **감시 중**인지 확인한다.
2. 앱에서 할 일을 몇 개 추가하고 체크한다. 콘솔의 **트래픽 발생 → 정상 요청**으로 표본을 채운다(최소 10건 전에는 판정을 미룬다).
3. 콘솔의 **장애 주입 → 서버 오류 30%**. 앱에서 할 일을 추가·체크하면 일부가 실패하고, 앱 하단에 "서버와의 연결이 잠시 불안정해요 · 500" 알림과 **다시 시도** 버튼이 뜬다. 새로고침하면 목록을 못 불러오는 화면이 나올 수도 있다.
4. 15초 안에 콘솔 그래프의 5xx 선이 3σ 점선을 넘고, **사건** 카드에 "클로드가 로그와 코드를 읽고 원인을 찾는 중…"이 뜬다.
5. 1~3분 뒤 티켓 번호(↗ Linear 링크)와 **추정 원인**이 뜬다. Linear 티켓에는 진단과 intent 문서가 담겨 있고, `docs/intent/INC-*.md`도 생긴다. 장애가 계속돼도 같은 지표로는 클로드를 **다시 부르지 않는다**.
6. 앱에서 빈 제목으로 추가를 누르면 입력창 아래에 서버의 400 응답이 뜬다. 이런 요청이 몰리면(콘솔의 **잘못된 입력 / 없는 리소스**) 4xx 비율이 따로 판정돼 **별도 티켓**이 열린다.
7. 장애를 **끔**으로 돌리고 정상 요청을 보낸다. 창(2분)에서 에러가 빠지면 모니터가 티켓에 **회복 코멘트**를 달고 사건을 닫는다. 콘솔의 **최근 해결**로 옮겨간다.

터미널에서도 같은 요청을 보낼 수 있다: `npm run traffic -- ok 30`, `npm run traffic -- 4xx 20`, `npm run traffic -- mixed 40`.
처음 상태로 돌리려면 `npm run reset`(로그·모니터 상태·outbox 삭제). 서버를 다시 띄우면 할 일 목록도 초기값으로 돌아간다.

## 판정 기준 — `ops/bands.yaml`

| 지표 | 1σ 기록 | 2σ 진단 대상 | 3σ 티켓 |
| --- | --- | --- | --- |
| `api_5xx_rate` | 2% | 4% | 6% 이상 |
| `api_4xx_rate` | 6.25% | 12.5% | 18.75% 이상 |

`ops/detect.sh`는 `AI_SDLC/plugin/templates/ops/detect.sh`와 같은 스크립트다(self-check 대상 지표만 `api_5xx_rate`로 바꿨다). 판정은 `|값 - baseline| / sigma` 산수뿐이고 모델은 관여하지 않는다.

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
| `public/fonts/` | 타이틀 폰트 눈누 기초고딕 |
| `ops/monitor.mjs` | 주기 판정, 3σ 에서 클로드 호출, 중복 방지, 회복 처리 |
| `ops/claude-triage.mjs` | `claude -p` 호출. 프롬프트, 도구 제한(`--tools`, `dontAsk`, `Edit(docs/intent/**)`), 결과 스키마 |
| `ops/metrics.mjs` | 로그 읽기와 비율 계산. 서버 패널과 모니터가 같이 쓴다 |
| `ops/detect.sh`, `ops/bands.yaml` | σ 판정 |
| `test/monitor.test.mjs` | `npm test` — 판정·중복 방지·회복·클로드 위임과 실패 시 대체·도구 제한 인자 |
