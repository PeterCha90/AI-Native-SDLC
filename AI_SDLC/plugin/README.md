# ai-native-sdlc

[AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)의 6단계(Plan/Design/Build/Test/Deploy/Maintain)와
3층 가드레일(CLAUDE.md/skills/hooks)을 자기 저장소에 그대로 적용하는 Claude Code 플러그인이다. 이 문서는 플러그인이
실제로 담고 있는 것 — skill 7개, hook 8개, agent 2개, command 3개, `templates/`(CLAUDE.md·REVIEW.md·ops 템플릿) — 을 산출물 종류별로
정리한 참조 문서다. 어떤 SDLC 단계에서 어떤 파일이 관여하는지(단계 기준 정리)는 이 문서가 아니라
[`AI_SDLC/docs/stage-map.md`](../docs/stage-map.md)를 본다.

## 설치

**권장 — CLI로 설치** (GitHub 저장소를 마켓플레이스로 등록):

```bash
claude plugin marketplace add PeterCha90/AI-Native-SDLC
claude plugin install ai-native-sdlc@ai-sdlc     # --scope project|local 로 범위 지정
```

저장소 루트의 `.claude-plugin/marketplace.json`이 `./AI_SDLC/plugin`을 `ai-native-sdlc`로 등록한다. 설치 후 Claude Code를 재시작하고, 대상 저장소에서 `/sdlc-init`으로 템플릿을 깐다. 이 저장소를 클론해 개발 중일 때는 아래 두 경로도 쓸 수 있다.

**세션 한 번만 시험**:

```
claude --plugin-dir /path/to/AI_SDLC/plugin
```

**로컬 마켓플레이스로 상시 등록** — `.claude/settings.json`에 아래를 넣는다(`--scope project`로 설치하면
CLI가 이 파일을 직접 써준다). 이 저장소의 예시 앱(`AI_SDLC/todo-app/`)은 `.claude/`를 커밋해 두지 않는다 —
아래 명령으로 설치하면 `AI_SDLC/todo-app/.claude/settings.json`이 같은 내용으로 생긴다:

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

`path`는 이 `settings.json` 파일 위치(`AI_SDLC/todo-app/.claude/`) 기준 상대 경로다. `..`는 마켓플레이스 정의 파일
(`AI_SDLC/.claude-plugin/marketplace.json`)이 있는 `AI_SDLC/`를 가리키고, 그 마켓플레이스가 `./plugin`을
`ai-native-sdlc` 플러그인으로 등록한다.

**검증된 함정 둘**:

- `source.source`는 반드시 `"directory"`여야 한다. `"local"`은 동작하지 않는다.
- `path`는 반드시 **상대 경로**여야 한다. 절대 경로를 넣으면 에러 없이 조용히 아무 플러그인도 로드되지 않는다.

두 경로 모두 확인하려면:

```bash
cd AI_SDLC/todo-app && claude -p "네가 쓸 수 있는 sdlc-* 스킬 이름만 한 줄씩 출력해라" < /dev/null
```

skill 7개 + command 3개, 총 10줄이 나오면 정상이다.

설치 후 대상 저장소에서 `/sdlc-init`을 실행하면 `templates/`의 `CLAUDE.md.template`을 `.claude/CLAUDE.md`로, `REVIEW.md`·`ops/`를 저장소 루트에 깔고(기존 파일은 덮어쓰지 않음) `.claude/CLAUDE.md`의 명령어 칸을 채운다.

## skills (7개)

| skill | 단계 | 산출물 | 하는 일 |
| --- | --- | --- | --- |
| `sdlc-intent` | 01 Plan | `docs/intent/<id>.md` | 티켓/로그/대화를 인터뷰해 문제·원하는 결과·영향 범위·제약·미해결 질문을 정리 |
| `sdlc-spec` | 02 Design | `docs/spec/<id>.md` | intent.md를 근거로 요구사항·설계를 작성, 저장소 skills 적용, 정책 충돌은 인라인 표시 |
| `sdlc-plan` | 03 Build 착수 전 | `docs/plan/<id>.md` | spec.md를 근거로 변경 파일·작업 순서·위험·성공 기준을 작성, "무엇이 깨질 수 있는가" 심문 |
| `sdlc-test` | 04 Test | (문서 없음, 피드백 루프 실행) | plan.md의 성공 기준 명령을 실행→읽기→고치기→반복. 버그 수정은 실패하는 테스트 선행 |
| `sdlc-e2e` | 04 Test | 스냅샷 텍스트 | ego-browser로 화면을 열어 텍스트 스냅샷을 캡처하고 spec/plan과 대조 |
| `sdlc-review` | 05 Deploy | 리뷰 코멘트(Important/Nit) | PR을 Bugs/Security/Compliance 3패스로 리뷰. 승인/차단은 하지 않음 |
| `sdlc-maintain` | 06 Maintain | 신규 `docs/intent/<new-id>.md` + Linear 티켓 | tier(1σ/2σ/3σ)별 대응. breach 판정 자체는 하지 않음 |

### sdlc-intent

발안자(티켓 작성자, 리포터, 대화 상대)를 짧게 인터뷰해 `docs/intent/<ticket-id>.md` 한 장으로 압축한다. 코드를
먼저 만지지 않는다 — 이 단계의 산출물은 문서뿐이다.

- **hard rule**: 문제/원하는 결과/영향 범위/제약/미해결 질문 중 불명확한 것은 반드시 되묻는다. intent.md가
  **사람 검토 후 git에 커밋된 상태**가 곧 "승인했다"는 신호이며, 그래야 `sdlc-spec`으로 넘어간다.
- **하지 말 것**: 미해결 질문에 그럴듯한 답을 지어내 채우지 않는다(모르면 "미해결 질문"에 남긴다). 구현
  방법(어떤 함수를 고칠지, 어떤 라이브러리를 쓸지)은 여기서 정하지 않는다 — spec/plan의 몫이다.

### sdlc-spec

승인된 intent.md를 읽어 `docs/spec/<ticket-id>.md`(요구사항 + 설계)를 만든다. `docs/intent/<id>.md`가 없거나
미승인 상태면 `sdlc-intent`부터 완료하라고 안내하고 멈춘다.

- **hard rule**: 저장소의 skills/가이드라인(`.claude/skills/`, 플러그인 skills, `CLAUDE.md`·`.claude/CLAUDE.md` 컨벤션)을 찾아
  적용한다. 정책과 충돌하는 지점은 문서 다른 곳에 모으지 않고 **해당 설계 항목 바로 아래 인라인**으로
  표시한다 — 리뷰어가 스펙만 훑어도 놓치지 않게 하기 위함이다. spec.md도 사람 검토 후 커밋되어야
  `sdlc-plan`으로 넘어간다.
- **하지 말 것**: intent.md에 없는 새 요구사항을 스펙 단계에서 임의로 추가하지 않는다(필요하면 "미해결
  질문"으로 되돌려 intent.md 갱신을 요청한다). 구현 순서나 파일 단위 작업 목록은 여기서 만들지 않는다.

### sdlc-plan

승인된 spec.md를 읽어 `docs/plan/<ticket-id>.md`(변경할 파일, 작업 순서, 위험과 제약, 성공 기준, "무엇이 깨질
수 있는가")를 만든다. spec.md가 없으면 `sdlc-spec`부터 안내하고 멈춘다.

- **hard rule**: 작업 목록을 다 쓴 뒤 별도로 계획을 심문한다 — 이 변경이 건드리는 코드를 지금 호출하는 다른
  곳이 있는가, 동시성/순서 가정이 있는가, 롤백은 어떻게 하는가, 테스트가 통과해도 놓칠 수 있는 경로는
  무엇인가, intent/spec을 본 적 없는 다른 엔지니어가 이 plan.md만으로 구현을 끝낼 수 있는가. 이 기준에
  못 미치면 더 구체화한다. plan.md도 사람 검토 후 커밋되어야 실제 구현(코드 편집)에 들어간다.
- **하지 말 것**: 계획 단계에서 실제 코드를 수정하지 않는다(이 스킬의 산출물은 plan.md뿐). "무엇이 깨질
  수 있는가"를 형식적으로 한 줄만 쓰고 넘어가지 않는다.

### sdlc-test

확인이 핵심이지 구현이 아니다. 피드백 루프: 성공 기준 명령을 **실제로 실행**하고, 출력을 읽고, 실패하면
고치고, 통과할 때까지 반복한다. 명령을 실행해서 통과하는 걸 본 적이 없으면 "완료"라고 보고하지 않는다.

- **버그 수정 규칙**: 버그를 **재현하는 실패하는 테스트**를 먼저 작성하고 빨간불인 것부터 확인한 뒤에야
  코드를 고친다. **테스트를 통과시키려고 테스트 자체를 수정하지 않는다** — 실패하는 테스트가 명세다.
  `SDLC_BUGFIX=1`이 설정된 세션에서는 `hooks/protect-tests.sh`가 이 규칙을 결정론적으로 강제한다(테스트로
  보이는 파일의 Edit/Write/MultiEdit 자체를 차단). 훅이 없는 환경에서도 규칙은 동일하게 지킨다.
- **화면 변경일 때**: 브라우저를 여는 부분은 직접 하지 않고 `sdlc-e2e` 스킬 또는 `e2e-reviewer`
  서브에이전트에 위임한다.
- **verifier 서브에이전트는 피드백 루프와 다르다**: 피드백 루프는 구현한 세션이 스스로 돌리는 확인이라 그
  세션의 가정(뭘 고쳤다고 생각하는지)에 물들어 있을 수 있다. `verifier`는 **한 번, 별도의 깨끗한
  컨텍스트에서** 실행되어 plan.md의 성공 기준만 보고 통과/실패를 판정한다. 피드백 루프가 이미 통과했다는
  이유로 `verifier` 호출을 생략하지 않는다.
- **하지 말 것**: 테스트를 고쳐서 통과시키지 않는다. 명령을 실행하지 않고 추론만으로 "완료됐다"고 보고하지
  않는다. `verifier` 호출을 생략하지 않는다.

### sdlc-e2e

기본 도구는 **ego-lite(`ego-browser`)**다. `aside repl`은 TTY를 요구해 헤드리스 파이프라인(훅, `claude -p`)에서
쓸 수 없으므로 대체 경로로만 문서에 남긴다.

- **준비 확인**: `printf 'cliLog("ok")\n' | ego-browser nodejs 2>&1` — `ok`가 보이면 준비된 것이다.
- **호출 형태**: `useOrCreateTaskSpace` → `openOrReuseTab(url, { wait: true, timeout })` → `snapshotText()`를
  `cliLog`로 출력하는 heredoc. **`cliLog`는 stdout이 아니라 stderr로 출력**하므로 `2>&1` 없이 실행하면 명령은
  정상 종료해도 출력이 전혀 보이지 않는다.
- **하지 말 것**: `2>&1` 없이 실행한 뒤 "출력이 없으니 문제 없다"고 결론 내지 않는다. 스냅샷을 확인하지 않고
  "화면이 열렸으니 통과"라고 보고하지 않는다. 이 스킬은 코드를 고치지 않는다 — 발견만 한다.

### sdlc-review

"에이전트가 쓴 코드는 스스로 승인할 방법이 없다"는 원칙에 따라 이 스킬은 **승인하지 않는다** — 발견한 것을
보고할 뿐이며, 최종 승인은 항상 사람 또는 `hooks/production-gate.sh` 같은 결정론적 게이트가 한다.

- **hard rule**: diff를 Bugs → Security → Compliance 3패스로 순서대로 훑는다(건너뛰지 않는다). Important는
  개수 제한이 없고, Nit은 **최대 5개까지만 개별 나열**하며 나머지는 개수·성격만 요약한다. 같은 근본 원인이
  반복되는 패턴(같은 실수가 5곳)은 항목을 늘어놓지 않고 하나의 Important로 묶는다.
- **하지 말 것**: 확신 없는 지적을 Important로 올리지 않는다(Nit으로 낮추거나 "확인 필요" 명시). 병합
  여부를 스스로 결정하지 않는다 — 사람/`verifier`/`e2e-reviewer`/`production-gate.sh`에 넘긴다.

### sdlc-maintain

배포 후 장애/회귀를 진단하고, 필요하면 새 티켓을 만들어 01 Plan으로 되돌려 **루프를 닫는다.**

- **hard rule — 판정 권한 없음**: 장애가 실제로 발생했는지는 이 스킬이 스스로 판단하지 않는다. 그 판정은
  항상 결정론적 스크립트인 `ops/detect.sh`가 내리고, 이 스킬은 이미 breach로 판정된 사건을 받아 "다음에
  뭘 할지"만 결정한다.
- **tier별 권한(1σ/2σ/3σ 권한 사다리)**:
  - **1σ** — 로그만 남긴다. 에이전트가 개입하지 않는다.
  - **2σ** — **읽기 전용**으로 원인을 진단한다. 코드/설정/인프라 어디에도 쓰지 않는다.
  - **3σ** — 행동할 수 있지만 방법은 둘 중 하나뿐이다: 리뷰 게이트를 거치는 **PR을 여는 것**, 또는
    사전 승인된 runbook을 실행하는 것. **어떤 tier에서도 프로덕션에 직접 손대지 않는다.**
- **3σ 루프 닫기**: 진단 결과를 `sdlc-intent`와 동일한 형식으로 새 `docs/intent/<new-id>.md`에 작성 →
  Linear MCP로 새 티켓 생성(라벨 `sdlc-auto`, 본문에 `sdlc-depth: N+1`) → 그 티켓이 01 Plan을 재트리거.
- **루프 안전장치**: `sdlc-depth`가 상한을 넘으면 새 티켓을 만들지 않고 원인 티켓에 코멘트를 남겨 사람에게
  에스컬레이션한다.
- **하지 말 것**: breach 여부를 모델이 판단하지 않는다. 어떤 tier에서도 프로덕션에 직접 쓰기/실행하지
  않는다(3σ도 PR 또는 사전 승인된 runbook 경유만). 깊이 제한을 넘어선 상태에서 후속 티켓을 만들지 않는다.

## hooks (8개) — 결정론적 계층

3층 가드레일(CLAUDE.md/skills/hooks) 중 **훅만 실제로 막는다.** CLAUDE.md와 skills는 유도(advisory)일 뿐
강제력이 없고, 훅은 위반을 발견하면 `exit 2`로 그 자리에서 도구 호출을 차단하고 이유를 stderr에 적어
Claude에게 돌려준다 — Claude Code는 그 stderr를 읽고 스스로 경로를 바꾼다. 반대로 입력을 파싱할 수 없거나
예상 밖 상황(도구 부재, 대상 파일/도구 불일치 등)이면 모든 훅이 **조용히 exit 0으로 통과**한다. 설정
실수나 `jq`/`python3` 부재로 저장소의 모든 편집이 막히는 사고를 피하기 위함이다.

| 훅 | 이벤트 · matcher | 하는 일 | 차단 조건(exit 2) |
| --- | --- | --- | --- |
| `guard-protected-paths.sh` | PreToolUse(10s) · `Edit\|Write\|MultiEdit` | `.env*`, `infra/`, `.github/workflows/` 편집 차단 | 대상 `file_path`가 세 패턴 중 하나에 걸릴 때 |
| `block-secrets.sh` | PreToolUse(10s) · `Edit\|Write\|MultiEdit` | 편집 내용에서 자격 증명처럼 보이는 문자열 탐지 | `content`/`new_string`/`edits[].new_string`이 AKIA 키, PEM 프라이빗 키, `gh_*`, `xox*`, `sk_live_*`, 일반 `secret=값` 패턴 중 하나에 매치할 때 |
| `production-gate.sh` | PreToolUse(10s) · `Bash` | 프로덕션 배포로 보이는 명령을 승인 없이 실행하는 것을 차단 | 명령이 배포 키워드(`kubectl apply`, `terraform apply`, `npm publish` 등)와 prod 키워드를 동시에 만족하고 `RELEASE_APPROVED=1`이 아닐 때 |
| `plan-drift.sh` | PreToolUse(10s) · `Bash` | `git commit` 시 스테이지된 파일이 plan.md의 "변경할 파일"에 있는지 대조 | 명령이 `git commit`이고, 스테이지된 파일 중 plan.md 목록(및 그 하위 경로)로 커버되지 않는 것이 있을 때 |
| `protect-tests.sh` | PreToolUse(10s) · `Edit\|Write\|MultiEdit` | 버그 수정 세션 중 테스트 파일 편집 차단 | `SDLC_BUGFIX=1`이고 대상 파일이 `*/tests/*`, `*/test/*` 또는 `test_*.py`/`*_test.py`/`*.test.{ts,tsx,js}`/`*.spec.{ts,js}` 패턴일 때 |
| `format-lint.sh` | PostToolUse(30s) · `Edit\|Write\|MultiEdit` | 편집된 파일을 확장자별로 자동 포맷 후 린트 | 포맷 후에도 린트(eslint/ruff/go vet)가 비어있지 않은 오류로 실패할 때 |
| `verify-before-done.sh` | Stop(30s) · (전체) | plan.md "성공 기준" 명령이 세션 트랜스크립트에 등장했는지 확인 | 성공 기준의 백틱 명령 중 트랜스크립트에서 문자열로 발견되지 않는 것이 있을 때 |
| `config-eval.sh` | PostToolUse(130s) · `Edit\|Write\|MultiEdit` | `CLAUDE.md`/`.claude/**` 변경 후 테스트 스위트 실행 | 감지된 테스트 명령이 0이 아닌 종료 코드(124 제외)로 실패할 때 |

### guard-protected-paths.sh

`.env`/`.env.*`, `infra/` 하위, `.github/workflows/` 하위 경로에 대한 Edit/Write/MultiEdit을 무조건 차단한다.
필요하면 사람이 직접 수정하고 리뷰 후 커밋하라고 안내한다. `tool_name`이 세 도구가 아니거나 `file_path`가
없으면(혹은 stdin 파싱 실패) exit 0으로 통과한다.

### block-secrets.sh

편집될 내용(`content`, `new_string`, `edits[].new_string`)을 정규식 패턴 목록에 대조해 시크릿처럼 보이는
문자열이 있으면 차단한다. 실제 시크릿이면 `.env`로 옮기라고(그리고 `.env`는 `guard-protected-paths.sh`가
별도로 보호한다고) 안내하고, 오탐이면 사람이 직접 편집하거나 패턴을 조정하라고 안내한다.
`ponytail:` 패턴 목록은 휴리스틱이지 진짜 시크릿 스캐너가 아니다. 커스텀 토큰 포맷에서 위음성이 문제가
되면 gitleaks/trufflehog로 교체하는 것이 업그레이드 경로다.

### production-gate.sh

`Bash` 명령을 배포 키워드(`kubectl apply`, `terraform apply`, `flyctl deploy`, `serverless deploy`,
`git push`, `npm publish`, `vercel ... --prod`)와 prod 키워드(`prod`/`production` 단어 경계, 또는
`npm publish`/`vercel --prod` 자체)로 동시에 판정해, 둘 다 참이고 환경변수 `RELEASE_APPROVED`가 `1`이
아니면 차단한다. `ponytail:` 키워드 휴리스틱이지 진짜 명령 파서가 아니다. 위음성이 문제가 되면
프로젝트별 배포-명령 allowlist로 교체하는 것이 업그레이드 경로다.

### plan-drift.sh

`git commit`이 포함된 `Bash` 명령에서만 동작한다. 가장 최근에 수정된 `docs/plan/*.md`를 찾아 그 안의
`## 변경할 파일` 섹션(다음 `## ` 헤딩 전까지)을 파싱한다. 각 줄에서 리스트 마커/백틱을 벗기고 **첫
공백 구분 토큰만** 남긴다 — `sdlc-plan` 템플릿이 `- \`src/api.py\` (수정)`처럼 경로 뒤에 주석을 붙이는
형식을 쓰기 때문에, 이 정규화가 없으면 아무 것도 매치되지 않는다. 이렇게 뽑은 계획 경로 목록과
`git diff --cached --name-only`(스테이지된 파일)를 대조해, 계획에 없는 파일이 섞여 있으면 차단한다.
**plan 문서 자신(`docs/plan/*.md`)은 이 검사에서 항상 예외다** — 이 훅의 해법이 "plan.md를 갱신하고
다시 커밋하라"이므로, 그 갱신 커밋 자체를 막으면 교착 상태가 된다. `ponytail:` 첫-토큰 파싱이라 경로에
공백이 있으면 표현할 수 없고, glob이나 gitignore식 부정 패턴도 지원하지 않는다. plan이 glob을 쓰기
시작하면 업그레이드 대상이다.

### protect-tests.sh

`SDLC_BUGFIX=1`이 설정된 세션에서만 동작한다(그 외에는 항상 exit 0). 대상 파일이 `*/tests/*`, `*/test/*`
아래이거나 파일명이 `test_*.py`/`*_test.py`/`*.test.{ts,tsx,js}`/`*.spec.{ts,js}` 패턴이면 Edit/Write/MultiEdit
자체를 차단한다 — 버그 수정 중에는 실패하는 테스트가 명세이므로 테스트가 아니라 코드를 고치라고 안내한다.
테스트 자체가 진짜 잘못됐다면 사람이 직접 고치고 이유를 PR에 남겨야 한다.

### verify-before-done.sh

`Stop` 훅이다. 먼저 `stop_hook_active`가 `true`면 즉시 exit 0으로 통과한다 — 이 훅이 stop을 막았다가 다시
stop을 시도하는 과정에서 **자기 자신이 무한 stop 루프를 만드는 것을 피하기 위함**이다. 그 외에는 가장 최근
`docs/plan/*.md`의 `## 성공 기준` 섹션에서 백틱으로 감싼 명령들을 뽑아, 각 명령 문자열이 세션
트랜스크립트(`transcript_path`) 안에 **문자열로(substring)** 등장하는지 확인한다. 하나라도 등장하지
않으면 차단하고, 그 명령들을 실제로 실행하고 결과를 확인한 뒤 끝내라고 안내한다. `ponytail:` 이건 실제
명령 실행 추적이 아니라 트랜스크립트 텍스트에 대한 substring 매치다 — 어딘가에 그 문자열을 그냥
타이핑/인용하기만 해도 "실행했다"고 오판할 수 있다. 위음성이 문제가 되면 실제 `tool_use`/`tool_result`
이벤트를 파싱하는 방식으로 업그레이드한다.

### format-lint.sh

Edit/Write/MultiEdit 직후 대상 파일 확장자에 맞춰 자동 포맷하고(JS/TS/JSON/CSS/MD → prettier, Python →
black, Go → gofmt), 이어서 린트를 돌린다(eslint, ruff, go vet). 포맷터/린터가 설치되어 있지 않거나 확장자가
목록에 없으면 그냥 exit 0으로 통과한다 — 도구 부재가 "네 코드가 망가졌다"로 오인되면 안 되기 때문이다.
린트가 실제로 비어있지 않은 오류를 내며 실패했을 때만 그 출력을 stderr로 돌려줘 같은 턴에서 자기수정을
유도한다. `ponytail:` JS/TS/Python/Go만 커버한다. 필요하면 확장자를 더 추가한다.

### config-eval.sh

대상 파일이 `CLAUDE.md`(basename) 또는 `.claude/` 하위일 때만 동작한다. 저장소의 테스트 명령을
`Makefile`의 `test:` 타깃 → `package.json`의 `scripts.test` → `pytest.ini`/`pyproject.toml` 순서로 감지해
120초 타임아웃으로 실행한다. **종료 코드 124(타임아웃이 죽였다는 뜻)는 실패가 아니라 "판정 보류"로
보고하고 exit 0으로 fail-open한다** — 정당하게 120초 넘게 걸리는 테스트 스위트를 가진 저장소가 매 설정
편집마다 "네 설정이 테스트를 깼다"는 오진을 받으면 안 되기 때문이다. 그 외 0이 아닌 종료 코드는 실제
실패로 보고 마지막 40줄 출력과 함께 차단한다.

## agents (2개)

### verifier

`tools: Read, Grep, Glob, Bash` — **Edit/Write가 애초에 주어지지 않는다.** plan.md의 "성공 기준"만 체크리스트로
삼아 실제 명령을 실행하고, plan.md의 "변경할 파일"과 `git diff --stat` 등 실제 변경분을 대조해 계획에 없던
변경이 섞였는지 확인한다. 실패를 발견해도 고치지 않는다 — 도구가 없어 애초에 불가능하며, 고치라는 지시를
받아도 "검증자는 수정 권한이 없다"고 답하고 원 세션(구현 담당)에 넘긴다. 기준에 없는 항목까지 임의로
통과/실패를 매기지 않고 "참고 사항"으로만 덧붙인다.

### e2e-reviewer

`tools: Read, Bash` — `sdlc-e2e` 스킬의 절차를 그대로 따른다. 준비 확인이 실패하면 그 사실을 그대로 보고하고
멈춘다(Aside는 TTY가 필요해 이 에이전트 맥락에서는 대체 수단이 될 수 없으므로 사람에게 직접 확인을
요청하라고 안내한다). 대상 URL이 주어지지 않으면 plan.md/spec.md나 저장소의 흔한 개발 서버 포트를
Read/Bash로 찾는다. 캡처한 스냅샷을 spec.md 요구사항, plan.md 성공 기준과 대조해 보고한다. 화면이
열렸다는 사실만으로 통과라 판단하지 않으며, 코드를 고치지 않는다.

## commands (3개)

### `/sdlc-init`

현재 저장소에 `templates/`의 `CLAUDE.md`(→ `.claude/CLAUDE.md`)·`REVIEW.md`·`ops/bands.yaml`·`ops/detect.sh`를 깐다. SDLC용 `CLAUDE.md`를 `.claude/` 아래에 두는 이유는 루트에 팀 `CLAUDE.md`가 이미 있어도 건너뛰지 않기 위해서다 — Claude Code는 둘 다 읽는다. 이미 있는 파일은 건너뛰고, `package.json`/`Makefile`/`pyproject.toml`에서 명령어를 찾아 `.claude/CLAUDE.md`를 채우며, 확신이 없는 칸은 `<확인 필요>`로 남긴다. 커밋은 사람에게 맡긴다.

### `/sdlc-run <ticket-id>`

티켓 하나에 대해 6단계를 순서대로 진행한다. **각 단계마다 승인 주체가 다르고, 승인 전에는 다음 단계로
넘어가지 않는다**:

| 단계 | 승인자 | 무엇을 승인하는가 |
| --- | --- | --- |
| 01 Plan | Product Owner | intent.md가 티켓 의도를 맞게 담았는가 |
| 02 Design | Product Owner | 정책 충돌을 정리했고 진행해도 되는가 |
| 03 Build | Engineer | 이 계획대로 코드를 편집해도 되는가 |
| 04 Test | Code Owner | 기계적 증거를 보고 의도·리스크 관점에서 통과인가 |
| 05 Deploy | Release Manager | 릴리스를 승인하는가 |
| 06 Maintain | Service Owner | 감지 결과를 어떻게 트리아지하는가 |

러너(`AI_SDLC/runner`)가 파이프라인을 돌릴 때는 이 승인이 Linear 하위 이슈로 만들어지고, 카드를 Done으로
옮기는 것이 승인이다. 사람이 대화형으로 이 명령을 쓸 때는 각 단계 끝에서 산출물 경로를 보여주고 대화로
승인을 받는다. 03 Build는 내부적으로 계획(`sdlc-plan`, 코드는 안 건드림)과 구현(승인된 계획대로 편집)
둘로 나뉜다.

### `/sdlc-status [ticket-id]`

인자가 없으면 `docs/intent/`, `docs/spec/`, `docs/plan/` 아래 가장 최근에 수정된 티켓을 대상으로 삼는다.
어떤 산출물이 존재하고 **커밋되어 있는지**(`git log --oneline -- <path>`)로 현재 단계를 판정한다 —
워킹트리에만 있는 미승인 초안과 구분해서 보고한다. 이 파이프라인이 `claude -p` 헤드리스 세션으로 돌고
있다면 세션 트랜스크립트 경로(`~/.claude/projects/<project-slug>/<session-id>.jsonl`, 가장 최근 파일은
`ls -t ~/.claude/projects/*/*.jsonl | head -1`)도 함께 출력한다.

진행 현황은 별도 시각화 도구 없이 두 곳에서 본다. **Linear 원 티켓 아래 게이트 하위 이슈 6개**가
단계별 승인 현황판이고(지금 도는 단계는 하위 이슈 순서로, 게이트가 대기 중이면 어느 역할이 어느 카드를
Done으로 옮겨야 하는지가 그 카드 코멘트에 적힌다), 06이 후속 티켓을 열면 원 티켓에 링크 코멘트가 남는다.
러너의 Slack 봇이 켜져 있으면 같은 정보를 티켓 스레드가 실시간으로 보여준다(`AI_SDLC/README.md`의
"3-C. Slack으로 쓰기" 참고).

## templates/CLAUDE.md.template

`/sdlc-init`이 `.claude/CLAUDE.md`로 복사해 채우는 템플릿이다(`명령어`/`컨벤션`/`아키텍처`/`반복된 실수`/
`AI-native SDLC 참고` 섹션으로 구성). 원문 규칙을 그대로 따른다: **CLAUDE.md는 저장소 컨텍스트를 담는
곳이지 매뉴얼이 아니다** — 템플릿 길이 정도의 1페이지 안에서 유지한다.

`반복된 실수` 섹션은 **같은 실수를 두 번째로 발견했을 때만** 한 줄을 추가한다(첫 실수는 그때 고치고
끝낸다). 그리고 **세 번째부터는 문서화 대신 훅으로 격상하는 걸 고려한다** — 문서로 두 번 알려줬는데도
반복되면 CLAUDE.md는 강제력이 없는 계층이므로, 결정론적으로 막는 훅으로 옮기는 편이 낫다는 판단이다.

`AI_SDLC/todo-app`에서 플러그인을 설치하고 `/sdlc-init`을 실행하면 `AI_SDLC/todo-app/.claude/CLAUDE.md`에
실제로 채워 넣은 예시가 생긴다(이 파일은 저장소에 커밋돼 있지 않다 — 직접 만들어 보라는 것이다). 그
`반복된 실수` 섹션에는 이 컨벤션이 실제로 적용된
사례들이 있다 — `ego-browser`의 `cliLog()`가 stdout이 아니라 stderr로 출력해 `2>&1` 없이는 스냅샷이
조용히 사라지는 문제, 그리고 node 서버는 코드를 바꿔도 자동으로 다시 뜨지 않아 `npm run dev`를 재시작해야 하는
문제(그 밖에 세션의 파일 쓰기 권한은 `Write(...)`가 아니라 `Edit(...)` 규칙으로 건다는 항목도 있다).

## 직접 확인해보기

아래는 실제로 실행해 검증한 명령과 결과다.

**skill 로딩 확인** (`AI_SDLC/todo-app`이 로컬 마켓플레이스로 이 플러그인을 등록해둔 상태):

```bash
cd AI_SDLC/todo-app && claude -p "네가 쓸 수 있는 sdlc-* 스킬 이름만 한 줄씩 출력해라" < /dev/null
```

실제 출력(10줄 — skill 7개 + command 3개):

```
ai-native-sdlc:sdlc-init
ai-native-sdlc:sdlc-run
ai-native-sdlc:sdlc-status
ai-native-sdlc:sdlc-intent
ai-native-sdlc:sdlc-spec
ai-native-sdlc:sdlc-plan
ai-native-sdlc:sdlc-test
ai-native-sdlc:sdlc-e2e
ai-native-sdlc:sdlc-review
ai-native-sdlc:sdlc-maintain
```

**production-gate.sh**:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"kubectl apply -f x.yaml --context prod"}}' \
  | bash AI_SDLC/plugin/hooks/production-gate.sh; echo "exit=$?"
```

실제 출력:

```
차단됨(production-gate): 프로덕션 배포로 보이는 명령이며 릴리스 승인이 없다.
  명령: kubectl apply -f x.yaml --context prod
  RELEASE_APPROVED=1 을 사람이 명시적으로 설정한 뒤에만 실행하라.
exit=2
```

**protect-tests.sh** (`SDLC_BUGFIX=1`이고 대상이 테스트 파일일 때):

```bash
SDLC_BUGFIX=1 bash -c 'echo "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"tests/test_foo.py\"}}" \
  | bash AI_SDLC/plugin/hooks/protect-tests.sh; echo "exit=$?"'
```

실제 출력:

```
차단됨(protect-tests): 버그 수정 중에는 실패하는 테스트가 명세다.
  파일: tests/test_foo.py
  테스트가 아니라 코드를 고쳐라. 테스트 자체가 진짜 잘못됐다면 사람이 직접 고치고
  그 이유를 PR에 남겨야 한다.
exit=2
```

**block-secrets.sh**:

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"config.py","new_string":"aws_secret_key = \"AKIAABCDEFGHIJKLMNOP\""}}' \
  | bash AI_SDLC/plugin/hooks/block-secrets.sh; echo "exit=$?"
```

실제 출력:

```
차단됨(block-secrets): 편집 내용에 자격 증명처럼 보이는 문자열이 있다.
  실제 시크릿이면 .env로 옮기고 커밋하지 마라(.env는 guard-protected-paths가 별도로 보호한다).
  오탐(테스트 픽스처 등)이면 사람이 직접 편집하거나 패턴을 조정하라.
exit=2
```
