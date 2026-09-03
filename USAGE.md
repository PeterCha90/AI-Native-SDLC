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

| 종류 | 이름 | 하는 일 |
| --- | --- | --- |
| skill | `sdlc-intent` | 티켓·로그·대화에서 `intent.md`를 만든다 |
| skill | `sdlc-spec` | `intent.md` → `spec.md` |
| skill | `sdlc-plan` | `spec.md` → `plan.md`. "무엇이 깨질 수 있는가"로 계획을 심문한다 |
| skill | `sdlc-review` | PR을 Bugs/Security/Compliance 3패스로 리뷰. nit은 최대 5개 |
| skill | `sdlc-e2e` | ego-lite로 화면을 열어 검증 |
| command | `/sdlc-run` | 티켓 키를 받아 6단계 진행 |
| command | `/sdlc-status` | 진행 상태와 세션 트랜스크립트 경로 |
| command | `/sdlc-visualize` | zoetrope로 여는 법 |
| agent | `verifier` | `plan.md`의 성공 기준 충족 여부만 확인. 수정 권한 없음 |
| agent | `e2e-reviewer` | ego-lite로 화면 확인 |
| hook | `guard-protected-paths.sh` | `.env*`, `infra/`, 워크플로 편집 차단 |
| hook | `block-secrets.sh` | 자격 증명이 diff에 들어가면 차단 |
| hook | `format-lint.sh` | 편집 후 자동 포맷·린트 |
| hook | `production-gate.sh` | `RELEASE_APPROVED` 없으면 프로덕션 배포 차단 |

훅은 차단할 때 **exit code 2**로 끝내고 사유를 stderr로 낸다. 그래야 Claude가 왜 막혔는지 알고 다른 방법을 찾는다.

### 설치

```bash
claude
# 세션 안에서
/plugin marketplace add <이 저장소 URL>
/plugin install ai-native-sdlc
```

로컬에서 바로 시험하려면 `AI_SDLC/plugin/`을 마켓플레이스로 등록하면 된다.

### 저장소 준비

```bash
cp AI_SDLC/plugin/CLAUDE.md.template ./CLAUDE.md
```

그리고 자기 저장소에 맞게 고친다. 규칙 두 개만 지키면 된다.

- **1페이지를 넘기지 말 것.** 길어지면 읽히지 않는다
- **같은 실수를 두 번 하면 그 교정을 여기에 적을 것.** 이게 이 파일이 자라는 유일한 방법이다

---

## 3. 파이프라인 돌리기

`AI_SDLC/runner/`가 Linear webhook을 받아 6단계를 실행하는 로컬 데몬이다.
각 단계는 `claude -p` 헤드리스 세션으로 돈다.

### 준비

```bash
cd AI_SDLC/runner
npm install

export LINEAR_WEBHOOK_SECRET=...   # Linear webhook 설정 화면에서 발급
export LINEAR_API_KEY=...          # 06단계가 티켓을 만들 때 사용
export LINEAR_TEAM_ID=...
```

비밀값은 환경변수로만 받는다. `sdlc.config.json`에 적지 말 것.
나머지 설정(포트, 대상 저장소 경로, e2e 드라이버, worktree 사용 여부)은 `sdlc.config.json`에 있다.

### 실행

```bash
npm start
curl -s localhost:3939/health    # {"status":"ok"} 나오면 정상
```

Linear webhook을 로컬로 넣으려면 터널이 필요하다. webhook URL은 `POST /webhook/linear`.

### 6단계가 하는 일

| 단계 | 입력 | 출력 |
| --- | --- | --- |
| 01 intent | Linear 티켓 | `docs/intent/<key>.md` |
| 02 spec | intent.md | `docs/spec/<key>.md` |
| 03 build | spec.md | `docs/plan/<key>.md` + 코드 (worktree 안에서) |
| 04 test | 코드 | 유닛 테스트 + ego-lite e2e 결과 |
| 05 deploy | 통과한 코드 | PR (`gh pr create`). 프로덕션 게이트는 넘지 않는다 |
| 06 maintain | 04/05 결과 | 실패했으면 **Linear에 새 티켓 생성** — 여기서 루프가 닫힌다 |

### 무한 루프 방지

06단계가 만드는 티켓에는 `sdlc-auto` 라벨이 붙고 본문에 `sdlc-depth: N`이 기록된다.
`sdlc.config.json`의 `maxAutoTicketDepth`(기본 3)를 넘으면 티켓을 더 만들지 않고 원본 티켓에 댓글만 남긴다.

사람이 만든 티켓은 라벨이 없으므로 깊이에 포함되지 않는다.

### 검증

```bash
npm run typecheck
npm test          # 서명 검증, 이벤트 파싱, 루프 깊이 제한
```

---

## 4. zoetrope로 흐름 보기

**먼저 알아둘 것:** zoetrope는 Claude Code 세션 트랜스크립트(`~/.claude/projects/<슬러그>/<세션id>.jsonl`) 전용 뷰어다.
자체 설정 포맷이 없어서 임의의 파이프라인 정의를 먹여 그릴 수 없다.

그래서 이 설계는 파이프라인 각 단계를 `claude -p`로 돌린다. 그러면 트랜스크립트가 부수적으로 생기고,
zoetrope가 그걸 그대로 그린다. 별도 시각화 포맷을 발명할 필요가 없다.

### 설치

```bash
brew install furkankly/tap/zoetrope     # 또는
cargo install zoetrope
```

브라우저로 쓰려면 https://zoetrope.furkankly.dev/app 에 `.jsonl`을 드래그앤드롭하면 된다. 설치 불필요.

### 보기

```bash
zoe                              # 현재 프로젝트의 라이브 세션 추적
zoe <file.jsonl> --follow        # 특정 기록을 라이브 엣지에서
zoe <file.jsonl> --speed 4       # 재생 속도 (기본 8.0)
zoe inspect <file.jsonl>         # 헤드리스로 세션 트리만 출력
```

시연할 때는 터미널 2개를 나란히 둔다. 왼쪽은 러너 로그, 오른쪽은 `zoe`.
러너가 각 단계 시작 시 세션 JSONL 경로를 로그에 찍으므로 그걸 `zoe`에 물리면 된다.

**주의:** 이 JSONL 형식은 Claude Code 내부 포맷이고 문서화되어 있지 않다.
Claude Code 업데이트로 깨질 수 있다. 이상하면 `zoe inspect`로 파싱되는지 먼저 확인할 것.

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

---

## 6. Linear 말고 Jira를 쓴다면

교체 지점은 딱 한 곳이다. `AI_SDLC/runner/src/adapters/`.

```ts
export interface TicketSource {
  name: string;
  verify(headers, rawBody): boolean;        // 서명 검증
  parse(rawBody): Ticket | null;            // 이벤트 → 공통 Ticket, 관심 없으면 null
  createTicket(t: NewTicket): Promise<Ticket>;
  comment(ticketId: string, body: string): Promise<void>;
}
```

`adapters/jira.ts`가 이 인터페이스를 구현한 스텁으로 이미 들어 있다. 각 메서드를 채우고
`sdlc.config.json`의 `ticketSource`를 `"jira"`로 바꾸면 파이프라인 나머지는 손대지 않아도 된다.

---

## 7. 문제가 생기면

| 증상 | 확인할 것 |
| --- | --- |
| 러너가 즉시 종료 | 환경변수 3개(`LINEAR_WEBHOOK_SECRET`/`LINEAR_API_KEY`/`LINEAR_TEAM_ID`)가 셸에 있는지 |
| webhook이 401 | Linear 설정의 시크릿과 `LINEAR_WEBHOOK_SECRET`이 같은지 |
| e2e가 아무것도 안 뱉음 | `cliLog`는 stdout이 아니라 **stderr**로 출력한다. `2>&1` 병합했는지 |
| ego-lite가 "Please complete the onboarding process first" | 앱을 한 번 실행해 GUI 온보딩을 마쳐야 한다. 확인: `printf 'cliLog("ok")\n' \| ego-browser nodejs 2>&1` |
| `zoe`가 세션을 못 읽음 | `zoe inspect <file>`로 파싱되는지 먼저 확인. Claude Code 업데이트로 형식이 바뀌었을 수 있다 |
| 슬라이드 글자가 잘림 | 타입체크로는 안 잡힌다. `npx remotion still`로 스틸 뽑아 눈으로 확인할 것 |
| 훅이 모든 편집을 막음 | 훅 스크립트는 입력이 이상하면 통과시키도록(fail open) 되어 있다. `bash -n`으로 문법부터 확인 |

---

## 더 읽을 것

- `AI_SDLC/docs/architecture.md` — 6단계 전체 흐름과 아티팩트 표
- `AI_SDLC/docs/zoetrope.md` — 시각화 상세
- `AI_SDLC/docs/demo-scenario.md` — 시연 대본
- `docs/superpowers/specs/2026-09-04-ai-native-sdlc-design.md` — 이 프로젝트의 설계 문서와 범위 밖 항목
