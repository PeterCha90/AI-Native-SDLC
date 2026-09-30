---
description: 현재 저장소에 AI-native SDLC가 기대하는 파일(.claude/CLAUDE.md, REVIEW.md, ops/)을 템플릿으로 깔아 준다.
---

플러그인 템플릿 폴더: `${CLAUDE_PLUGIN_ROOT}/templates`

현재 저장소 루트에 아래 파일을 준비하라. **이미 있는 파일은 절대 덮어쓰지 마라** — 있으면 건너뛰고 "이미 있음"으로 보고한다.

| 템플릿 | 복사할 위치 |
| --- | --- |
| `templates/CLAUDE.md.template` | `./.claude/CLAUDE.md` |
| `templates/REVIEW.md` | `./REVIEW.md` |
| `templates/ops/bands.yaml` | `./ops/bands.yaml` |
| `templates/ops/detect.sh` | `./ops/detect.sh` (실행 권한 부여) |

SDLC용 `CLAUDE.md`는 루트가 아니라 `.claude/CLAUDE.md`에 둔다. 대부분의 저장소는 루트에 팀의 `CLAUDE.md`가 이미 있어서, 루트에 두면 "덮어쓰지 않는다" 규칙 때문에 SDLC 규칙이 아예 들어가지 못한다. Claude Code는 `./CLAUDE.md`와 `./.claude/CLAUDE.md`를 둘 다 프로젝트 메모리로 읽으므로 둘은 함께 동작한다. 루트 `CLAUDE.md`는 건드리지 않는다.

복사한 뒤:

1. `.claude/CLAUDE.md`의 `명령어` 섹션을 이 저장소에서 실제로 쓰는 설치·개발 서버·테스트·lint 명령으로 채운다. `package.json`, `Makefile`, `pyproject.toml` 등을 읽어서 찾고, 확신이 없는 칸은 `<확인 필요>`로 남긴다. 루트 `CLAUDE.md`에 이미 같은 명령이 적혀 있으면 그 값과 맞춘다. 테스트 명령이 가장 중요하다 — 02~03 단계가 plan.md의 "성공 기준"을 쓸 때 이 명령을 가져다 쓰고, `verify-before-done` 훅은 그 성공 기준이 실제로 실행됐는지 확인한다. (04 Test와 `config-eval` 훅은 `package.json`/`Makefile`/`pyproject.toml`에서 테스트 명령을 직접 찾는다.)
2. `ops/bands.yaml`은 예시 지표(`unit_test_failure_rate`, `e2e_failure_rate`)가 들어 있다고 알려 주고, 이 서비스에 맞게 지표·`baseline`·`sigma`를 바꿔야 한다고 안내한다. 직접 수정하지는 않는다.
3. 마지막에 만든 파일, 건너뛴 파일, 사람이 채워야 할 곳을 표로 보고하고, 커밋은 사람에게 맡긴다.
