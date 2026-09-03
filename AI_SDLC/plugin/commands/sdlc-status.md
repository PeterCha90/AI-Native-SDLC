---
description: 현재 진행 중인 AI-SDLC 파이프라인 단계와 관련 세션 트랜스크립트 경로를 보여준다.
argument-hint: [ticket-id]
---

인자로 티켓 ID(`$1`)가 주어지면 그 티켓만, 없으면 `docs/intent/`, `docs/spec/`, `docs/plan/` 아래
가장 최근에 수정된 티켓을 대상으로 아래를 확인해 보고하라.

1. **단계 판정** — 어떤 산출물이 존재하고 커밋되어 있는지로 현재 단계를 판정한다.
   - `docs/intent/<id>.md`만 있음 → 01 Plan 완료, 02 Design 대기
   - `docs/spec/<id>.md`까지 있음 → 02 Design 완료, 03 Build 대기
   - `docs/plan/<id>.md`까지 있음 → 계획 완료, 구현 진행 중 또는 대기
   - 관련 브랜치/PR이 있으면 → 04 Test / 05 Deploy 단계로 판정
   - 각 산출물이 커밋되어 있는지(`git log --oneline -- <path>`)와 워킹트리에만 있는(미승인) 초안인지
     구분해서 보고한다.
2. **세션 트랜스크립트 경로** — 이 파이프라인이 `claude -p` 헤드리스 세션으로 돌고 있다면, 트랜스크립트는
   `~/.claude/projects/<project-slug>/<session-id>.jsonl`에 쌓인다. 프로젝트 슬러그는 현재 저장소 절대
   경로를 Claude Code 규칙대로 변환한 값이다. 가장 최근 파일을
   `ls -t ~/.claude/projects/*/*.jsonl | head -1` 로 찾아 경로를 그대로 출력한다. 파일이 없으면 "아직
   기록된 세션 없음"이라고 명시한다.
3. 위 두 가지(현재 단계, 트랜스크립트 경로)를 요약해 보여주고, `zoe --follow`로 실시간으로 보고 싶으면
   `/sdlc-visualize`를 쓰라고 안내한다.
