<p align="center">
  <img src="https://img.shields.io/badge/AI--native-SDLC-blueviolet?style=for-the-badge" alt="AI-native SDLC" />
  <a href="https://www.npmjs.com/package/ai-sdlc-runner"><img src="https://img.shields.io/npm/v/ai-sdlc-runner?style=for-the-badge&color=blue" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=for-the-badge" alt="Node >= 22" />
  <img src="https://img.shields.io/badge/license-MIT-lightgrey?style=for-the-badge" alt="License MIT" />
</p>

<h1 align="center">🔁 ai-sdlc-runner</h1>
<h3 align="center">Linear 티켓을 6단계 개발 파이프라인으로 돌리는 Slack 봇 러너</h3>

- 저장소에서 `npx ai-sdlc-runner init` → `start` 두 줄이면, Linear에 생긴 티켓이 Slack 스레드에서 **Plan → Design → Build → Test → Deploy → Maintain**으로 흘러간다. 단계마다 담당자가 Slack 버튼으로 승인하고, 각 단계는 `claude -p` 세션이 처리한다. 클론도, 설정 파일 편집도, 토큰 `export`도 없다.

---

```
$ npx ai-sdlc-runner init
◇  Slack 앱이 이미 있는가?
│  예
◇  Slack 봇 토큰 (xoxb-...)
│  ▪▪▪▪▪▪▪▪▪▪▪▪
│  확인됨 — acme 워크스페이스 · 봇 이름 ai-sdlc
◇  Slack 앱 토큰 (xapp-...)
│  ▪▪▪▪▪▪▪▪▪▪▪▪
◇  Linear API 키 (lin_api_...)
│  ▪▪▪▪▪▪▪▪▪▪▪▪
│  확인됨 — Peter Cha
◇  Linear 팀을 선택한다
│  ENG · Engineering
◇  Slack 채널 ID 또는 채널 링크
│  https://acme.slack.com/archives/C0ABC123
◇  새 티켓 알림 시 시작 방식
│  버튼
◇  저장소에 .claude/CLAUDE.md·REVIEW.md·ops/ 템플릿을 설치할까? (이미 있는 파일은 건너뛴다)
│  예
◇  완료 ─────────────────────────────╮
│  설정을 저장했다.                   │
│  다음: npx ai-sdlc-runner start     │
├────────────────────────────────────╯

$ npx ai-sdlc-runner start
[slack] 연결됨 — 채널 C0ABC123, 시작 모드 button, 폴링 주기 30000ms
[ai-sdlc-runner] listening on :3939
```

---

## AI-SDLC는 무엇인가

[The AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)을 실제로 돌아가게 만든 프로젝트다. 원문의 문제의식은 한 줄이다 — **코드는 더 이상 병목이 아니다. 프로세스가 병목이다.** Build는 AI로 빨라졌지만 Plan·Design·Test·Deploy·Maintain은 여전히 사람 속도로 남아 있고, 단계 사이에서 맥락이 끊긴다.

AI-SDLC는 이 여섯 단계를 하나의 닫힌 루프로 잇는다. 에이전트가 각 단계를 처리하고, 사람은 **단계마다 정해진 역할로 승인만** 한다.

| 단계 | 에이전트가 하는 일 | 남는 것 | 승인자 |
| --- | --- | --- | --- |
| `01 Plan` | 요청자를 인터뷰해 문제·목표·제약을 정리 | `docs/intent/<키>.md` | Product Owner |
| `02 Design` | intent를 근거로 설계, 정책 충돌 표시 | `docs/spec/<키>.md` | Product Owner |
| `03 Build` | 바꿀 파일·순서·위험을 계획 → 승인 후 구현 | `docs/plan/<키>.md`, 코드 | Engineer |
| `04 Test` | 성공 기준을 실제로 돌리고 독립 검증 | 테스트·e2e 결과 | Code Owner |
| `05 Deploy` | 3패스 리뷰 후 PR | PR | Release Manager |
| `06 Maintain` | 지표를 σ로 판정, 이상하면 새 티켓 → 다시 01 | 새 intent·티켓 | Service Owner |

프로젝트는 세 부분으로 되어 있다.

| 구성 | 역할 | 위치 |
| --- | --- | --- |
| Claude Code 플러그인 `ai-native-sdlc` | 단계별 스킬 7개, 되돌리기 어려운 행동을 막는 hook 8개, 검증 서브에이전트, `/sdlc-init`·`/sdlc-run` 명령 | [`AI_SDLC/plugin`](https://github.com/PeterCha90/FastCampus/tree/main/AI_SDLC/plugin) |
| **러너 `ai-sdlc-runner` (이 패키지)** | 티켓을 받아 단계마다 `claude -p`를 실행하고, Linear 게이트와 Slack 봇으로 승인을 받는다 | [`AI_SDLC/runner`](https://github.com/PeterCha90/FastCampus/tree/main/AI_SDLC/runner) |
| 예시 앱 `todo-app` | 운영 중 에러가 나면 티켓이 저절로 생기는 TODO 앱 — 06 → 01 루프를 눈으로 보여 준다 | [`AI_SDLC/todo-app`](https://github.com/PeterCha90/FastCampus/tree/main/AI_SDLC/todo-app) |

플러그인만으로도 Claude Code에서 `/sdlc-run ENG-12`처럼 대화형으로 쓸 수 있다. 러너는 이걸 **팀 단위로 자동화**한다 — 티켓이 생기면 알아서 시작하고, 승인은 역할별로 Slack 버튼에서 받는다. 전체 소개는 [AI_SDLC README](https://github.com/PeterCha90/FastCampus/blob/main/AI_SDLC/README.md)에 있다.

---

## 하는 일

| 기능 | 설명 |
| --- | --- |
| 티켓 알림 | Linear에 새 티켓이 생기면 30초 안에 채널에 알림과 `[▶ 파이프라인 시작]` 버튼 |
| 스레드 진행 | 티켓마다 스레드 하나에 단계 진행이 실시간으로 올라온다 |
| 역할별 승인 | `[✅ 승인]` `[⛔ 반려]`를 누른 사람이 그 역할의 Slack 사용자 그룹인지 확인한 뒤 Linear 게이트 카드를 옮긴다 |
| 01 인터뷰 | 미해결 질문을 요청자에게 스레드로 묻고, 답글을 모아 같은 Claude 세션으로 intent를 고친다 (최대 5회) |
| 반려 후 재작업 | 01·02·03 반려 사유를 반영해 그 단계를 다시 실행하고 다시 승인받는다 (최대 3회) |
| 닫힌 루프 | 06이 지표 이상을 감지하면 `sdlc-auto` 티켓을 만들고, 그 티켓이 다시 01부터 흐른다 (깊이 3 상한) |
| 공개 URL 불필요 | Slack은 Socket Mode, Linear는 폴링 — 노트북에서도 터널 없이 돈다 |

Slack 사용자는 아무것도 설치하지 않는다. 러너를 띄운 컴퓨터 한 대에만 Claude Code가 있으면 된다.

---

## 준비물

| 항목 | 확인 |
| --- | --- |
| Node 22 이상 | `node -v` |
| Claude Code (`claude`) 로그인 | `claude auth status` |
| Claude Code에 Linear MCP 연결 | `claude mcp list`에서 `linear … ✔ Connected` |
| 작업시킬 git 저장소 | 러너가 티켓마다 worktree를 만든다 |
| Slack 앱 | `npx ai-sdlc-runner manifest --open`으로 만든다 |
| Linear 계정 | 개인 API 키를 발급할 수 있어야 한다 |

---

## 시작하기

파이프라인이 작업할 저장소에서:

```bash
cd ~/code/my-app
npx ai-sdlc-runner init
npx ai-sdlc-runner start
```


`init`은 아래 순서로 묻는다. 토큰은 가려진 입력으로 받고 **그 자리에서 실제 API로 검증**한다. 틀리면 그 단계만 다시 묻고(최대 3번), 중간에 Ctrl+C로 나가면 아무것도 저장하지 않는다.

| 순서 | 묻는 것 | 검증 |
| --- | --- | --- |
| 1 | 대상 저장소 | git 저장소가 아니면 중단 |
| 2 | Slack 앱이 있는지 | 없으면 `manifest --open`으로 만들고 오라고 안내 |
| 3 | Slack 봇 토큰 `xoxb-…` | `auth.test` — 워크스페이스·봇 이름 표시 |
| 4 | Slack 앱 토큰 `xapp-…` | `apps.connections.open` |
| 5 | Linear API 키 `lin_api_…` | 계정 조회 후 팀 목록에서 선택 |
| 6 | Slack 채널 (ID 또는 링크) | 확인 메시지를 실제로 보낸다. 봇이 없으면 `/invite` 안내 |
| 7 | 승인 역할 그룹 (선택) | 역할별로 Slack 사용자 그룹 선택. 건너뛰면 채널 누구나 승인 |
| 8 | 시작 방식 | 버튼(기본) / 자동 |
| 9 | 템플릿 설치 | `.claude/CLAUDE.md`·`REVIEW.md`·`ops/`가 없으면 설치 (있으면 건너뜀) |

봇 토큰 자리에 앱 토큰을 넣는 식의 실수는 API를 부르기 전에 접두어로 잡는다.

### 토큰은 어디서

| 토큰 | 받는 곳 |
| --- | --- |
| `xoxb-…` 봇 토큰 | Slack 앱 → **Install App** → Bot User OAuth Token |
| `xapp-…` 앱 토큰 | Slack 앱 → **Basic Information → App-Level Tokens** → `connections:write`로 생성 |
| `lin_api_…` Linear 키 | Linear → **Settings → Security & access → Personal API keys** |

---

## 명령

| 명령 | 하는 일 |
| --- | --- |
| `init` | 대화형 설정. 다시 실행하면 기존 값을 기본값으로 보여 주고, 토큰은 Enter로 유지 |
| `init --yes --channel <id> --team <키>` | 비대화형 설정 (서버·CI). 토큰은 환경변수에서 읽고 같은 방식으로 검증 |
| `start` | 러너 기동. 설정이 없으면 `init`을 안내하고 종료 |
| `start --skip-checks` | 기동 전 점검을 건너뛴다 |
| `doctor` | 점검 결과를 표로 출력 — Node, claude 로그인, Linear MCP, 토큰 3개, git 저장소, 템플릿, `ego-browser` |
| `manifest` | Slack 앱 매니페스트 출력. `--open`이면 앱 생성 페이지를 연다 |
| `config` | 현재 설정 출력 (토큰은 앞 8자만) |

전역 옵션: `--repo <경로>` (기본: 현재 폴더), `--home <폴더>` (기본: `~/.ai-sdlc`, 또는 `AI_SDLC_HOME`).

`start`는 먼저 `doctor`와 같은 점검을 하고, 막히는 항목(❌)이 있으면 시작하지 않는다 — Node 22 미만, `claude` 미설치·미로그인, Linear MCP 미연결, 토큰 검증 실패. Linear MCP는 00 Setup이 게이트 하위 이슈를 만들 때 쓴다. `ego-browser`·템플릿 누락은 경고(⚠️)만 한다(git 저장소 여부는 `init`이 막는다).

---

## Slack에서 쓰기

| 입력 | 동작 |
| --- | --- |
| Linear에 티켓 생성 | 채널에 🆕 알림 + `[▶ 파이프라인 시작]` `[무시]` |
| `/sdlc <제목>` | Linear에 티켓을 만들고 알림을 올린다 |
| `/sdlc run ENG-12` | 기존 티켓으로 시작 |
| `/sdlc status` | 진행 중인 실행과 대기 중인 역할 |
| `/sdlc help` | 사용법 |
| `[✅ 승인]` / `[⛔ 반려]` | 역할 확인 후 Linear 게이트 카드를 Done / Canceled로. 반려는 사유를 입력받는다 |
| `[답변 반영]` / `[이대로 진행]` | 01 인터뷰 — 스레드 답글을 반영해 intent를 고치거나, 질문을 남긴 채 진행 |

승인 기록은 Linear 게이트 카드에 남는다. Slack이 끊겨도 Linear에서 카드를 직접 옮기면 똑같이 진행된다. **봇이 들어간 채널의 멤버는 누구나 실행을 시작할 수 있고**, 실행은 저장소에서 `claude -p`를 권한 확인 없이 돌리므로 봇은 제한된 채널에 둔다.

---

## 설정

`init`이 저장하는 위치 — 저장소마다 따로:

```
~/.ai-sdlc/
└── repos/<저장소 폴더 이름>-<해시 10자>/
    ├── config.json        비밀이 아닌 설정
    ├── credentials.json   토큰 (권한 600, 폴더 700)
    ├── .state/            단계 실행 기록
    └── .worktrees/        티켓별 worktree
```

`config.json`에서 바꿀 만한 값:

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `slack.startMode` | `button` | `auto`면 알림과 동시에 시작 |
| `slack.roleGroups` | `{}` | 역할 이름 → Slack 사용자 그룹 ID (`S…`) |
| `gateRoles` | PO / PO / Engineer / Code Owner / Release Manager / Service Owner | 단계별 승인자 이름 |
| `linearPollIntervalMs` | `30000` | 새 티켓 확인 간격 |
| `gateTimeoutMs` | `1800000` | 승인 대기 상한 (30분, 넘으면 중단) |
| `interviewMaxRounds` | `5` | 01 인터뷰 최대 라운드 |
| `reworkMaxAttempts` | `3` | 01·02·03 반려 후 재작업 최대 횟수 |
| `maxAutoTicketDepth` | `3` | 06이 연쇄로 만들 수 있는 자동 티켓 깊이 |
| `e2eDriver` / `demoAppUrl` | `ego-lite` / `http://localhost:5173` | 04 Test의 e2e 도구와 열어 볼 앱 주소 |

환경변수가 있으면 파일보다 우선한다: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `LINEAR_API_KEY`, `LINEAR_WEBHOOK_SECRET`, `AI_SDLC_HOME`.

---

## 트러블슈팅

| 증상 | 해결 |
| --- | --- |
| 무엇이 문제인지 모르겠다 | `npx ai-sdlc-runner doctor` |
| `start`가 "먼저 init" 을 출력한다 | 그 저장소에서 `init`을 실행하지 않았다. `--repo`로 다른 저장소를 가리키고 있지 않은지도 확인 |
| `Linear MCP 연결` 이 실패로 나온다 | Claude Code에서 `/mcp`로 Linear를 다시 인증한다 |
| `/sdlc` 를 치면 "앱이 응답하지 않음" | 러너가 꺼져 있다. `start`가 떠 있는지 확인 |
| 봇이 채널에 없다고 나온다 | 채널에서 `/invite @AI-SDLC` 후 `init` 다시 실행 |
| 04 Test e2e가 매번 실패하고 06이 티켓을 만든다 | `ego-browser`가 준비됐는지(`doctor`), `demoAppUrl`에 앱이 떠 있는지 확인 |
| 토큰을 바꿔야 한다 | `init`을 다시 실행해 해당 토큰만 새로 넣는다 |

---

## 개발

러너 자체를 고칠 때는 소스에서 직접 실행한다. 이 경로는 `runner/sdlc.config.json`과 환경변수를 쓰고, 상태는 `runner/.state/`에 남는다.

```bash
cd AI_SDLC/runner
npm install
npm start                 # sdlc.config.json + 환경변수
npm test                  # node:test, Slack·Linear 실제 호출 없음
npx tsc --noEmit
```

새 버전 배포:

```bash
npm run build             # tsc → dist/
npm run smoke:pack        # npm pack → 임시 설치 → --help·manifest·config 확인
npm publish
```

npm은 새 버전을 바로 공개하지 않고 대기(staged) 상태로 받는다. npmjs.com에서 메인테이너가 2단계 인증으로 승인해야 공개되고, 그 전까지 `npm view ai-sdlc-runner version`은 이전 버전을 보여 준다. 2단계 인증이 보안 키(Touch ID·패스키) 방식이면 `npm publish --auth-type=web`으로 브라우저에서 승인한다. 배포할 때는 `package.json`과 `../plugin/.claude-plugin/plugin.json`의 버전을 함께 올린다.

`prepack`이 빌드하고 `../plugin`을 패키지 안 `plugin/`으로 복사한다. Node는 `node_modules` 안의 TypeScript를 실행하지 않으므로 배포본은 `dist/`의 JavaScript다.

---

## 프로젝트 구조

```
runner/
├── src/
│   ├── cli.ts               # npx 진입점
│   ├── cli/                 # init · doctor · verify · 인자 파서
│   ├── index.ts             # 서버, 대기열, Slack·감시 연결
│   ├── pipeline.ts          # 00~06 단계, 인터뷰·재작업 루프
│   ├── gate.ts              # Linear 카드 상태 → 승인/반려/대기
│   ├── linear-watcher.ts    # 새 티켓 폴링
│   ├── slack/               # Bolt 앱, 알림, 인터뷰, 역할 확인, 메시지
│   ├── adapters/            # 티켓 소스 (linear, jira 스텁)
│   └── config.ts · paths.ts · user-config.ts
├── slack/manifest.yaml      # Slack 앱 매니페스트
├── scripts/                 # 패키징, 스모크 테스트
└── test/                    # node:test
```

---

## License

MIT

---

<p align="center">
  Made by <a href="https://github.com/PeterCha90">Peter Cha</a> · <a href="https://github.com/PeterCha90/FastCampus">FastCampus/AI_SDLC</a>
</p>
