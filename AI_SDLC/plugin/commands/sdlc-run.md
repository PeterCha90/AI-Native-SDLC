---
description: 티켓 키 하나로 AI-native SDLC 6단계(intent → spec → plan → build → test → deploy)를 순서대로 진행한다.
argument-hint: <ticket-id>
---

티켓 `$1`에 대해 AI-native SDLC 6단계를 순서대로, 각 단계마다 사람 승인을 기다리며 진행하라.

1. **01 Plan (intent)** — `sdlc-intent` 스킬을 사용해 티켓 `$1`의 내용을 인터뷰 절차대로 정리하고
   `docs/intent/$1.md`를 만든다. 초안을 보여주고 사람 검토/커밋을 기다린다. 커밋되기 전에는 다음
   단계로 넘어가지 않는다.
2. **02 Design (spec)** — `sdlc-spec` 스킬로 `docs/intent/$1.md`를 읽어 `docs/spec/$1.md`를 만든다.
   정책 충돌은 인라인으로 표시한다. 사람 검토/커밋을 기다린다.
3. **03 Build 착수 전 (plan)** — `sdlc-plan` 스킬로 `docs/spec/$1.md`를 읽어 `docs/plan/$1.md`를 만든다.
   "무엇이 깨질 수 있는가" 심문을 반드시 포함한다. 사람 검토/커밋을 기다린다.
4. **03 Build (구현)** — 승인된 `docs/plan/$1.md`의 작업 목록을 순서대로 구현한다. 가능하면 plan mode로
   시작하고, 병렬로 진행할 수 있는 독립 작업이 있으면 서브에이전트/worktree 사용을 고려한다. 훅
   (`guard-protected-paths.sh`, `block-secrets.sh`, `format-lint.sh`)이 편집마다 자동으로 개입한다.
5. **04 Test** — 저장소의 lint/test 명령을 plan.md의 성공 기준대로 돌린다. 화면이 있는 변경이면
   `sdlc-e2e` 스킬로 ego-lite e2e 검증까지 수행한다. 필요하면 `verifier`/`e2e-reviewer` 서브에이전트에
   위임한다.
6. **05 Deploy** — PR을 만들고 `sdlc-review` 스킬로 Bugs/Security/Compliance 리뷰를 수행한다.
   Important 항목이 남아있으면 배포 게이트(`production-gate.sh`)가 어차피 사람 승인 없이는 막는다는
   점을 알리고 병합을 보류한다.

각 단계 사이에는 지금까지의 산출물 경로(`docs/intent/$1.md`, `docs/spec/$1.md`, `docs/plan/$1.md`)를
요약해 보여주고, 사람이 다음 단계로 진행해도 좋다고 확인할 때까지 기다려라. 06 Maintain은 이 명령의
범위 밖이다 — 배포 후 장애/회귀가 감지되면 새 티켓이 생성되고 그 티켓으로 이 명령이 다시 시작된다.
