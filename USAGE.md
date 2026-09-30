# 사용 설명서

이 저장소에는 두 가지가 들어 있다.

| 경로 | 무엇 |
| --- | --- |
| `slides/` | AI-native SDLC 개념을 설명하는 Remotion 애니메이션 발표자료 (18장, 2분 38초) |
| `AI_SDLC/` | Linear 티켓을 받아 6단계 파이프라인을 자동 실행하는 Claude Code 플러그인 + 로컬 러너 + 데모 앱 |

둘은 독립적이다. 발표만 할 거면 1번만, 파이프라인만 쓸 거면 2번부터 보면 된다.

원문: https://claude.com/blog/the-ai-native-sdlc-playbook

---

## 1. 발표자료

### 발표하기 (이걸 쓰면 된다)

```bash
cd slides
npm install       # 최초 1회
npm run present   # 브라우저가 자동으로 열린다 (localhost:5273)
```

화살표로 넘기면서 말하는 발표 모드다. 영상을 틀어놓는 게 아니라, **의미 단위로 끊어서** 재생이 선다.

| 키 | 동작 |
| --- | --- |
| `→` `Space` `↓` `PageDown` | 다음 단계. 다음 beat 까지 재생하고 멈춘다 |
| `←` `↑` `PageUp` | 이전 단계. 되감지 않고 그 지점으로 바로 이동 |
| `S` | 왼쪽 썸네일 목차 열기·닫기 (`Esc` 로도 닫힘) |
| `F` | 전체화면 |
| `R` | 방금 구간 다시 재생 |
| `Home` `End` | 처음 / 마지막 장 |

- 왼쪽 목차는 18장 썸네일이다. 클릭하면 그 장의 **내용이 다 나온 상태**로 이동한다. 경계를 드래그해 폭을 조절할 수 있다.
- 오른쪽 아래에 `05 / 18 · 2/4` 처럼 현재 장과 그 장의 몇 번째 단계인지 나온다.
- 아래 진행 막대는 장 단위가 아니라 beat 단위로 찬다. 남은 분량이 실제 말하는 호흡과 맞는다.

**멈추는 지점을 바꾸려면** `slides/src/Deck.tsx` 의 `beats` 배열을 고치면 된다. 단위는 초다.

```ts
{ id: "S06Table", component: S06Table, frames: 270, beats: [1.4, 2.0, 2.6, 3.2, 3.8, 4.5] },
```

대조표처럼 한 줄씩 짚고 싶으면 beat 를 촘촘히, 한 번에 보여주고 설명할 거면 성글게 두면 된다.

### 편집하며 보기

```bash
npx remotion studio  # Remotion Studio
```

Studio 왼쪽 트리에서:

- `Deck` — 18장 전체 이어붙인 것
- `Slides/` 폴더 — 개별 슬라이드. 한 장씩 열어 편집하거나 스틸로 뽑을 수 있다

발표 모드(`npm run present`)와 Studio 는 다른 서버다. 발표는 발표 모드로, 편집은 Studio 로 하면 된다.

### 영상으로 내보내기

```bash
cd slides
npx remotion render Deck out/deck.mp4                # 1920x1080
npx remotion render Deck out/deck.mp4 --scale=0.5    # 절반 해상도, 빠름
```

### 한 장만 이미지로

```bash
npx remotion still S06Table out/table.png --frame=200
```

`--frame`은 0부터 센다. 30fps이므로 `--frame=200`은 약 6.7초 지점이다.
슬라이드마다 애니메이션이 7초 안에 끝나므로 `--frame=210` 근처가 완성된 화면이다.

### 대본

`slides/script.md`에 18장 전체 나레이션이 있다. 슬라이드당 30~50초 기준이며 전체 12~15분 분량이다.
발표 팁(어느 장에서 멈춰야 하는지, 어느 장이 짝인지)도 문서 끝에 있다.

### 내용을 고치려면

- 색·글자 크기: `slides/src/theme.ts` 한 곳에서만 관리한다
- 6단계 이름: `slides/src/components/Stage.tsx`의 `STAGES` 배열
- 슬라이드 순서·길이·발표 beat: `slides/src/Deck.tsx`의 `SLIDES` 배열
- 개별 슬라이드: `slides/src/slides/SNN*.tsx`
- 발표 모드 자체: `slides/src/present/` (`Presenter.tsx` 조작, `Filmstrip.tsx` 목차)

고친 뒤에는 반드시 확인할 것:

```bash
npx tsc --noEmit                                   # 타입
npx remotion still <슬라이드ID> out/check.png --scale=0.5 --frame=210   # 눈으로
```

레이아웃이 넘치는지는 타입체크로 안 잡힌다. 스틸을 실제로 열어봐야 한다.

---

## 2. 플러그인을 내 저장소에 적용하기

`AI_SDLC/plugin/`이 Claude Code 플러그인이다. 원문의 6단계와 3층 가드레일을 담고 있다.

### 들어있는 것

7 skill + 8 hook + 2 subagent + 3 command. 각 파일이 어느 단계에서 정확히 뭘 하고 시연에서 어떻게
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
| command | `/sdlc-status` | 진행 상태와 세션 트랜스크립트 경로 |
| command | `/sdlc-visualize` | 대시보드 URL 안내, 러너 상태(`/health`) 확인 |
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
claude plugin marketplace add PeterCha90/FastCampus
claude plugin install ai-native-sdlc@ai-sdlc     # 팀 공유는 --scope project
```

설치 후 Claude Code를 재시작한다. 이 저장소를 클론해 두고 개발 중이라면 아래 두 방법도 된다.

**(a) 세션 단위, 설치 없이**

```bash
claude --plugin-dir <AI_SDLC/plugin 경로>
```

**(b) 저장소 단위, 자동으로**

프로젝트 저장소에 `.claude/settings.json`을 두고 로컬 마켓플레이스를 등록하면, 그 디렉토리에서
`claude`를 띄울 때마다 자동으로 붙는다. 실제로 동작하는 예시(`AI_SDLC/demo/.claude/settings.json`):

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
아예 동작하지 않는다. `path`는 프로젝트 디렉토리(위 예시라면 `AI_SDLC/demo/`) 기준 **상대 경로**여야
한다. 절대 경로를 넣으면 에러 한 줄 없이 스킬이 하나도 로드되지 않는다. 로드됐는지 확인하는 방법은
§7 참고.

### 저장소 준비

대상 저장소에서 Claude Code를 열고 `/sdlc-init`을 실행한다. `CLAUDE.md`·`REVIEW.md`·`ops/bands.yaml`·`ops/detect.sh`를 깔고(기존 파일은 덮어쓰지 않음) `CLAUDE.md`의 명령어 칸을 채운다. 그다음 `CLAUDE.md`를 자기 저장소에 맞게 고친다. 규칙 두 개만 지키면 된다.

- **1페이지를 넘기지 말 것.** 길어지면 읽히지 않는다
- **같은 실수를 두 번 하면 그 교정을 여기에 적을 것.** 이게 이 파일이 자라는 유일한 방법이다

실제로 채워 넣은 예시가 `AI_SDLC/demo/CLAUDE.md`에 있다.

03 단계 이후부터는 CLAUDE.md 말고도 파이프라인이 기대하는 파일이 두 개 더 있다.

- `REVIEW.md` — 05 Deploy의 `sdlc-review`가 따르는 리뷰 정책 문서(Important/Nit 기준, nit 5건 상한,
  리뷰가 지적하지 말아야 할 것). 예시: `AI_SDLC/demo/REVIEW.md`
- `ops/bands.yaml` + `ops/detect.sh` — 06 Maintain이 이상 여부(tier)를 판정할 때 쓰는 지표 기준값과
  결정론적 스크립트. 예시: `AI_SDLC/demo/ops/`

---

## 3. 파이프라인 돌리기

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
있다. `repoPath`는 `../demo`로 고정돼 있다 — 러너는 이 저장소의 `AI_SDLC/demo/`를 대상으로 돈다.

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
bash AI_SDLC/demo/ops/detect.sh --self-check
```

실제로 돌려서 확인한 결과: `npm run typecheck`는 에러 없이 통과, `npm test`는 25개 테스트 전부 통과
(서명 검증, 이벤트 파싱, 게이트 폴링/타임아웃/자동승인, 루프 깊이 제한, tier 파싱), `detect.sh --self-check`는
`self-check: PASS`(tier 경계 4개 assert)를 출력한다.

---

## 4. 대시보드로 흐름 보기

**먼저 알아둘 것:** 러너 자신이 `http://localhost:3939/`에서 파이프라인 대시보드를 서빙한다. 별도 뷰어를
설치하거나 임의의 파이프라인 정의를 어딘가에 먹일 필요가 없다 — 러너를 띄운 상태에서 브라우저로 그 주소만
열면 된다.

### 보기

```bash
curl -s localhost:3939/health   # {"status":"ok"} 나오면 러너가 떠 있는 것
open http://localhost:3939/     # 대시보드
```

대시보드가 그리는 원본 JSON은 `GET /api/runs`다. 티켓 실행(run)마다 카드 하나, 카드 안에 7개 컬럼
(00 Setup, 01 Plan … 06 Maintain)이 있고 각 컬럼은 그 단계 상태(대기/실행 중/완료/실패)와 승인 게이트 칩
(승인자 역할, 승인 대기/승인/반려/자동 승인, 해당 Linear 게이트 하위 이슈 링크)을 보여준다. 지금 도는
단계는 하이라이트되고, 게이트가 대기 중이면 어느 역할이 어느 Linear 카드를 Done으로 옮겨야 하는지가 그대로
적힌다. 06이 후속 티켓을 열면 그 카드에 "↺ 06 → 새 티켓 → 01"이 붙고 새로 생긴 실행의 카드로 링크된다.

세션 트랜스크립트 경로(`~/.claude/projects/<슬러그>/<세션id>.jsonl`)는 대시보드에 "세션 로그"라는 텍스트로
계속 표시된다 — 그 세션을 직접 열어 디버깅하고 싶을 때를 위한 것이고, 대시보드 자체가 그 파일을 그려주는
건 아니다. 대시보드가 실제로 읽는 건 `runner/.state/` 아래 단계 로그·게이트 맵·라이브 상태·메타 파일이다.

시연할 때는 터미널 1개 + 브라우저 1개를 나란히 둔다. 왼쪽은 러너 로그, 오른쪽은 대시보드. 러너가 각 단계를
시작·종료할 때마다 `.state/`가 갱신되므로 대시보드가 곧바로 따라잡는다.

네트워크 없이 UI만 미리 보여주고 싶으면 러너 README의 대시보드 미리보기 절차(시드 상태로 채운 고정 데이터)를
따른다.

---

## 5. 데모 앱과 시연

`AI_SDLC/demo/`가 시연용 앱이다. React+Vite / FastAPI.

```bash
cd AI_SDLC/demo
make install
make dev       # 백엔드 :8000, 프런트 :5173
make test      # pytest + 프런트 빌드. 04 TEST 단계가 부르는 단일 명령
make e2e       # ego-lite로 화면 검증
```

저장소 안에 파이프라인이 실제로 참조하는 파일도 함께 들어 있다.

- `CLAUDE.md` — 03 Build가 매 세션 읽는 컨텍스트(명령어/컨벤션/아키텍처/반복된 실수)
- `REVIEW.md` — 05 Deploy의 `sdlc-review`가 따르는 리뷰 정책
- `ops/bands.yaml` + `ops/detect.sh` — 06 Maintain이 티어를 판정할 때 쓰는 기준·스크립트

### 심어둔 버그

`POST /todos`가 빈 `title`을 검증 없이 저장한다. 프런트에만 검증이 있어서 API를 직접 때리면 목록이 깨진다.
환경변수 하나로 켜고 끈다.

```bash
unset DEMO_STRICT_VALIDATION       # 버그 ON  — 시연 시작 상태
export DEMO_STRICT_VALIDATION=1    # 버그 OFF — 파이프라인이 고친 뒤의 상태
```

확인: `./e2e/check.sh`가 **exit 1**이면 버그가 켜진 정상 상태다. exit 0이면 꺼져 있으니 `unset` 후 백엔드를 재시작한다.

### 시연 대본

`AI_SDLC/docs/demo-scenario.md`에 8구간 시간대별 대본이 있다. 준비 체크리스트, 대사, 실패 대비, Q&A 7문항 포함.
클라이맥스는 04단계에서 e2e가 버그를 잡고 → 06단계가 Linear에 새 티켓을 자동 생성하는 지점이다.

시연의 눈에 보이는 축은 이제 여섯 장의 Linear 카드다. 티켓 하나가 들어오면 `00-setup`이 승인 게이트
하위 이슈 6개를 만들고, 각 단계가 끝날 때마다 담당자가 그 카드를 Done(승인) 또는 Canceled(반려)로
옮기는 것 자체가 파이프라인이 실제로 사람 손을 거쳐 진행되고 있다는 증거가 된다. 관객에게는 이 여섯
장이 하나씩 옮겨지는 걸 보여주는 게 핵심이다.

---

## 6. Linear 말고 Jira를 쓴다면

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

## 7. 문제가 생기면

| 증상 | 확인할 것 |
| --- | --- |
| 러너가 즉시 종료 | 환경변수 2개(`LINEAR_WEBHOOK_SECRET`/`LINEAR_API_KEY`)가 셸에 있는지, `sdlc.config.json`의 `linearTeamId`가 `REPLACE_WITH_LINEAR_TEAM_ID` 그대로 남아있지 않은지 |
| webhook이 401 | Linear 설정의 시크릿과 `LINEAR_WEBHOOK_SECRET`이 같은지 |
| 스킬/훅이 하나도 안 붙음 | `.claude/settings.json`의 마켓플레이스 `source.source`가 `"directory"`인지(`"local"`은 동작하지 않는다), `path`가 절대 경로가 아니라 프로젝트 기준 **상대 경로**인지 확인. 실패해도 에러가 안 뜬다. 확인: `cd AI_SDLC/demo && claude -p "네가 쓸 수 있는 sdlc-* 스킬 이름만 한 줄씩 출력해라." < /dev/null` — 10개(스킬 7 + 커맨드 3)가 나와야 정상, 안 나오면 `path`부터 의심 |
| `00-setup`이 게이트 맵을 못 만듦(`no approval-gate map` 에러로 파이프라인 중단) | Linear MCP가 파이프라인을 돌리는 `claude` 세션에 인증되어 있는지 확인 — `LINEAR_API_KEY` 환경변수와는 별개의 인증이다. 리허설만 필요하면 `SDLC_AUTO_APPROVE=1`로 우회 |
| 게이트가 계속 대기 상태로 멈춤 | 담당자가 하위 이슈를 Done/Canceled로 안 옮기면 `gateTimeoutMs`(기본 30분) 뒤 타임아웃으로 처리되고 그 단계에서 멈춘다. 카드를 옮기거나 `gateTimeoutMs`를 늘린다 |
| e2e가 아무것도 안 뱉음 | `cliLog`는 stdout이 아니라 **stderr**로 출력한다. `2>&1` 병합했는지 |
| ego-lite가 "Please complete the onboarding process first" | 앱을 한 번 실행해 GUI 온보딩을 마쳐야 한다. 확인: `printf 'cliLog("ok")\n' \| ego-browser nodejs 2>&1` |
| 대시보드가 안 뜨거나 오래된 상태만 보임 | `curl -s localhost:3939/health`로 러너가 떠 있는지 먼저 확인. 떠 있는데도 안 바뀌면 `GET /api/runs`를 직접 호출해 `runner/.state/`가 갱신되고 있는지 본다 |
| 슬라이드 글자가 잘림 | 타입체크로는 안 잡힌다. `npx remotion still`로 스틸 뽑아 눈으로 확인할 것 |
| 훅이 모든 편집을 막음 | 훅 스크립트는 입력이 이상하면 통과시키도록(fail open) 되어 있다. `bash -n`으로 문법부터 확인 |

---

## 더 읽을 것

- `AI_SDLC/docs/architecture.md` — 6단계 전체 흐름과 아티팩트 표
- `AI_SDLC/docs/demo-scenario.md` — 시연 대본
- `docs/superpowers/specs/2026-09-04-ai-native-sdlc-design.md` — 이 프로젝트의 설계 문서와 범위 밖 항목
