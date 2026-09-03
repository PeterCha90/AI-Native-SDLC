---
description: zoetrope로 현재 SDLC 파이프라인 세션을 시각화하는 방법을 안내하고 실행한다.
argument-hint: [session.jsonl]
---

**먼저 알아야 할 제약**: zoetrope는 Claude Code 세션 트랜스크립트(`.jsonl`) 전용 뷰어다. 자체 설정 DSL이나
임의 파이프라인 포맷을 그리는 기능은 없다. 이 플러그인은 별도의 시각화 데이터 포맷을 만들지 않는다 —
각 SDLC 단계가 `claude -p` 세션(또는 대화형 세션)으로 실행되면서 부수적으로 남기는 트랜스크립트를
zoetrope가 그대로 읽는다.

## 절차

1. 대상 세션 파일을 정한다.
   - 인자로 경로(`$1`)가 주어지면 그것을 쓴다.
   - 없으면 가장 최근 세션을 찾는다: `ls -t ~/.claude/projects/*/*.jsonl | head -1`
2. CLI가 설치되어 있으면 실시간으로 연다:
   ```bash
   zoe <file.jsonl> --follow
   ```
   현재 프로젝트의 라이브 세션을 그냥 따라가려면 인자 없이 `zoe`만 실행해도 된다.
3. CLI가 없거나 브라우저로 보고 싶으면: https://zoetrope.furkankly.dev/app 을 열고 대상 `.jsonl` 파일을
   페이지에 드래그앤드롭한다. (WASM 기반, 설치 불필요)
4. 헤드리스로 트리 구조만 텍스트로 확인하고 싶으면: `zoe inspect <file.jsonl>`
5. 설치가 안 되어 있다면 안내한다: `brew install furkankly/tap/zoetrope` 또는 `cargo install zoetrope`

## 하지 말 것

- 이 플러그인이 만드는 `docs/intent/`, `docs/spec/`, `docs/plan/` 같은 문서나 별도 로그 포맷을
  zoetrope에 직접 먹이려 하지 않는다. zoetrope가 그리는 건 오직 Claude Code 세션 `.jsonl`뿐이다.
  파이프라인 흐름을 보고 싶으면 각 단계를 실제 Claude Code 세션으로 실행해 트랜스크립트가 남게 하고,
  그 트랜스크립트를 zoetrope로 연다.
