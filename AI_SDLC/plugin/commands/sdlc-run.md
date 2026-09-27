---
description: 티켓 키 하나로 AI-native SDLC 6단계를 단계마다 사람 승인을 받으며 진행한다.
argument-hint: <ticket-id>
---

티켓 `$1`에 대해 AI-native SDLC 6단계를 순서대로 진행하라. **각 단계마다 승인 주체가 다르다.** 승인 전에는
다음 단계로 넘어가지 않는다.

| 단계 | 승인자 | 무엇을 승인하는가 |
| --- | --- | --- |
| 01 Plan | Product Owner | intent.md가 티켓 의도를 맞게 담았는가 |
| 02 Design | Product Owner | 정책 충돌을 정리했고 진행해도 되는가 |
| 03 Build | Engineer | 이 계획대로 코드를 편집해도 되는가 |
| 04 Test | Code Owner | 기계적 증거를 보고 의도·리스크 관점에서 통과인가 |
| 05 Deploy | Release Manager | 릴리스를 승인하는가 |
| 06 Maintain | Service Owner | 감지 결과를 어떻게 트리아지하는가 |

러너(`AI_SDLC/runner`)가 파이프라인을 돌릴 때는 이 승인이 Linear 하위 이슈로 만들어지고, 카드를 Done으로
옮기는 것이 승인이다. 이 명령을 사람이 직접 쓸 때는 각 단계 끝에서 산출물 경로를 보여주고 대화로 승인을
받는다.

1. **01 Plan** — `sdlc-intent` 스킬로 티켓 `$1`을 인터뷰 절차대로 정리해 `docs/intent/$1.md`를 만든다.
   미해결 질문을 지어내 채우지 마라. 초안을 보여주고 승인을 기다린다.
2. **02 Design** — `sdlc-spec` 스킬로 `docs/intent/$1.md`를 읽어 `docs/spec/$1.md`를 만든다. 정책 충돌은
   해당 설계 항목 바로 아래 인라인으로 표시한다. 승인을 기다린다.
3. **03 Build (계획)** — `sdlc-plan` 스킬로 `docs/spec/$1.md`를 읽어 `docs/plan/$1.md`를 만든다.
   "무엇이 깨질 수 있는가" 심문을 반드시 포함한다. **여기서 코드를 건드리지 않는다.** 승인을 기다린다.
4. **03 Build (구현)** — 승인된 `docs/plan/$1.md`의 작업 목록을 순서대로 구현한다. 계획에 없는 파일은
   건드리지 마라 — `plan-drift.sh`가 커밋 시점에 대조해 차단한다. `guard-protected-paths.sh`,
   `block-secrets.sh`, `format-lint.sh`도 편집마다 개입한다.
5. **04 Test** — `sdlc-test` 스킬로 `docs/plan/$1.md`의 "성공 기준"을 실제로 실행하고 통과할 때까지
   피드백 루프를 돌린다. 버그 수정이면 실패하는 테스트로 먼저 재현하고 테스트가 아니라 코드를 고친다
   (`SDLC_BUGFIX=1`이면 `protect-tests.sh`가 테스트 편집을 막는다). 화면 변경이면 `sdlc-e2e` 스킬 또는
   `e2e-reviewer` 서브에이전트로 확인한다. 마지막에 `verifier` 서브에이전트로 독립 검증을 받는다.
   성공 기준을 안 돌리고 끝내려 하면 `verify-before-done.sh` Stop 훅이 막는다. 승인을 기다린다.
6. **05 Deploy** — `sdlc-review` 스킬로 Bugs/Security/Compliance 세 패스 리뷰를 하고 PR을 만든다.
   저장소 `REVIEW.md`의 정책(Important/Nit 기준, nit 5건 상한, 제외 항목)을 따른다. 리뷰 결과는 스스로
   승인하지도 차단하지도 않는다 — 코드 오너가 승인하고 `production-gate.sh`가 프로덕션을 막는다.
   승인을 기다린다.
7. **06 Maintain** — `ops/detect.sh`(모델 없는 결정론적 스크립트)로 지표를 판정한다. 1σ는 기록만, 2σ는
   read-only 진단, 3σ면 `sdlc-maintain` 스킬로 진단을 새 intent.md로 쓰고 Linear에 후속 티켓을 만든다.
   그 티켓이 다시 01을 트리거해 루프가 닫힌다.

각 단계 사이에 지금까지의 산출물 경로(`docs/intent/$1.md`, `docs/spec/$1.md`, `docs/plan/$1.md`)를 요약해
보여주고, 해당 승인자가 진행해도 좋다고 확인할 때까지 기다려라.
