# ai-native-sdlc

[AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)의 6단계와 3층 가드레일을
자기 저장소에 그대로 적용하는 Claude Code 플러그인. skills가 각 단계의 프롬프트를 굳히고, hooks가
결정론적으로 위반을 막는다.

## 설치

```
/plugin marketplace add <your-org>/<your-repo>
/plugin install ai-native-sdlc@<marketplace-name>
```

로컬에서 바로 시험해보려면 이 디렉터리를 마켓플레이스로 추가해도 된다:

```
/plugin marketplace add /path/to/AI_SDLC/plugin
/plugin install ai-native-sdlc
```

설치 후 저장소 루트에 `CLAUDE.md.template`을 `CLAUDE.md`로 복사하고 프로젝트에 맞게 채운다:

```
cp $CLAUDE_PLUGIN_ROOT/CLAUDE.md.template ./CLAUDE.md
```

## 6단계 흐름

```
 티켓(Linear/Jira/...)
        │
        ▼
 ┌────────────────┐   사람 검토 후 커밋
 │ 01 Plan         │──────────────────▶ docs/intent/<id>.md
 │ skill: sdlc-intent
 └────────────────┘
        │
        ▼
 ┌────────────────┐   사람 검토 후 커밋
 │ 02 Design       │──────────────────▶ docs/spec/<id>.md
 │ skill: sdlc-spec
 └────────────────┘
        │
        ▼
 ┌────────────────┐   사람 검토 후 커밋       "무엇이 깨질 수 있는가" 심문 포함
 │ 03 Build 착수 전 │──────────────────▶ docs/plan/<id>.md
 │ skill: sdlc-plan
 └────────────────┘
        │
        ▼
 ┌────────────────┐   hooks가 편집마다 개입
 │ 03 Build (구현) │◀── guard-protected-paths / block-secrets / format-lint
 └────────────────┘
        │
        ▼
 ┌────────────────┐   lint/tests + 화면 있으면 e2e
 │ 04 Test         │──────────────────▶ agents: verifier, e2e-reviewer / skill: sdlc-e2e
 └────────────────┘
        │
        ▼
 ┌────────────────┐   Bugs/Security/Compliance 3패스, hooks가 최종 게이트
 │ 05 Deploy       │──────────────────▶ skill: sdlc-review, hooks/production-gate.sh
 └────────────────┘
        │
        ▼
 ┌────────────────┐   장애/회귀 감지 시 새 티켓 생성
 │ 06 Maintain     │──────────────────▶ 01 Plan로 회귀 (루프 닫힘)
 └────────────────┘
        │
        └──────────────────────────────────────────────▶ (다시 맨 위로)
```

`/sdlc-run <ticket-id>`가 01~05를 순서대로, 각 단계 사이 사람 승인을 기다리며 진행한다. 06은 이
플러그인의 실행 범위 밖이다 — 배포 후 모니터링/티켓 생성은 별도 러너(예: 저장소의 `runner/`)가
맡고, 그 러너가 만든 새 티켓이 다시 `/sdlc-run`을 트리거하는 것으로 루프가 닫힌다.

## skills

| skill | 산출물 | 하는 일 |
| --- | --- | --- |
| `sdlc-intent` | `docs/intent/<id>.md` | 티켓/로그/대화를 인터뷰해 문제·원하는 결과·영향 범위·제약·미해결 질문을 정리 |
| `sdlc-spec` | `docs/spec/<id>.md` | intent.md를 읽고 요구사항·설계를 작성, 조직 skills 적용, 정책 충돌은 인라인 표시 |
| `sdlc-plan` | `docs/plan/<id>.md` | spec.md를 읽고 변경 파일·작업 순서·위험·성공 기준을 작성, "무엇이 깨질 수 있는가" 심문 |
| `sdlc-review` | 리뷰 코멘트 | PR을 Bugs/Security/Compliance 3패스로 리뷰, Important/Nit 구분, nit 최대 5개 |
| `sdlc-e2e` | 스냅샷 텍스트 | ego-lite(`ego-browser`)로 화면을 열어 텍스트 스냅샷 검증. `cliLog`는 stderr라 `2>&1` 필수 |

## commands

- `/sdlc-run <ticket-id>` — 6단계를 순서대로 진행 (사람 승인 대기 포함)
- `/sdlc-status [ticket-id]` — 현재 단계와 세션 트랜스크립트(`~/.claude/projects/.../*.jsonl`) 경로 출력
- `/sdlc-visualize [session.jsonl]` — zoetrope로 파이프라인 세션을 시각화하는 방법 안내/실행

## agents

- `verifier` — plan.md의 성공 기준(lint/tests)이 실제로 통과하는지만 확인. 수정 권한 없음(Edit/Write 미부여)
- `e2e-reviewer` — ego-lite로 화면을 열어 요구사항과 대조. 수정 권한 없음

## hooks — 3층 가드레일 중 결정론적 계층

| 훅 | 이벤트 | 하는 일 | 차단 방식 |
| --- | --- | --- | --- |
| `guard-protected-paths.sh` | PreToolUse (Edit/Write/MultiEdit) | `.env*`, `infra/`, `.github/workflows/` 편집 차단 | exit 2 + stderr |
| `block-secrets.sh` | PreToolUse (Edit/Write/MultiEdit) | 편집 내용에 자격 증명처럼 보이는 문자열이 있으면 차단 | exit 2 + stderr |
| `production-gate.sh` | PreToolUse (Bash) | `RELEASE_APPROVED=1` 없이 프로덕션 배포 명령 실행 차단 | exit 2 + stderr |
| `format-lint.sh` | PostToolUse (Edit/Write/MultiEdit) | 편집된 파일을 확장자별로 자동 포맷, 린트 실패 시 이유를 되돌려 자기수정 유도 | exit 2 + stderr (린트 실패 시만) |

모든 훅은 stdin으로 들어온 JSON을 파싱하지 못하거나 예상 밖 입력이면 **조용히 exit 0으로 통과**한다.
설정 실수나 `jq`/`python3` 부재로 저장소의 모든 편집이 막히는 사고를 피하기 위함이다. 반대로 실제
위반을 발견하면 반드시 **exit code 2**로 차단하고 이유를 stderr로 출력한다 — Claude Code는 stderr를
읽고 그 사유를 받아 스스로 경로를 바꾼다. 이게 원문이 말하는 "hook은 위반을 거의 불가능하게 만든다"의
구현 방식이다.

## 티켓 소스를 Linear에서 Jira로 바꾸는 지점

이 플러그인 자체(`skills/`, `commands/`, `agents/`, `hooks/`)는 티켓 소스에 의존하지 않는다 — 스킬은
`docs/intent/<id>.md` 같은 파일과 티켓 텍스트만 다룰 뿐, Linear API를 직접 호출하지 않는다.
Linear ↔ Jira를 바꾸는 실제 지점은 **웹훅을 받아 티켓 이벤트를 파싱하는 러너(runner) 쪽의
`ticket-source` 어댑터**다:

```ts
interface TicketSource {
  verify(req: IncomingRequest): boolean;
  parse(req: IncomingRequest): Ticket | null;
  createTicket(t: NewTicket): Promise<string>; // 06 Maintain이 새 티켓을 만들 때 사용
  comment(id: string, body: string): Promise<void>;
}
```

`adapters/linear.ts`가 기본 구현이고, 같은 인터페이스를 구현한 `adapters/jira.ts`로 드롭인 교체하면
된다. 이 인터페이스와 어댑터 구현은 이 플러그인이 아니라 저장소의 `runner/`가 소유한다 — 플러그인은
그 러너가 `claude -p <ticket-id로 채운 프롬프트>`로 각 skill을 호출해줄 것을 기대할 뿐이다.

## e2e 준비 확인

```bash
printf 'cliLog("ok")\n' | ego-browser nodejs 2>&1
```

`ok`가 보이면 준비된 것이다. 자세한 내용은 `skills/sdlc-e2e/SKILL.md` 참고.

## zoetrope 시각화

zoetrope는 Claude Code 세션 `.jsonl` 전용 뷰어이며 임의 파이프라인 포맷을 먹지 않는다. 이 플러그인은
그래서 별도 시각화 포맷을 만들지 않고, 각 SDLC 단계를 실제 Claude Code 세션으로 실행해 부수적으로
남는 트랜스크립트를 그대로 zoetrope에 넘긴다. 사용법은 `/sdlc-visualize` 참고.
