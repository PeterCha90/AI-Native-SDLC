<p align="center">
  <img src="https://img.shields.io/badge/AI--native-SDLC-blueviolet?style=for-the-badge" alt="AI-native SDLC" />
  <img src="https://img.shields.io/badge/version-0.3.0-blue?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-orange?style=for-the-badge" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=for-the-badge" alt="Node >= 22" />
</p>

<h1 align="center">🔁 AI-SDLC</h1>
<h3 align="center">내 저장소에 6단계 개발 파이프라인과 승인 게이트를 거는 Claude Code 플러그인</h3>

- 티켓 하나를 **Plan → Design → Build → Test → Deploy → Maintain** 순서로 진행한다. 단계마다 산출물(`intent.md` → `spec.md` → `plan.md` → 코드 → PR)을 남기고, **담당자가 승인해야** 다음 단계로 넘어간다. 되돌리기 어려운 행동은 hook이 그 자리에서 막는다.

원문: [The AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)

---

```
#ai-sdlc-updates
🆕 ENG-12 로그인 폼이 빈 값을 저장함 — @minji · sdlc-auto 아님
[▶ 파이프라인 시작]  [무시]

┗━ 🧵 스레드
   ▶ 시작함 (by @minji)
   ⏳ 01 Plan 실행 중

   🙋 @minji 질문 2개 (1/5)
   1. 빈 값 저장은 저장 시점에 막을까, 제출 시점에 막을까?
   2. 기존에 저장된 빈 값 레코드도 백필해야 하나?
   [답변 반영]  [이대로 진행]

   ✅ 답변 2개 반영 (by @minji)
   ✅ 01 Plan 완료 (4분)
   ⏳ 02 Design 실행 중
   ✅ 02 Design 완료 (3분)

   🔐 게이트: 02 Design 승인 대기 — @product-owners
   [✅ 승인]  [⛔ 반려]

   ⛔ 반려 (by @minji) — 사유: 제출 시점 검증이 빠졌다 → 재작업 1/3
   ⏳ 02 Design 재실행 중
   ✅ 02 Design 완료 (2분)

   🔐 게이트: 02 Design 승인 대기 — @product-owners
   [✅ 승인]  [⛔ 반려]

   ✅ @minji 승인 — 다음 단계로 진행
   ⏳ 03 Build 실행 중
   ✅ 03 Build 완료 (12분)
   ⏳ 04 Test 실행 중

   🔐 게이트: 04 Test 승인 대기 — @product-owners
   unit 12/12 통과 · e2e 1건 실패(로그인 폼 빈 값 저장)
   산출물: docs/plan/ENG-12.md · Linear: ENG-12 › 04-test
   [✅ 승인]  [⛔ 반려]

   ✅ @minji 승인 — 다음 단계로 진행
```

러너가 Slack 채널에 올리는 알림·진행·게이트 메시지의 실제 모양이다(캡처 전까지는 텍스트 예시). 같은 정보가 Linear 원 티켓 아래 게이트 하위 이슈 6개에도 남는다.

---

## 세 가지 사용법

| 방식 | 시작 방법 | 승인은 어디서 | 필요한 것 |
| --- | --- | --- | --- |
| **A. 대화형** | Claude Code에서 `/sdlc-run ENG-12` | 대화창에서 "진행해" | 플러그인만 |
| **B. 자동** | Linear에 티켓을 만들면 러너가 받아서 시작 | Linear 게이트 카드를 Done으로 | 플러그인 + 러너 + Linear webhook |
| **C. Slack** | Slack 알림의 [▶ 시작] 또는 `/sdlc <제목>` | Slack 버튼(역할 확인) 또는 Linear 게이트 카드 | 플러그인 + 러너 + Slack 앱 |

처음이라면 **A로 한 티켓을 끝까지 돌려 보고**, 팀 단위로 굴릴 때 B나 C로 넘어가길 권한다. 세 방식 모두 1~2단계(설치와 저장소 준비)는 같다.

---

## 1. 플러그인 설치

셸에서 두 줄이면 된다. 클론은 필요 없다.

```bash
claude plugin marketplace add PeterCha90/FastCampus
claude plugin install ai-native-sdlc@ai-sdlc
```

첫 줄은 이 GitHub 저장소를 `ai-sdlc`라는 이름의 마켓플레이스로 등록하고, 둘째 줄은 그 안의 `ai-native-sdlc` 플러그인을 설치한다. Claude Code 세션 안에서라면 같은 일을 `/plugin marketplace add PeterCha90/FastCampus`, `/plugin install ai-native-sdlc@ai-sdlc`로 할 수 있다. 설치한 뒤에는 Claude Code를 다시 시작해야 플러그인이 로드된다.

기본 설치 범위는 **나(user)**라서 내 모든 프로젝트에서 켜진다. 범위를 바꾸려면 `--scope`를 붙인다:

| 범위 | 명령 | 기록되는 곳 | 언제 |
| --- | --- | --- | --- |
| `user` (기본) | `claude plugin install ai-native-sdlc@ai-sdlc` | `~/.claude/settings.json` | 내 모든 프로젝트에서 쓸 때 |
| `project` | `... --scope project` | 저장소의 `.claude/settings.json` | 팀원도 같은 플러그인을 쓰게 할 때 (커밋한다) |
| `local` | `... --scope local` | 저장소의 `.claude/settings.local.json` | 이 저장소에서 나만 쓸 때 |

`project`나 `local`은 대상 저장소 안에서 실행한다. `marketplace add`에도 같은 `--scope`를 붙여 맞춰 준다.

설치가 됐는지 확인:

```bash
cd ~/code/my-app
claude -p "네가 쓸 수 있는 sdlc-* 스킬과 명령 이름만 한 줄씩 출력해라" < /dev/null
```

스킬 7개(`sdlc-intent` … `sdlc-maintain`)와 명령 3개(`/sdlc-init`, `/sdlc-run`, `/sdlc-status`)가 나오면 된다. 다른 플러그인과 이름이 겹치면 `/ai-native-sdlc:sdlc-run`처럼 앞에 플러그인 이름을 붙여 부른다.

### 업데이트

```bash
claude plugin marketplace update ai-sdlc
claude plugin update ai-native-sdlc@ai-sdlc
```

`plugin.json`의 버전이 올라간 경우에만 새 파일을 받아 온다. 업데이트한 뒤에는 Claude Code를 다시 시작한다.

### 제거

```bash
claude plugin uninstall ai-native-sdlc@ai-sdlc
claude plugin marketplace remove ai-sdlc
```

---

## 2. 내 저장소 준비

플러그인은 저장소에 있는 몇 가지 파일을 기준으로 움직인다. 내 저장소에서 Claude Code를 열고 한 번 실행한다:

```
/sdlc-init
```

템플릿 네 개를 저장소 루트에 깔고, `package.json`·`Makefile`·`pyproject.toml`을 읽어 `CLAUDE.md`의 명령어 칸을 채운다. 이미 있는 파일은 덮어쓰지 않는다. 끝나면 만든 파일과 사람이 채워야 할 곳을 표로 보여 준다.

| 파일 | 쓰는 단계 | 사람이 할 일 |
| --- | --- | --- |
| `CLAUDE.md` | 모든 단계 | **테스트 명령**이 맞는지 확인하고 컨벤션·아키텍처를 채운다. 04 Test와 `verify-before-done` hook이 이 명령으로 검증한다 |
| `REVIEW.md` | 05 Deploy | 그대로 써도 된다. Important/Nit 기준과 nit 5건 상한이 들어 있다 |
| `ops/bands.yaml` | 06 Maintain | 예시 지표가 들어 있다. 지표 이름, 기준선(`baseline`), 표준편차(`sigma`)를 내 서비스에 맞게 바꾼다 |
| `ops/detect.sh` | 06 Maintain | 그대로 쓴다. `python3`와 `PyYAML`이 필요하다 |

내용을 확인했으면 커밋한다:

```bash
git add CLAUDE.md REVIEW.md ops && git commit -m "chore: AI-SDLC 설정 추가"
```

`docs/intent/`, `docs/spec/`, `docs/plan/`은 파이프라인이 알아서 만든다. 자동 모드는 테스트 명령을 `package.json`의 `test` 스크립트, `Makefile`의 `test` 타깃, `pytest` 순으로 찾아 실행한다.

---

## 3-A. 대화형으로 쓰기

내 저장소에서 Claude Code를 열고 티켓 키를 넘긴다:

```
/sdlc-run ENG-12
```

Linear MCP가 연결돼 있으면 티켓 내용을 직접 읽는다. 연결돼 있지 않으면 첫 질문에 티켓 내용을 붙여 넣으면 된다. 진행 순서는 이렇다.

| 순서 | Claude가 하는 일 | 내가 할 일 |
| --- | --- | --- |
| 1 | `docs/intent/ENG-12.md` 초안 작성. 모르는 건 "미해결 질문"으로 남긴다 | 질문에 답하고 내용이 맞으면 "진행해" |
| 2 | `docs/spec/ENG-12.md` 작성. 정책 충돌은 해당 항목 바로 아래 표시 | 충돌 항목을 정리하고 승인 |
| 3 | `docs/plan/ENG-12.md` 작성: 바꿀 파일, 순서, "무엇이 깨질 수 있는가". 이때까지 코드는 건드리지 않는다 | 계획을 검토하고 승인 |
| 4 | 계획대로 구현 | 기다린다. hook이 계획 밖 파일 커밋, 비밀값, 보호 경로 편집을 막는다 |
| 5 | 성공 기준 명령을 실제로 돌려 통과할 때까지 수정하고, `verifier` 서브에이전트로 독립 검증 | 증거를 보고 승인 |
| 6 | `REVIEW.md` 기준 3패스 리뷰 후 PR 생성 | PR을 보고 릴리스 여부 결정 |
| 7 | `ops/detect.sh`로 지표 판정. 3σ면 후속 티켓 초안 작성 | 트리아지 |

중간에 끊겨도 `/sdlc-status ENG-12`를 치면 어떤 산출물까지 있는지로 현재 단계를 알려 준다.

---

## 3-B. 자동으로 돌리기 (러너)

Linear에 티켓이 생기면 러너가 webhook으로 받아 단계마다 `claude -p`를 실행한다. 승인은 Linear 카드로 한다.

### 설정

러너는 플러그인에 들어 있지 않으니 저장소를 받는다. 위치는 어디든 괜찮다.

```bash
git clone https://github.com/PeterCha90/FastCampus.git ~/tools/FastCampus
```

`~/tools/FastCampus/AI_SDLC/runner/sdlc.config.json`을 연다:

| 설정 | 넣을 값 |
| --- | --- |
| `repoPath` | 내 저장소 경로. 절대 경로, 또는 `runner/` 기준 상대 경로 |
| `linearTeamId` | 티켓을 받을 Linear 팀 ID (Claude Code에서 Linear MCP의 `list_teams`로 조회) |
| `demoAppUrl` | 04 Test에서 e2e로 열어 볼 내 앱 주소 (예: `http://localhost:3000`) |
| `gateRoles` | 단계별 승인자 이름. 기본값은 PO / PO / Engineer / Code Owner / Release Manager / Service Owner |

`repoPath`는 git 저장소여야 한다. 러너가 티켓마다 `sdlc/<키>` 브랜치의 worktree를 만들어 그 안에서 작업하므로, 내 작업 트리는 건드리지 않는다.

### 실행

```bash
cd ~/tools/FastCampus/AI_SDLC/runner
npm install
export LINEAR_API_KEY=lin_api_...          # Linear → Settings → API → Personal API keys
export LINEAR_WEBHOOK_SECRET=...           # 아래 webhook을 만들 때 나오는 값
npm start
```

다른 터미널에서 러너 포트를 외부에 연다:

```bash
ngrok http 3939
```

Linear → Settings → API → Webhooks에서 `<ngrok 주소>/webhook/linear`를 추가하고 **Issue** 이벤트를 구독한다. 이때 나오는 signing secret을 `LINEAR_WEBHOOK_SECRET`에 넣고 `npm start`를 다시 실행한다. 러너는 시작할 때만 환경변수를 읽는다.

### 티켓 하나 흘려 보내기

1. `curl -s localhost:3939/health`로 러너가 떠 있는지 확인한다.
2. Linear에 티켓을 만든다. `00 Setup`이 돌고, 원 티켓 아래에 `[gate] 01-plan — 승인자: Product Owner`부터 `06-maintain`까지 하위 이슈 6개가 생긴다.
3. 단계가 끝날 때마다 해당 게이트 카드에 요약 코멘트가 달린다. 산출물을 보고 카드를 옮긴다.

| 게이트 카드를 | 러너 동작 |
| --- | --- |
| `Done` 으로 옮김 | 승인 — 다음 단계 진행 |
| `Canceled` 로 옮김 | 반려 — 파이프라인 중단, 마지막 코멘트를 사유로 기록 |
| 그대로 둠 | 대기 — 10초마다 확인, 30분이 지나면 중단 |

4. `05 Deploy`에서 `sdlc/<키>` 브랜치로 PR이 열린다.
5. `06 Maintain`이 3σ로 판정하면 `sdlc-auto` 라벨을 단 새 티켓이 생기고, 그 티켓으로 다시 01부터 시작한다. 원 티켓에 후속 티켓 링크가 코멘트로 남는다.

사람 승인 없이 흐름만 확인하려면 `SDLC_AUTO_APPROVE=1 npm start`로 켠다. 게이트를 전부 건너뛰고, 건너뛸 때마다 러너 로그에 "리허설 모드(자동 승인)"가 찍힌다.

---

## 3-C. Slack으로 쓰기

러너가 Linear 티켓 알림과 승인 버튼을 Slack 채널에 올린다. 공개 URL이 필요 없다 — Socket Mode로 붙는다. **01 Plan 인터뷰와 스레드 답글 수집 때문에 봇 스코프가 늘었다(아래 ⑨). 기존에 이미 앱을 만들어 쓰고 있었다면 `slack/manifest.yaml`을 다시 붙여 넣고 앱을 재설치해야 한다.**

### 앱 만들기

| 순서 | 할 일 |
| --- | --- |
| ① | [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest** → 워크스페이스 선택 → `runner/slack/manifest.yaml` 내용을 붙여넣는다 |
| ② | **Install to Workspace** → 발급된 **Bot Token**(`xoxb-…`)을 복사한다 |
| ③ | 왼쪽 메뉴 **Basic Information** → **App-Level Tokens** → `connections:write` 스코프로 토큰을 만들고 **App-Level Token**(`xapp-…`)을 복사한다 |
| ④ | 알림을 받을 채널에서 `/invite @AI-SDLC`로 봇을 초대한다. 채널 상세 정보 맨 아래에서 채널 ID(`C…`)를 복사한다 |
| ⑤ | 승인 역할마다 Slack 사용자 그룹을 만들거나 기존 그룹을 쓴다. 그룹 프로필 페이지 URL 끝의 `S…`가 사용자 그룹 ID다 |

### ⑥ 설정·환경변수

`sdlc.config.json`에 추가한다:

```json
{
  "linearTrigger": "poll",
  "linearPollIntervalMs": 30000,
  "slack": {
    "channelId": "C0123456789",
    "startMode": "button",
    "roleGroups": {
      "Product Owner": "S0PRODUCT",
      "Engineer": "S0ENG",
      "Code Owner": "S0CODEOWN",
      "Release Manager": "S0RELEASE",
      "Service Owner": "S0SRE"
    }
  }
}
```

| 변수 | 값 |
| --- | --- |
| `SLACK_BOT_TOKEN` | ②에서 복사한 `xoxb-…` |
| `SLACK_APP_TOKEN` | ③에서 복사한 `xapp-…`(`connections:write`) |

두 값이 모두 있어야 Slack 기능이 켜진다. 하나라도 없으면 기존 webhook 방식 그대로 동작한다. Slack이 켜지면 `linearTrigger` 기본값은 `"poll"`(30초 간격)이라 `LINEAR_WEBHOOK_SECRET`이 필요 없다. `"webhook"`으로 바꾸면 기존 webhook 경로를 그대로 쓴다.

### ⑦ 실행

```bash
npm start
```

기동 로그에 Slack 연결 상태, 채널, 역할 매핑, 폴링 주기가 한 번에 찍힌다. 봇이 채널에 없으면(`not_in_channel`) 이 시점에 바로 알려준다.

### ⑧ 사용법

| 상황 | 화면 |
| --- | --- |
| Linear에 새 티켓 | 채널에 알림 + `[▶ 파이프라인 시작]` `[무시]` |
| `/sdlc <제목>` | Linear에 티켓을 만들고 같은 알림을 올린다 |
| `/sdlc run ENG-12` | 기존 티켓으로 파이프라인 시작 |
| `/sdlc status` | 진행 중인 실행과 각 실행의 현재 단계·대기 역할 (나에게만 보임) |
| `/sdlc help` | 명령 사용법 (나에게만 보임) |
| 단계 진행 | 티켓 스레드에 `⏳ 01 Plan 실행 중` → `✅ 01 Plan 완료 (4분)` |
| 게이트 열림 | 스레드에 승인 역할 멘션 + 요약 + `[✅ 승인]` `[⛔ 반려]`, 채널에도 한 번 더 보임 |

### ⑨ 01 Plan 인터뷰

01 Plan 초안에 `## 미해결 질문`이 남아 있으면(최대 `interviewMaxRounds`회, 기본 5) 러너가 게이트를 열기 전에 스레드에서 되묻는다.

| 순서 | 일어나는 일 |
| --- | --- |
| 1 | 스레드에 `🙋 @요청자 질문 N개 (round/5)`와 번호 목록, `[답변 반영]` `[이대로 진행]` 버튼이 올라온다 |
| 2 | 요청자는 Linear 이슈 작성자 이메일로 찾는다. 못 찾으면 멘션 없이 "스레드에서 누구나 답할 수 있다"고 표시한다 |
| 3 | 스레드 참여자 누구나 답글을 달 수 있다(인터뷰는 승인이 아니다). 메시지 아래에 "답변 N개 받음"이 갱신된다 |
| 4 | `[답변 반영]` — 모은 답을 Linear 원 티켓에 코멘트로 남기고, 01 세션을 이어서(`--resume`) intent.md를 고친다. 질문 메시지는 `✅ 답변 N개 반영 (by @누구)`로 바뀐다. 질문이 남아 있으면 다음 라운드가 다시 열린다 |
| 5 | `[이대로 진행]` — 남은 질문은 미해결로 둔 채 바로 `01-plan` 게이트로 넘어간다. 5회에 도달해도 같은 동작이다 |

Slack이 꺼져 있거나 webhook 모드면 인터뷰 없이(`noInterview`) 바로 게이트로 간다.

### ⑩ 반려 후 재작업 (01·02·03)

`01-plan`·`02-design`·`03-build` 게이트에서 반려하면(Slack 모달 사유 또는 Linear Canceled + 코멘트), 파이프라인이 멈추지 않고 그 단계를 사유를 반영해 다시 돈다(게이트당 최대 `reworkMaxAttempts`회, 기본 3).

| 재작업 횟수 | 동작 |
| --- | --- |
| `< reworkMaxAttempts` | 그 단계 세션을 이어서(`--resume`) "반려 사유: … 반영해 고쳐라"로 재실행 → 게이트 카드를 `unstarted`로 되돌리고 "재작업 N/3" 코멘트 → 스레드에 `⛔ 반려 → 재작업 N/3` 표시 후 새 게이트 메시지 → 다시 승인 대기(01이면 인터뷰 루프도 다시 탄다) |
| `= reworkMaxAttempts` | 지금처럼 파이프라인을 중단한다 |

**04 Test·05 Deploy·06 Maintain 반려는 재작업하지 않는다** — 지금처럼 그 자리에서 파이프라인을 멈춘다. 코드를 다시 짜야 하는 반려는 새 티켓으로 시작하는 게 맞기 때문이다.

### ⑪ 누가 시작할 수 있는가

**봇이 들어간 채널의 멤버는 누구나 `/sdlc`와 `[▶ 시작]`으로 파이프라인을 시작할 수 있다.** 러너가 저장소에서 `claude -p`를 권한 우회 모드로 돌리기 때문이다 — 채널 초대를 그만큼 신중히 한다.

---

## 단계별로 무엇이 일어나나

| 단계 | 산출물 | 승인자 | 막는 장치 (hook) |
| --- | --- | --- | --- |
| `00 Setup` (자동 모드만) | Linear 게이트 하위 이슈 6개 | — | 게이트가 안 만들어지면 러너가 멈춘다 |
| `01 Plan` | `docs/intent/<키>.md` | Product Owner | — |
| `02 Design` | `docs/spec/<키>.md` | Product Owner | — |
| `03 Build` | `docs/plan/<키>.md`, 코드 | Engineer | `plan-drift` `guard-protected-paths` `block-secrets` `format-lint` |
| `04 Test` | 테스트·e2e 결과 | Code Owner | `protect-tests` `verify-before-done` `config-eval` |
| `05 Deploy` | 리뷰 결과, PR | Release Manager | `production-gate` |
| `06 Maintain` | σ 판정, 필요하면 새 `intent.md`와 티켓 | Service Owner | 자동 티켓 깊이 상한 3 |

스킬과 `CLAUDE.md`는 에이전트를 유도할 뿐이고, 실제로 막는 건 hook이다. 각 hook이 막는 상황:

| hook | 막는 상황 |
| --- | --- |
| `guard-protected-paths` | `.env*`, `infra/`, `.github/workflows/` 편집 |
| `block-secrets` | AWS 키, PEM 키, GitHub 토큰(`ghp_` 등)·Slack 토큰(`xox`)·`sk_live_` 같은 자격 증명이 들어간 편집 |
| `plan-drift` | `plan.md`의 "변경할 파일"에 없는 파일을 커밋하려 할 때 |
| `protect-tests` | `SDLC_BUGFIX=1`인 버그 수정 세션에서 테스트 파일을 고치려 할 때 |
| `verify-before-done` | `plan.md`의 성공 기준 명령을 한 번도 안 돌리고 끝내려 할 때 |
| `production-gate` | `RELEASE_APPROVED=1` 없이 프로덕션 배포로 보이는 명령을 실행할 때 |
| `format-lint` | 편집 뒤 자동 포맷을 돌리고, lint 오류가 남으면 되돌려 보낸다 |
| `config-eval` | `CLAUDE.md`나 `.claude/`가 바뀌면 테스트를 돌리고, 깨지면 되돌려 보낸다 |

06의 σ 판정은 모델이 아니라 `ops/detect.sh`가 산수로 한다. `1σ`면 기록만 하고, `2σ`면 읽기 전용으로 원인만 진단하며, `3σ`면 새 `intent.md`를 쓰고 Linear 티켓을 만든다.

---

## 설정

`runner/sdlc.config.json` (자동 모드):

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| `repoPath` | `../demo` | 파이프라인이 작업할 저장소. **내 저장소로 바꾼다** |
| `linearTeamId` | — | Linear 팀 ID |
| `port` | `3939` | `GET /health`와 webhook 포트. `PORT` 환경변수가 우선한다 |
| `useWorktree` | `true` | 티켓마다 별도 worktree에서 작업 |
| `e2eDriver` / `demoAppUrl` | `ego-lite` / `http://localhost:5173` | 04 Test의 e2e 도구와 열어 볼 주소 |
| `gatePollIntervalMs` | `10000` | 게이트 확인 간격 |
| `gateTimeoutMs` | `1800000` | 승인 대기 상한 (30분) |
| `maxAutoTicketDepth` | `3` | 06이 연쇄로 만들 수 있는 자동 티켓 깊이 |
| `detectScript` / `detectMetric` | `ops/detect.sh` / `e2e_failure_rate` | 06 감지 스크립트와 판정 지표 |
| `interviewMaxRounds` | `5` | 01 Plan 인터뷰 최대 왕복 횟수. 도달하면 `[이대로 진행]`과 같게 처리한다 |
| `reworkMaxAttempts` | `3` | `01-plan`·`02-design`·`03-build` 게이트 반려 시 그 단계를 다시 돌리는 최대 횟수. 도달하면 파이프라인을 중단한다 |

환경변수:

| 변수 | 설명 |
| --- | --- |
| `LINEAR_API_KEY` | 자동 모드 필수. 게이트 상태 조회와 코멘트에 쓴다 |
| `LINEAR_WEBHOOK_SECRET` | `linearTrigger: "webhook"`일 때 필수. webhook 서명 검증. Slack이 켜져 기본값이 `"poll"`이면 필요 없다 |
| `SLACK_BOT_TOKEN` | Slack 봇 필수(둘 중 하나라도 없으면 Slack 기능이 꺼진다). `xoxb-…` |
| `SLACK_APP_TOKEN` | Slack 봇 필수. `connections:write` 스코프의 `xapp-…`, Socket Mode용 |
| `SDLC_AUTO_APPROVE` | `1`이면 게이트 전부 건너뜀 |
| `SDLC_BUGFIX` | `1`이면 테스트 파일 편집 차단 (`protect-tests`) |
| `RELEASE_APPROVED` | `1`이어야 프로덕션 배포 명령 허용 (`production-gate`) |

---

## 트러블슈팅

| 증상 | 해결 |
| --- | --- |
| 스킬이 목록에 안 나온다 | `claude plugin list`에 `ai-native-sdlc@ai-sdlc`가 있는지 확인하고, 설치 뒤 Claude Code를 다시 시작한다. `project`/`local` 범위로 설치했다면 그 저장소 안에서만 보인다 |
| `marketplace add`가 저장소를 못 찾는다 | 저장소가 비공개면 접근 권한이 있는 GitHub 계정으로 git 인증이 돼 있어야 한다 (`gh auth status`) |
| 04 Test의 e2e가 매번 실패하고 06이 후속 티켓을 계속 만든다 | e2e는 `ego-browser`로 `demoAppUrl`을 연다. `printf 'cliLog("ok")\n' \| ego-browser nodejs 2>&1`이 `ok`를 출력하는지, 앱이 그 주소에 떠 있는지 확인한다. 자동 티켓은 깊이 3에서 멈춘다 |
| `npm start`가 바로 종료된다 | 출력된 `[config]` 메시지대로 `LINEAR_API_KEY`, `LINEAR_WEBHOOK_SECRET`, `linearTeamId`를 채운다 |
| 티켓을 만들어도 파이프라인이 시작되지 않는다(webhook 모드) | 터널이 살아 있는지, webhook URL이 `/webhook/linear`로 끝나는지 확인한다. 서명이 틀리면 러너 로그에 401이 찍힌다 |
| Slack 봇 초대 없이 채널에 알림이 안 온다(`not_in_channel`) | 알림을 보낼 채널에 `/invite @AI-SDLC`로 봇을 초대했는지 확인한다 |
| Slack 버튼을 눌러도 반응이 없다 | 러너가 떠 있는지(`curl -s localhost:3939/health`) 확인하고, Socket Mode 연결이 끊기지 않았는지 로그를 본다. 끊긴 동안에도 Linear 카드를 직접 옮기면 승인은 그대로 된다 |
| `no approval-gate map` 으로 멈춘다 | `00 Setup`이 Linear MCP로 하위 이슈를 못 만든 것이다. Claude Code에서 `/mcp`로 Linear 연결을 확인한다 |
| 승인했는데 다음 단계로 안 간다 | 카드가 Done 계열 상태(`completed`)인지 확인한다. 팀 워크플로에 Done과 Canceled가 있어야 한다 |
| 03에서 커밋이 막힌다 | `plan-drift`가 계획 밖 파일을 막은 것이다. `plan.md`를 고쳐 다시 승인받거나 변경을 되돌린다 |
| 06이 판정을 못 한다 | `ops/detect.sh`가 없으면 파이프라인 성공 여부로 대신 판정한다. `python3 -c "import yaml"`이 되는지 확인한다 |
| 05에서 PR이 안 열린다 | `gh auth status`로 GitHub 로그인을 확인한다 |

---

## 프로젝트 구조

```
AI_SDLC/
├── plugin/                           # Claude Code 플러그인 본체
│   ├── skills/                       # sdlc-intent, spec, plan, test, e2e, review, maintain
│   ├── hooks/                        # 위 표의 hook 8개 + hooks.json
│   ├── agents/                       # verifier, e2e-reviewer
│   ├── commands/                     # /sdlc-init, /sdlc-run, /sdlc-status
│   └── templates/                    # /sdlc-init이 까는 CLAUDE.md·REVIEW.md·ops/ 템플릿
├── runner/                           # 자동 모드 러너 (webhook, 게이트, Slack 봇)
│   ├── slack/manifest.yaml           # Slack 앱 매니페스트
│   ├── src/slack/                    # Bolt 앱, 역할 확인, 메시지, 알림
│   └── sdlc.config.json
├── demo/                             # 플러그인을 적용해 둔 예시 저장소
└── docs/
    ├── stage-map.md                  # 단계 × 스킬/hook/승인자 대응표
    └── architecture.md               # 설계와 그 이유
```

더 읽을 것: 스킬·hook 하나하나의 규칙은 [`plugin/README.md`](plugin/README.md), 러너 API와 테스트는 [`runner/README.md`](runner/README.md), 단계별 확인 방법은 [`docs/stage-map.md`](docs/stage-map.md)에 있다.

---

<p align="center">
  Made by <a href="https://github.com/PeterCha90">Peter Cha</a>
</p>
