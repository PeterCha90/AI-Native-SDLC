# 단계 × 가드레일 대응표

원문 [The AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)의 6단계 각각에서, 이 저장소의 **어떤 파일이 실제로 무슨 역할을 하는지**와 **그것을 시연에서 어떻게 눈에 보이게 하는지**를 정리한다. "설계상 그렇다"가 아니라 전부 디스크에 있는 파일이며, 마지막 열의 명령을 그대로 치면 동작을 확인할 수 있다.

## 한눈에 보기

| 단계 | 승인 역할 | skill | hook | 그 밖의 설정 | 산출물 |
| --- | --- | --- | --- | --- | --- |
| 00 setup | — | — | — | Linear MCP | `runner/.state/<key>.gates.json`, Linear 하위 이슈 6개 |
| 01 Plan | Product Owner | `sdlc-intent` | — | — | `docs/intent/<key>.md` |
| 02 Design | Product Owner | `sdlc-spec` | — | — | `docs/spec/<key>.md` |
| 03 Build | Engineer | `sdlc-plan` | `guard-protected-paths` · `block-secrets` · `format-lint` · `plan-drift` | `demo/CLAUDE.md` | `docs/plan/<key>.md`, 코드 diff |
| 04 Test | Code Owner | `sdlc-test` · `sdlc-e2e` | `protect-tests` · `verify-before-done` · `config-eval` | `verifier` · `e2e-reviewer` 서브에이전트 | 테스트/e2e 결과 |
| 05 Deploy | Release Manager | `sdlc-review` | `production-gate` | `demo/REVIEW.md` | PR, 리뷰 결과 |
| 06 Maintain | Service Owner | `sdlc-maintain` | — | `demo/ops/bands.yaml` · `demo/ops/detect.sh` · Linear MCP | 신규 `intent.md`, 신규 Linear 티켓 |

3층 중 **훅만 실제로 막는다.** CLAUDE.md와 skill은 유도이고, 훅은 `exit 2`로 그 자리에서 차단한다. 그래서 되돌리기 어려운 지점(코드 편집, 커밋, 배포, 완료 선언)에만 훅을 걸었다.

## 단계별 상세

### 00 setup — Linear에 승인 파이프라인을 만든다

티켓이 들어오면 가장 먼저 `claude -p`가 **Linear MCP**로 원 티켓 아래 하위 이슈 6개를 만든다. 하나가 게이트 하나다.

```
LIN-42  빈 제목 할 일이 저장됨              ← 사람이 만든 원 티켓
├─ [gate] 01-plan — 승인자: Product Owner
├─ [gate] 02-design — 승인자: Product Owner
├─ [gate] 03-build — 승인자: Engineer
├─ [gate] 04-test — 승인자: Code Owner
├─ [gate] 05-deploy — 승인자: Release Manager
└─ [gate] 06-maintain — 승인자: Service Owner
```

승인 신호는 매직 문자열이 아니라 **Linear의 기본 상태 전이**다.

| 하위 이슈 상태 | 러너 해석 |
| --- | --- |
| Done (`completed`) | 승인 — 다음 단계 진행 |
| Canceled (`canceled`) | 반려 — 파이프라인 중단, 마지막 코멘트를 사유로 기록 |
| 그 외 | 대기 — 10초 간격 폴링, 상한 30분 |

승인자는 "카드를 옮긴다" 외에 배울 게 없다. 게이트 매핑 파일이 없거나 깨졌으면 러너는 **큰 소리로 중단한다** — 게이트 없이 6단계가 도는 경로는 만들지 않았다.

**확인**: `cat runner/.state/<key>.gates.json`

### 01 Plan — `sdlc-intent`

`sdlc-intent` 스킬이 발안자 인터뷰 절차(문제 / 원하는 결과 / 영향 범위 / 제약 / 미해결 질문)를 강제한다. 모르는 것을 지어내지 않고 "미해결 질문"에 남기는 게 이 스킬의 핵심이다.

**확인**: 생성된 `docs/intent/<key>.md`에 "미해결 질문" 섹션이 있고, 티켓에 없던 내용이 추측으로 채워지지 않았는지 본다.

### 02 Design — `sdlc-spec`

원문의 Design 프롬프트를 그대로 따른다: intent.md를 근거로, 저장소의 skills·가이드라인을 **참고가 아니라 준수 조건으로** 적용하고, 정책끼리 충돌해 다 만족시킬 수 없는 지점을 해당 설계 항목 **바로 아래 인라인**으로 표시한다.

**확인**: `docs/spec/<key>.md`의 "정책 충돌" 표시. Product Owner는 이 항목을 각 정책 담당자와 정리한 뒤에 게이트를 승인한다.

### 03 Build — `sdlc-plan` + CLAUDE.md + 훅 4개

이 단계는 게이트를 사이에 두고 둘로 쪼개져 있다.

1. `03-plan` — `sdlc-plan` 스킬이 `docs/plan/<key>.md`를 쓴다. 변경할 파일, 작업 순서, 위험, 성공 기준, 그리고 "무엇이 깨질 수 있는가" 심문. **코드는 건드리지 않는다.**
2. **게이트** — Engineer가 계획을 심문하고 승인한다.
3. `03-build` — 승인된 계획대로 구현한다.

여기서 3층이 전부 걸린다.

| 파일 | 성격 | 하는 일 |
| --- | --- | --- |
| `demo/CLAUDE.md` | 컨텍스트 | 명령어·컨벤션·아키텍처·반복된 실수. 매 `claude -p` 호출이 읽는다 |
| `hooks/guard-protected-paths.sh` | 차단 | `.env*`, `infra/`, `.github/workflows/` 편집 차단 |
| `hooks/block-secrets.sh` | 차단 | 편집 내용에 자격 증명 패턴이 있으면 차단 |
| `hooks/format-lint.sh` | 교정 | 편집 직후 자동 포맷, 린트 실패는 되돌려줘 자가 수정시킴 |
| `hooks/plan-drift.sh` | 차단 | `git commit` 시 스테이지된 파일이 plan.md의 "변경할 파일"에 없으면 차단 |

`plan-drift.sh`가 원문이 말한 "훅으로 plan.md와 다르게 진행된 작업을 잡아라"의 구현이다. 계획에 없는 파일을 슬쩍 끼워 넣는 것을 커밋 시점에 막는다.

**시연**: 계획에 없는 파일을 하나 만들고 `git add` 후 커밋시키면 훅이 그 파일명을 지목하며 막는다.

### 04 Test — `sdlc-test` + 훅 3개 + 서브에이전트

`sdlc-test` 스킬이 피드백 루프를 강제한다: 검사를 **실제로 돌리고**, 출력을 읽고, 고치고, 통과할 때까지 반복. 버그 수정이면 **실패하는 테스트로 먼저 재현**하고 테스트가 아니라 코드를 고친다.

| 파일 | 하는 일 |
| --- | --- |
| `hooks/protect-tests.sh` | `SDLC_BUGFIX=1`인 동안 테스트 파일 편집 차단 — 테스트를 고쳐서 통과시키는 걸 막는다 |
| `hooks/verify-before-done.sh` | **Stop 훅**. plan.md의 "성공 기준" 명령을 한 번도 안 돌렸으면 완료를 막는다 |
| `hooks/config-eval.sh` | `CLAUDE.md`나 `.claude/**`가 바뀌면 테스트 스위트를 돌린다 |
| `agents/verifier.md` | 신선한 컨텍스트에서 **한 번만** 도는 독립 검증자. 코드를 만든 세션의 가정에 오염되지 않는다 |
| `agents/e2e-reviewer.md` | ego-lite로 실제 화면을 열어 스냅샷을 요구사항과 대조 |

피드백 루프와 `verifier`는 다른 것이다. 루프는 만든 사람이 스스로 돌리는 것이고, `verifier`는 판정만 하는 별도 컨텍스트다.

**시연**: 성공 기준을 안 돌리고 끝내려 하면 Stop 훅이 그 명령을 나열하며 세션을 못 끝내게 한다.

### 05 Deploy — `sdlc-review` + `REVIEW.md` + `production-gate`

`sdlc-review` 스킬이 모든 PR에 동일한 세 패스를 돌린다: **Bugs / Security / Compliance**. `demo/REVIEW.md`가 그 정책 문서다 — Important와 Nit의 정의, **nit 5건 상한**, 리뷰에서 제기하지 말아야 할 항목(포매터가 처리하는 것, 취향 수준 네이밍, 이미 훅이 막는 패턴).

지배 원칙 하나: **리뷰 결과는 스스로 승인하지도 차단하지도 않는다.** 코드 오너가 승인하고, `production-gate.sh`가 프로덕션을 막는다. 코드를 쓴 에이전트가 그것을 승인할 방법은 없다.

`hooks/production-gate.sh`는 프로덕션 배포로 보이는 명령을 `RELEASE_APPROVED=1` 없이는 `exit 2`로 막는다.

**시연**: `kubectl apply ... --context prod` 같은 명령을 시키면 훅이 차단 사유를 돌려준다.

### 06 Maintain — `detect.sh` → tier → `sdlc-maintain` → Linear MCP

원문이 가장 강조하는 지점: **감지 계층에 모델이 없다.** `ops/detect.sh`는 `claude`를 한 번도 호출하지 않는 순수 스크립트다. `ops/bands.yaml`에서 지표의 baseline과 sigma를 읽고 `deviation = |value - baseline| / sigma` 를 계산한다.

| tier | action | 에이전트 권한 |
| --- | --- | --- |
| < 1σ | `none` | 없음 |
| 1σ | `log` | 없음 — 기록만 |
| 2σ | `diagnose` | **read-only**. 원인만 진단, 파일도 티켓도 만들지 않는다 |
| 3σ | `act` | `sdlc-maintain`이 진단을 새 `intent.md`로 쓰고 **Linear MCP로 티켓을 만든다**. 프로덕션 직접 조치는 불가 — PR 또는 사전 승인된 runbook 경유만 |

3σ에서 만들어진 티켓에는 `sdlc-auto` 라벨과 `sdlc-depth: N+1`이 붙고, 그 티켓이 다시 01 Plan을 트리거하면서 **루프가 닫힌다.** depth가 `maxAutoTicketDepth`를 넘으면 티켓을 만들지 않고 원 티켓에 코멘트를 남겨 사람에게 넘긴다.

**확인**:

```bash
bash demo/ops/detect.sh --self-check                                  # 티어 경계 4개 assert
bash demo/ops/detect.sh --metric e2e_failure_rate --value 0.1         # tier=1 action=log
bash demo/ops/detect.sh --metric e2e_failure_rate --value 0.5         # tier=3 action=act
```

## 플러그인이 실제로 로드되는지 확인

두 경로 모두 살아 있어야 한다.

**헤드리스(러너)** — 모든 단계가 `--plugin-dir <AI_SDLC/plugin>`으로 실행된다. `runner/src/claude.ts` 참조.

**대화형(사람이 직접)** — `demo/.claude/settings.json`이 `AI_SDLC/.claude-plugin/marketplace.json`을 로컬 마켓플레이스로 등록하고 플러그인을 활성화한다. `demo/`에서 `claude`를 띄우면 스킬·훅·서브에이전트가 그대로 붙는다.

```bash
cd AI_SDLC/demo
claude -p "네가 쓸 수 있는 sdlc-* 스킬 이름만 한 줄씩 출력해라." < /dev/null
```

10개(스킬 7 + 커맨드 3)가 나오면 정상이다. `NONE`이 나오면 `settings.json`의 `path`가 `..`(상대 경로)인지 확인한다 — 절대 경로로는 해석되지 않는다.
