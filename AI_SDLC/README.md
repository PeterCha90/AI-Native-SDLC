# AI-SDLC

Linear 티켓 생성을 감지해 6단계 AI-native SDLC 파이프라인을 자동 실행하는 로컬 러너 + Claude Code 플러그인. 각 단계는 실제 `claude -p` 헤드리스 세션으로 돌아가고, 그 부수 효과로 남는 Claude Code 세션 트랜스크립트를 [zoetrope](https://zoetrope.furkankly.dev/)로 실시간 시각화한다.

## 왜 만들었나

원문 [The AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)의 문제 제기: "코드는 더 이상 병목이 아니다. 당신의 프로세스가 병목이다." Build 단계는 AI로 압축됐지만 Plan → Design → Test → Deploy → Maintain은 여전히 사람 속도로 남아 있고, 단계 사이 핸드오프에서 컨텍스트가 유실된다.

이 프로젝트는 그 6단계(원문 기준 Plan/Design/Build/Test/Deploy/Maintain, 이 저장소에서는 01 intent ~ 06 maintain)를 하나의 닫힌 루프로 자동화한다. Linear 티켓이 들어오면 intent.md가 만들어지고, spec과 코드가 쌓이고, e2e가 돌고, PR이 열리고, 실패하면 06 단계가 새 Linear 티켓을 만들어 루프가 다시 01로 돌아간다. 사람은 판단이 필요한 지점(승인 게이트, 리뷰)에만 개입한다.

Linear가 아닌 다른 티켓 소스(Jira 등)로 바꿀 수 있도록 트리거 부분은 어댑터 인터페이스로 분리했다. 자세한 원본 요구사항은 `AI_SDLC/docs/intent.md` 참고.

## 폴더 구조

```
AI_SDLC/
├── README.md              이 문서
├── docs/
│   ├── intent.md           원본 요구사항 (수정 금지)
│   ├── architecture.md     6단계 파이프라인, 아티팩트, 어댑터, 가드레일
│   ├── zoetrope.md          zoetrope 사용법과 제약
│   └── demo-scenario.md    시연 대본
├── plugin/                 Claude Code 플러그인 (CLAUDE.md / skills / hooks)
├── runner/                 로컬 러너 (Node 데몬), ticket-source 어댑터
└── demo/                   시연용 React+Vite / FastAPI 데모 프로젝트
```

`plugin/`, `runner/`, `demo/`는 별도 작업으로 구현 중이며 이 README 작성 시점 기준 구조와 인터페이스는 `docs/architecture.md`의 설계를 따른다.

## 빠른 시작 (설계 기준)

1. `runner/` 로컬 데몬을 기동해 Linear webhook을 수신한다.
2. Linear에서 티켓을 하나 만든다 → 러너가 01 intent 단계를 `claude -p`로 실행.
3. 다른 터미널에서 `zoe --follow`로 방금 생성된 세션 트랜스크립트를 실시간으로 연다.
4. 파이프라인이 02 spec → 03 build → 04 test → 05 deploy → 06 maintain 순서로 흐르는 것을 지켜본다.
5. 04 test에서 심어둔 버그가 걸리면 06 maintain이 Linear에 새 티켓을 만들어 루프가 닫힌다.

## 문서

- [`docs/architecture.md`](docs/architecture.md) — 파이프라인 전체 흐름, 아티팩트 표, ticket-source 어댑터, 3층 가드레일, 무한 루프 방지, 범위 밖
- [`docs/zoetrope.md`](docs/zoetrope.md) — zoetrope가 무엇이고 무엇이 아닌지, 설치, 실시간으로 보는 절차
- [`docs/demo-scenario.md`](docs/demo-scenario.md) — 시연 체크리스트, 시간대별 대본, 실패 대비, 예상 질문
- [`docs/intent.md`](docs/intent.md) — 원본 요구사항 (읽기 전용)

발표자료(Part 2, 원문 개념 설명 Remotion 애니메이션)는 이 프로젝트 루트가 아니라 `slides/`에 있다.
