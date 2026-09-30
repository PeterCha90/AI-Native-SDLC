# `npx ai-sdlc-runner` — 클론·설정 파일·export 없이 러너 띄우기

날짜: 2026-10-01
대상: `AI_SDLC/runner/` (npm 패키지화), `AI_SDLC/plugin/` (패키지에 동봉)
선행 설계: [Slack 봇](2026-10-01-sdlc-slack-bot-design.md), [인터뷰·재작업](2026-10-01-sdlc-interview-rework-design.md)

## 1. 문제

러너를 맡는 사람이 지금 해야 하는 일: 저장소 클론 → `sdlc.config.json` 손으로 편집 → 토큰 세 개를 매번 `export` → `npm start`. 설정 실수(채널 ID, 팀 ID, 토큰 종류 혼동)는 기동 후에야 드러난다.

## 2. 목표

```bash
cd ~/code/my-app            # 파이프라인이 작업할 저장소
npx ai-sdlc-runner init     # 대화형 설정: 토큰 입력·검증, Linear 팀·Slack 채널 고르기, 템플릿 설치
npx ai-sdlc-runner start    # 이후엔 이것만
```

- **클론 없음.** 러너와 플러그인은 npm 패키지에 들어 있다.
- **export 없음.** `init`이 토큰을 입력받아 검증하고 권한 600 파일에 저장한다. 환경변수는 덮어쓰기 용도로만 남긴다.
- **설정 실수는 `init`에서 잡는다.** 토큰마다 실제 API를 한 번 호출해 확인하고, 팀·채널·사용자 그룹은 목록에서 고른다.

성공 기준: Slack 앱만 만들어 둔 사람이 빈 터미널에서 두 명령만으로 봇을 띄우고, 채널에 "연결 확인" 메시지를 받는다.

### 하지 않는 것

- 백그라운드 서비스 등록(launchd, systemd), Docker 이미지 — `start`는 포그라운드. 다음 단계에서 이 CLI를 감싸 만든다.
- OS 키체인 연동 — 네이티브 의존성이 필요하다. 권한 600 파일로 시작한다.
- 여러 저장소를 한 러너로 — 저장소마다 `init` 한 번(설정은 저장소별로 분리, §4).
- npm 배포 자체 — 패키지를 만들고 `npm pack`으로 검증까지 한다. `npm publish`는 계정 주인이 실행한다.

## 3. 명령

| 명령 | 하는 일 |
| --- | --- |
| `init` | 대화형 설정(§5). 이미 설정이 있으면 기존 값을 기본값으로 보여 주고 바꿀 것만 묻는다 |
| `start` | 설정·자격 증명을 읽고 러너 기동(지금의 `npm start`와 같음). 설정이 없으면 `init`을 안내하고 종료 |
| `doctor` | 기동 전 점검을 표로 출력: Node 버전, `claude` 설치·로그인, Claude Code의 Linear MCP 연결, 토큰 세 개 유효성, 봇의 채널 참여, 대상 저장소 git 여부, 템플릿 파일 유무, `ego-browser` 준비 여부 |
| `manifest` | Slack 앱 매니페스트 YAML 출력(`--open`이면 앱 생성 페이지를 연다) |
| `config` | 현재 설정 출력(토큰은 앞 8자만) |

전역 옵션: `--repo <path>`(기본 현재 폴더), `--home <dir>`(기본 `~/.ai-sdlc`).

## 4. 파일 배치

```
~/.ai-sdlc/
└── repos/<저장소 경로 해시>/
    ├── config.json          비밀 아닌 설정 (지금의 sdlc.config.json과 같은 키 + repoPath)
    ├── credentials.json     토큰 (권한 600, 폴더는 700)
    ├── state/               지금의 runner/.state
    └── worktrees/           지금의 runner/.worktrees
```

- 저장소별로 분리해 한 사람이 여러 저장소 러너를 따로 띄울 수 있다.
- 우선순위: 환경변수 > `credentials.json` / `config.json` > 기본값. 기존 `SDLC_CONFIG_PATH`와 `runner/` 안에서 `npm start` 하는 개발 경로도 계속 동작한다(설정이 러너 폴더에 있으면 그걸 쓴다).
- 러너 코드의 `RUNNER_DIR` 의존을 걷어 낸다: 상태·worktree 위치는 설정에서 오는 `stateDir`·`worktreesDir`, 플러그인 위치는 패키지에 동봉된 `plugin/`을 가리키는 `pluginDir`.

## 5. `init` 흐름

```
1. 대상 저장소 확인      git 저장소인지, 루트가 어디인지
2. Slack 앱              있음/없음 선택 → 없으면 매니페스트를 출력하고 앱 생성 페이지 URL을 안내
3. Slack 봇 토큰 (xoxb)  가려진 입력 → auth.test 로 검증, 워크스페이스·봇 이름 표시
4. Slack 앱 토큰 (xapp)  가려진 입력 → apps.connections.open 으로 검증
5. Linear API 키         가려진 입력 → viewer 조회로 검증 → 팀 목록에서 선택
6. Slack 채널            채널 ID 입력(또는 채널 링크 붙여넣기에서 추출) → 확인 메시지 전송으로 봇 참여 검증
                         not_in_channel 이면 "/invite @봇이름" 안내 후 재시도
7. 승인 역할 (선택)       usergroups.list 에서 역할별 사용자 그룹 선택, 건너뛰면 채널 누구나
8. 시작 방식             버튼(기본) / 자동
9. 저장소 템플릿         CLAUDE.md·REVIEW.md·ops/ 가 없으면 설치할지 묻기 (/sdlc-init 과 같은 파일)
10. 저장 · 요약           config.json·credentials.json 저장, doctor 결과 표, "npx ai-sdlc-runner start" 안내
```

- 입력 도구: `@clack/prompts`(가려진 입력, 선택 목록, 스피너). 새 런타임 의존성 두 번째.
- 토큰 형식 사전 확인: `xoxb-`, `xapp-`, `lin_api_` 접두어가 다르면 바로 알린다(봇 토큰과 앱 토큰을 바꿔 넣는 흔한 실수).
- 검증 실패 시 그 단계만 다시 묻는다. Ctrl+C면 아무것도 저장하지 않는다.
- 비대화형 경로: `init --yes`가 환경변수(`SLACK_BOT_TOKEN` 등)와 `--channel`, `--team` 플래그로 같은 검증을 거쳐 저장한다(CI·서버용).

## 6. 패키지

- 이름 `ai-sdlc-runner`, bin `ai-sdlc-runner`(짧은 별칭 `ai-sdlc`). `ai-sdlc`는 npm에서 이미 쓰이고 있다.
- **빌드 필요**: Node는 `node_modules` 안의 `.ts`를 타입 제거로 실행하지 않는다. `tsc`로 `dist/`에 JS를 내고 `bin`은 `dist/cli.js`를 가리킨다. 개발 중 `npm start`는 지금처럼 소스를 바로 실행.
- `files`: `dist/`, `plugin/`(빌드 시 `../plugin`을 복사), `slack/manifest.yaml`, `README.md`.
- `prepack`에서 빌드·플러그인 복사, `npm pack` 결과를 임시 폴더에 설치해 `npx` 실행 스모크 테스트.

## 7. 오류 처리

| 상황 | 동작 |
| --- | --- |
| `start` 때 설정 없음 | "먼저 `npx ai-sdlc-runner init`" 후 종료 코드 1 |
| 토큰 만료·폐기 | 기동 시 검증 실패 메시지에 어떤 토큰인지와 `init`으로 바꾸는 법 |
| `credentials.json` 권한이 600보다 넓음 | 경고 후 600으로 고침 |
| `claude` 미설치·미로그인, Linear MCP 미연결 | `doctor`와 `start`가 원인과 해결 명령을 출력. MCP 미연결은 00 Setup이 실패하므로 `start`를 막는다(`--skip-checks`로 우회) |

## 8. 테스트

- 설정 로더: 우선순위(환경변수 > 파일 > 기본값), 저장소별 경로 해시, 권한 600 저장·교정.
- `init` 단계 함수: 프롬프트와 API 호출을 주입해 각 단계의 성공·실패·재시도 경로(토큰 접두어 오류, `not_in_channel`, 팀 선택)를 검증. 실제 Slack·Linear 호출 없음.
- `doctor`: 점검 항목별 통과·실패 판정.
- 러너: `RUNNER_DIR` 제거 후 기존 180개 테스트 유지.
- 패키지: `npm pack` → 임시 설치 → `npx ai-sdlc-runner --help`, `manifest`, `config`(설정 없음 안내) 스모크.

## 9. 문서

`AI_SDLC/README.md`의 3-B·3-C를 `npx ai-sdlc-runner init` / `start` 두 줄 중심으로 다시 쓰고, 클론·`export` 안내는 "개발자용"으로 아래에 둔다.
