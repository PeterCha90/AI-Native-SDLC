---
name: sdlc-e2e
description: AI-native SDLC 04 단계에서 ego-lite(ego-browser)로 실제 화면을 열어 e2e 검증할 때 사용한다. "화면에서 확인해줘", "e2e 리뷰해줘", "로컬 서버 띄운 거 브라우저로 확인해줘" 같은 요청에서 호출한다. 단위/통합 테스트가 잡지 못하는, 실제로 렌더된 화면 기준의 회귀를 잡는 게 목적이다.
---

# sdlc-e2e

AI-native SDLC의 4단계(Test)에서 "구현 전반에 지속 평가가 엮여 있다"는 원칙을 e2e 레벨에서 구현한다.
기본 도구는 **ego-lite(`ego-browser`)**다. Aside CLI는 대체 경로로만 문서에 남긴다 —
`aside repl`은 TTY를 요구해 헤드리스 파이프라인(훅, `claude -p`, CI 유사 실행)에서 쓸 수 없다.

## 준비 확인

실제 검증 전에 ego-browser가 응답하는지 먼저 확인한다:

```bash
printf 'cliLog("ok")\n' | ego-browser nodejs 2>&1
```

`ok`가 stderr 병합 출력으로 보이면 준비된 것이다. 실패하면 ego-browser 설치/PATH부터 해결하고,
그래도 안 되면 Aside(`aside repl`)로 대체하되 TTY가 필요하다는 제약을 사용자에게 알린다.

## 호출 형태

로컬로 뜬 화면(예: `http://localhost:5173`)을 열어 텍스트 스냅샷을 찍는 정확한 형태:

```bash
ego-browser nodejs <<'EOF'
const task = await useOrCreateTaskSpace('e2e review')
await openOrReuseTab('http://localhost:5173', { wait: true, timeout: 20 })
cliLog(await snapshotText())
EOF
```

**중요: `cliLog`는 stdout이 아니라 stderr로 출력한다.** 이 스크립트를 다른 도구(훅, 파이프라인 러너)에서
호출할 때는 반드시 `2>&1`로 stderr를 stdout에 병합해야 출력이 캡처된다. 예:

```bash
ego-browser nodejs <<'EOF' 2>&1
...
EOF
```

`2>&1`을 빠뜨리면 명령은 정상 종료하지만 `snapshotText()` 결과가 전혀 보이지 않는다 — "빈 출력"을
"e2e 통과"로 오인하지 않도록 주의한다.

## 절차

1. 준비 확인(`printf 'cliLog("ok")\n' | ego-browser nodejs 2>&1`)으로 ego-browser가 살아있는지 본다.
2. 대상 화면의 로컬 서버가 떠 있는지 확인한다(없으면 먼저 띄운다).
3. `openOrReuseTab`으로 대상 URL을 연다. `wait: true`와 적절한 `timeout`(초 단위)을 준다.
4. `snapshotText()`(또는 필요하면 스크린샷 API)로 렌더 결과를 캡처하고 `cliLog`로 출력한다.
5. plan.md의 성공 기준, spec.md의 요구사항과 스냅샷 내용을 대조한다.
6. 불일치가 있으면 재현 경로와 함께 보고한다. 이 스킬은 코드를 고치지 않는다 — 발견만 한다.

## 대체 경로: Aside

- `aside repl`은 대화형 TTY 세션이라 헤드리스 자동화(훅, `claude -p`, 이 플러그인의 파이프라인)에는
  기본적으로 맞지 않는다. 사람이 직접 터미널에서 탐색적으로 확인할 때만 대체 수단으로 쓴다.
- 파이프라인 자동화 경로는 항상 ego-lite를 기본값으로 삼는다.

## 하지 말 것

- `2>&1` 없이 실행한 뒤 "출력이 없으니 문제 없다"고 결론 내지 않는다.
- 스냅샷을 확인하지 않고 "화면이 열렸으니 통과"라고 보고하지 않는다.
