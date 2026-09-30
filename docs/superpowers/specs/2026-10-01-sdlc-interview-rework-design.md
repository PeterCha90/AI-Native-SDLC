# 01 Plan 인터뷰 루프와 반려 후 재작업

날짜: 2026-10-01
대상: `AI_SDLC/runner/`, `AI_SDLC/plugin/skills/sdlc-intent/`
선행 설계: [`2026-10-01-sdlc-slack-bot-design.md`](2026-10-01-sdlc-slack-bot-design.md) (Slack 봇, 스레드, 버튼 승인)

## 1. 문제

- **01 Plan이 인터뷰를 하지 않는다.** 원문 플레이북에서 01은 요청자를 인터뷰해 intent.md를 완성하는 단계다. 러너의 `claude -p`는 되물을 사람이 없어서 모르는 것을 "미해결 질문"에 남긴 채 끝나고, 그대로 Product Owner 게이트로 넘어간다.
- **반려하면 파이프라인이 끝난다.** 반려 사유를 반영해 다시 쓰는 경로가 없어서 `/sdlc run`으로 처음부터 다시 돌려야 한다.

## 2. 목표

- 01 초안이 나오면 봇이 스레드에서 **요청자에게 미해결 질문을 묻고**, 스레드 답글을 받아 **같은 Claude 세션을 이어서** intent.md를 고친다. 질문이 없어질 때까지 반복한다(최대 5회).
- 01·02·03(계획) 게이트에서 반려하면 **사유를 반영해 그 단계를 다시 실행**하고 다시 승인을 받는다(게이트당 최대 3회).

성공 기준: Slack에서 티켓을 시작하면 → 스레드에 질문이 오고 → 답글 두어 개 후 [답변 반영] → 질문이 줄어든 intent.md와 함께 새 질문이 오거나 PO 게이트가 열린다. PO가 사유와 함께 반려하면 → 01이 사유를 반영해 다시 돌고 → 게이트 메시지가 다시 온다.

### 하지 않는 것

- 04 Test, 05 Deploy, 06 Maintain 반려 후 재작업 — 코드와 릴리스 단계의 반려는 지금처럼 파이프라인을 멈춘다. 코드를 다시 짜야 하는 반려는 새 티켓이 맞다.
- 02·03 단계의 인터뷰 — 02·03의 미해결 사항은 게이트 반려 사유로 전달한다.
- 봇과의 자유 대화 — 봇은 인터뷰 질문의 답만 받는다. 다른 스레드 메시지는 무시한다.

## 3. 01 인터뷰 루프

```
01 초안   claude -p (session S) → docs/intent/<key>.md
          러너가 "## 미해결 질문" 절의 목록을 읽는다 (결정론적 파싱, 모델 없음)
질문 없음 → PO 게이트
질문 있음 → InterviewChannel.ask(questions, round)
             Slack: 🙋 @요청자 질문 N개 (round/5)  [답변 반영] [이대로 진행]
             요청자·스레드 참여자가 답글을 단다 → 봇이 모은다
             [답변 반영] → 모은 답을 Linear 원 티켓에 코멘트로 남기고
                           claude -p --resume S "다음 답을 반영해 intent.md를 고쳐라: …" → 다시 파싱
             [이대로 진행] → 남은 질문은 미해결로 둔 채 PO 게이트
             5회 도달 → 이대로 진행과 같다
```

### 3.1 질문 파싱

`sdlc-intent` 스킬의 산출물 형식을 고정한다: `## 미해결 질문` 절 아래 **번호 목록** 한 줄에 질문 하나. 질문이 없으면 절에 `없음` 한 줄. 러너는 이 절만 읽는다(`parseOpenQuestions(markdown): string[]`). 절이 없거나 형식이 다르면 질문 없음으로 본다 — 인터뷰를 건너뛰는 쪽으로 실패한다(파이프라인은 멈추지 않고 PO가 게이트에서 판단한다).

### 3.2 세션 이어 가기

`runStage`에 `resumeSessionId?: string` 옵션을 추가해 `--resume <id>`로 실행한다. 01 첫 실행의 세션 ID를 기억해 인터뷰 반영과 반려 재작업 모두 같은 세션을 잇는다. 이어 가기가 실패하면(세션 파일 없음 등) 새 세션으로 intent.md 전체와 답을 넣어 다시 실행한다.

### 3.3 `InterviewChannel`

```ts
interface InterviewAnswer { user: string; text: string }
type InterviewOutcome =
  | { kind: "answers"; answers: InterviewAnswer[] }   // [답변 반영]
  | { kind: "proceed" }                                // [이대로 진행] 또는 답 없이 반영
  | { kind: "timeout" };                               // gateTimeoutMs 동안 아무 동작 없음 → 진행
interface InterviewChannel {
  ask(key: string, questions: string[], round: number, maxRounds: number): Promise<InterviewOutcome>;
}
```

`runPipeline`에 인자로 넘긴다. 기본값은 `noInterview`(즉시 `proceed`) — Slack이 꺼져 있거나 웹훅 모드면 지금과 같이 인터뷰 없이 게이트로 간다.

### 3.4 Slack 구현

- 질문 메시지: 요청자 멘션 + 번호 목록 + 버튼 두 개. 답을 모으는 동안 메시지 아래에 "답변 N개 받음"을 갱신한다.
- 요청자 찾기: Linear 이슈 작성자 이메일(`creatorEmail`, 어댑터가 함께 가져온다) → `users.lookupByEmail`. 못 찾으면 멘션 없이 "스레드에서 누구나 답할 수 있다".
- 답 모으기: Socket Mode 메시지 이벤트(`message.channels`, 비공개 채널이면 `message.groups`) 중 **인터뷰가 열린 스레드**의 답글만, 봇 메시지·수정·삭제 이벤트는 제외. `.state/<key>.interview.json`에 `{ round, questions, messageTs, answers: [{ user, text, ts }] }`로 저장한다.
- [답변 반영]과 [이대로 진행]은 스레드 참여자 누구나 누를 수 있다(인터뷰는 승인이 아니다).
- 반영 뒤 질문 메시지는 "✅ 답변 N개 반영 (by @누구)"로 바뀐다.

### 3.5 매니페스트·권한 변경

봇 스코프 추가: `channels:history`, `groups:history`, `users:read.email`. 이벤트 구독 추가: `message.channels`, `message.groups`. 기존 사용자는 매니페스트를 다시 붙여 넣고 앱을 재설치해야 한다 — README에 한 줄로 안내한다.

## 4. 반려 후 재작업 (01·02·03 게이트)

```
게이트 반려 (Slack 모달 사유 또는 Linear Canceled + 코멘트)
  재작업 횟수 < 3 → claude -p --resume <그 단계 세션> "반려 사유: …  반영해 <산출물>을 고쳐라"
                   → 게이트 카드를 unstarted로 되돌리고 "재작업 N/3" 코멘트 → 다시 게이트 대기
                   (01이면 재작업 후 인터뷰 루프도 다시 탄다)
  3회 도달       → 지금처럼 파이프라인 중단
```

- 어댑터 `setStateType`의 대상 타입에 `"unstarted"`를 더한다.
- 이벤트: `gateResolved(…, approved=false, reason)` 뒤 `stageReworking(key, stage, attempt, maxAttempts)`를 새로 낸다. Slack은 게이트 메시지를 "⛔ 반려 → 재작업 1/3"로 바꾸고 새 게이트 메시지를 스레드에 쓴다.
- 04·05·06 게이트 반려는 지금처럼 중단한다.

## 5. 설정

```json
"interviewMaxRounds": 5,
"reworkMaxAttempts": 3
```

## 6. 오류 처리

| 상황 | 동작 |
| --- | --- |
| 이어 가기 실패 | 새 세션으로 산출물 전문 + 답/사유를 넣어 재실행 |
| 인터뷰 대기 중 러너 재시작 | 인터뷰 상태는 남지만 실행은 사라진다. 버튼을 누르면 "러너 재시작으로 중단, `/sdlc run <키>`" 안내(게이트 버튼과 같은 처리) |
| 답글 수집 이벤트가 안 옴(권한·구독 누락) | 기동 시 스코프를 확인해 누락이면 경고. 버튼은 여전히 동작하므로 [이대로 진행]으로 빠질 수 있다 |
| Linear 코멘트 실패 | 로그만, 인터뷰는 계속 |
| 재작업 실행 실패 | 게이트 메시지에 경고를 달고 다시 게이트를 연다 (지금의 `artifactWarning`과 같음) |

## 7. 테스트

- `parseOpenQuestions`: 번호 목록, `없음`, 절 없음, 다른 절이 뒤따르는 경우.
- 파이프라인(가짜 러너·채널): 질문 2개 → answers → 재실행 시 `resumeSessionId`가 첫 세션, 두 번째 파싱에서 질문 0개 → PO 게이트. 5회 상한. `proceed`면 재실행 없음. 01 반려 → 재작업 → `setStateType(gate, "unstarted")` → 다시 대기 → 승인. 3회 반려 → 중단. 04 반려 → 즉시 중단.
- Slack 인터뷰 채널(가짜 client): 스레드 밖 메시지·봇 메시지 무시, 답 누적, [답변 반영]이 `answers`로 resolve, 요청자 이메일 조회 실패 시 멘션 없는 문구.
- 어댑터: `setStateType("…","unstarted")`, `creatorEmail` 매핑.
