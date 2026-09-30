# AI-SDLC Slack 봇: 팀별 셀프호스팅, 티켓 알림, 버튼 승인

날짜: 2026-10-01
대상: `AI_SDLC/runner/`
선행 설계: [`2026-09-07-sdlc-hitl-gates-design.md`](2026-09-07-sdlc-hitl-gates-design.md) (Linear 하위 이슈 = 승인 게이트)

## 1. 목표

누구나 자기 팀 Slack에서 이 파이프라인을 쓸 수 있게 한다.

- **Slack 사용자는 아무것도 설치하지 않는다.** 봇을 띄운 컴퓨터 한 대에만 Claude Code, `ai-native-sdlc` 플러그인, Linear API 키가 있으면 된다.
- **Linear에 티켓이 생기면 Slack 채널에 알림이 온다.** 알림에서 바로 파이프라인을 시작할 수 있다.
- **승인은 Slack 버튼으로 한다.** 누른 사람이 그 단계의 승인 역할인지 봇이 확인한다. 승인 기록은 지금처럼 Linear 게이트 카드에 남는다.
- **공개 URL이 필요 없다.** Slack Socket Mode와 Linear 폴링만 쓰므로 ngrok 같은 터널 없이 노트북에서도 돈다.

성공 기준: 새 팀이 README만 보고 (1) 매니페스트로 Slack 앱 생성 → (2) 토큰 두 개와 Linear 키 설정 → (3) `npm start` 만으로, Linear 티켓 생성 알림을 받고 Slack 버튼으로 6단계를 끝까지 승인할 수 있다.

### 하지 않는 것

- **중앙 호스팅 SaaS.** 봇 하나를 여러 워크스페이스가 설치하는 구조는 만들지 않는다. 모든 워크스페이스의 요청이 한 서버로 모이면 Claude 비용·인증(개인 구독이 아닌 API 키 필요), 남의 저장소 코드 실행, 워크스페이스별 Linear/GitHub 권한 격리를 떠안아야 한다. 대신 **매니페스트를 배포하고 각 팀이 자기 봇을 만든다.**
- Slack 앱 디렉터리 등록, OAuth 설치 흐름 — 워크스페이스 내부 앱은 필요 없다.
- 여러 채널, 여러 저장소 — 봇 하나 = 채널 하나 = `repoPath` 하나.
- Claude Tag(공식 Claude in Slack) 연동 — 별개 제품이고, 역할별 승인을 강제할 수 없다.

## 2. 구조

```
Linear ──(폴링, 30s)──▶ LinearWatcher ──새 티켓──▶ SlackBot: 채널에 알림 [▶ 시작] [무시]
                                                        │
Slack /sdlc ──(Socket Mode)──▶ SlackBot ────────────────┤
                                                        ▼
                                                   runPipeline(ticket)  ← 기존 코드
                                                        │ PipelineEvents
                                                        ▼
                                  SlackBot: 티켓 스레드에 단계 진행·게이트 버튼
Slack [승인]/[반려] 버튼 ──▶ 역할 확인 ──▶ Linear 게이트 카드를 Done/Canceled 로 이동
                                                        │
                                   기존 awaitApproval 폴링이 Linear 상태 변화를 읽고 진행
```

핵심 결정: **승인의 진실 공급원은 계속 Linear 카드 상태다.** Slack 버튼은 카드를 옮기는 또 하나의 손일 뿐이다. 그래서 `gate.ts`의 판정 로직은 바뀌지 않고, Linear에서 직접 카드를 옮겨도 여전히 승인된다. 두 경로가 동시에 눌려도 먼저 옮겨진 상태 하나로 수렴한다.

## 3. 구성 요소

| 파일 | 역할 | 의존 |
| --- | --- | --- |
| `src/events.ts` | `PipelineEvents` 인터페이스와 no-op 구현. 파이프라인이 알림 대상을 모른 채 이벤트만 낸다 | 없음 |
| `src/pipeline.ts` (수정) | 기존 `writeLive`/`appendStateLog` 지점에서 이벤트 호출. `runPipeline`에 `events` 인자 추가(기본 no-op) | events |
| `src/linear-watcher.ts` | 팀의 새 이슈를 폴링하고 중복을 거른다 | `TicketSource.listRecentIssues` |
| `src/slack/app.ts` | Bolt(Socket Mode) 앱 생성, 명령·버튼·모달 핸들러 등록 | `@slack/bolt` |
| `src/slack/blocks.ts` | 알림·단계·게이트 메시지의 Block Kit JSON을 만드는 순수 함수 | 없음 |
| `src/slack/roles.ts` | 역할 → Slack 사용자 그룹 매핑으로 승인 권한 판정 | Slack `usergroups.users.list` |
| `src/slack/notifier.ts` | `PipelineEvents` 구현. 티켓 스레드에 메시지를 쓰고 갱신 | blocks, Slack Web API |
| `src/slack/threads.ts` | 티켓 키 → 스레드 `ts` 매핑을 `.state/<key>.slack.json`에 저장 | fs |
| `slack/manifest.yaml` | 팀이 붙여 넣을 Slack 앱 매니페스트 | — |
| `src/adapters/types.ts` (수정) | `setStateType`, `listRecentIssues` 추가 | — |

### 3.1 `PipelineEvents`

```ts
interface PipelineEvents {
  runStarted(meta: RunMeta): Promise<void>;
  stageStarted(key: string, stage: string): Promise<void>;
  stageFinished(key: string, stage: string, ok: boolean, note?: string): Promise<void>;
  gateWaiting(key: string, stage: StageId, role: string, gate: GateRef, summary: string): Promise<void>;
  gateResolved(key: string, stage: StageId, approved: boolean, by: string, reason?: string): Promise<void>;
  followupCreated(key: string, followup: { key: string; url: string }): Promise<void>;
  runFinished(key: string, outcome: "done" | "aborted"): Promise<void>;
}
```

이벤트 전송 실패는 파이프라인을 멈추지 않는다. 로그만 남긴다. Slack이 죽어도 Linear와 대시보드로 계속 승인할 수 있어야 한다.

### 3.2 어댑터 확장

```ts
/** 게이트 카드를 팀 워크플로의 해당 타입 상태(첫 번째)로 옮긴다. Slack 버튼이 쓴다. */
setStateType(issueId: string, type: "completed" | "canceled"): Promise<void>;
/** since 이후 생성된 최상위 이슈(부모 없음), 오래된 순. 알림 폴링이 쓴다. */
listRecentIssues(since: string): Promise<Array<Ticket & { createdAt: string }>>;
```

Linear 구현은 GraphQL `workflowStates(filter: { team, type })`로 상태 ID를 찾고 `issueUpdate`로 옮긴다. Jira 스텁에는 시그니처만 추가한다.

## 4. 흐름

### 4.1 티켓 생성 알림

1. `LinearWatcher`가 `linearPollIntervalMs`(기본 30초)마다 `listRecentIssues(cursor)`를 부른다.
2. 부모가 있는 이슈(= `[gate]` 하위 이슈)는 API 필터에서 이미 빠진다.
3. 커서와 이미 본 ID는 `.state/linear-watch.json`에 저장한다. **처음 시작할 때는 커서를 현재 시각으로 두어** 기존 백로그를 알리지 않는다.
4. 새 티켓마다 채널에 알림을 보낸다:

   > 🆕 **ENG-12** 할 일 제목이 비어도 저장됨 — 작성자 · `sdlc-auto` 라벨이면 `↺ ENG-9에서 생성`
   > [▶ 파이프라인 시작] [무시]

5. `startMode` 설정:
   - `"button"`(기본) — 사람이 [▶ 시작]을 눌러야 시작한다. 06이 만든 자동 티켓도 같다. 루프를 이어갈지 사람이 정한다.
   - `"auto"` — 알림과 동시에 시작한다. 버튼 대신 "자동 시작됨" 표시.
6. [▶ 시작]을 누르면 알림 메시지가 그 티켓의 **스레드 루트**가 된다. 버튼은 "▶ 시작함 (by @누구)"으로 바뀌어 두 번 눌리지 않는다.

기존 Linear webhook 경로(`POST /webhook/linear`)는 그대로 둔다. `linearTrigger: "poll" | "webhook"`(기본 `"poll"`, Slack이 켜졌을 때). `"webhook"`이면 지금처럼 동작하고 알림은 webhook 수신 시 보낸다.

### 4.2 `/sdlc` 명령

| 입력 | 동작 |
| --- | --- |
| `/sdlc <제목>` | Linear에 티켓을 만들고(본문은 제목, 필요하면 스레드에 추가 설명) 알림 메시지를 게시. 워처가 같은 티켓을 다시 알리지 않도록 본 ID에 기록 |
| `/sdlc run ENG-12` | 기존 티켓으로 파이프라인 시작 |
| `/sdlc status` | 진행 중인 실행 목록과 각 실행의 현재 단계·대기 역할 (ephemeral) |
| `/sdlc help` | 사용법 (ephemeral) |

### 4.3 단계 진행과 게이트

- 스레드에 단계마다 한 줄을 쓰고 끝나면 같은 메시지를 갱신한다: `⏳ 01 Plan 실행 중` → `✅ 01 Plan 완료 (4분)`.
- 게이트가 열리면 스레드에 게이트 메시지를 쓴다: 승인 역할 멘션(매핑된 사용자 그룹), 요약(러너가 Linear에 남기는 코멘트와 같은 내용), 산출물 경로, Linear 카드 링크, **[✅ 승인] [⛔ 반려]**.
- 채널에도 한 번 보인다(`reply_broadcast`)— 승인자가 스레드를 열지 않아도 알 수 있게.
- **[✅ 승인]**: 역할 확인 → 통과면 `setStateType(gate, "completed")` + Linear 코멘트 "Slack에서 @누구 승인" → 메시지를 "✅ @누구 승인"으로 갱신. 기존 폴링이 다음 주기에 진행한다.
- **[⛔ 반려]**: 사유 입력 모달을 연다 → 제출 시 역할 확인 → Linear에 사유 코멘트 + `setStateType(gate, "canceled")`. 기존 로직이 마지막 코멘트를 반려 사유로 읽는다.
- Linear에서 직접 카드를 옮겨도 `gateResolved` 이벤트로 Slack 메시지가 같이 갱신된다(`by: "Linear"`).
- 게이트 대기 시간 초과, 06 후속 티켓, 실행 종료도 스레드에 남긴다. 후속 티켓은 4.1의 알림 흐름을 그대로 탄다.

### 4.4 역할 확인

`sdlc.config.json`:

```json
"slack": {
  "channelId": "C0123456789",
  "startMode": "button",
  "roleGroups": {
    "Product Owner": "S0PRODUCT",
    "Engineer": "S0ENG",
    "Code Owner": "S0CODEOWN",
    "Release Manager": "S0RELEASE",
    "Service Owner": "S0SRE"
  }
}
```

- 역할에 사용자 그룹이 매핑돼 있으면 **그 그룹 멤버만** 승인·반려할 수 있다. 아니면 ephemeral로 "이 게이트는 @product-owners만 승인할 수 있다"고 알리고 아무것도 바꾸지 않는다.
- 매핑이 없는 역할은 채널의 누구나 누를 수 있다. 시작 시 로그에 "역할 X는 제한 없음"을 한 번 경고한다.
- 멤버 목록은 60초 캐시한다.
- [▶ 시작]과 `/sdlc`는 채널 멤버 누구나 쓸 수 있다(= 원문의 originator). 러너가 저장소에서 `claude -p`를 권한 우회 모드로 돌리므로, **봇이 들어간 채널 = 파이프라인을 시작할 수 있는 사람**이라는 점을 README에 명시한다.

## 5. 설정과 기동

환경변수 (Slack을 켤 때만 필요, 둘 중 하나라도 없으면 Slack 기능은 꺼지고 기존 동작 그대로):

| 변수 | 값 |
| --- | --- |
| `SLACK_BOT_TOKEN` | `xoxb-…` (Install to Workspace 후 발급) |
| `SLACK_APP_TOKEN` | `xapp-…` (`connections:write` 스코프, Socket Mode용) |

Slack이 켜지고 `linearTrigger`가 `"poll"`이면 `LINEAR_WEBHOOK_SECRET`은 필수가 아니다. `LINEAR_API_KEY`와 `linearTeamId`는 계속 필수.

매니페스트(`runner/slack/manifest.yaml`) 요지:

- `settings.socket_mode_enabled: true`, `interactivity.is_enabled: true`
- 슬래시 명령 `/sdlc`
- 봇 스코프: `chat:write`, `commands`, `usergroups:read`, `users:read`

기동 로그에 Slack 연결 상태, 채널, 역할 매핑, 폴링 주기를 한 번에 출력한다. 봇이 채널에 초대돼 있지 않으면(`not_in_channel`) 기동 시 바로 알려 준다.

## 6. 오류 처리

| 상황 | 동작 |
| --- | --- |
| Slack API 실패 (게시·갱신) | 로그만 남기고 파이프라인 진행. 재시도 없음 |
| Socket 연결 끊김 | Bolt 기본 재연결. 끊긴 동안의 버튼은 Slack이 실패를 표시하고, Linear로 계속 승인 가능 |
| Linear 폴링 실패 | 로그 후 다음 주기에 재시도. 커서는 성공했을 때만 전진 |
| `setStateType` 실패 | 누른 사람에게 ephemeral로 실패 알림, 메시지는 그대로 (다시 누를 수 있음) |
| 이미 처리된 게이트의 버튼 | 현재 Linear 상태를 읽어 "이미 승인됨/반려됨"을 ephemeral로 알림 |
| 러너 재시작 뒤 이전 스레드의 버튼 | 게이트 맵과 스레드 매핑은 `.state/`에 있으므로 카드는 옮겨진다. 다만 진행 중이던 `runPipeline`은 재시작과 함께 사라졌으므로 "이 실행은 러너 재시작으로 중단됨, `/sdlc run <키>`로 다시 시작"을 알린다 |

## 7. 테스트

모두 Slack·Linear 실제 호출 없이 돈다.

- `blocks.test.ts` — 알림·게이트·단계 메시지 JSON 스냅샷 (버튼 `action_id`, `value`에 키·단계가 들어가는지)
- `roles.test.ts` — 그룹 매핑 있음/없음, 멤버/비멤버, 캐시 만료
- `linear-watcher.test.ts` — 첫 기동 시 백로그 무시, 커서 전진, 중복 제거, 실패 시 커서 유지
- `slack-actions.test.ts` — 가짜 `TicketSource`와 가짜 Slack 클라이언트로 승인/반려/권한 없음/이미 처리됨 경로가 올바른 `setStateType`·코멘트·메시지 갱신을 부르는지
- `pipeline` — 기존 테스트 유지 + 가짜 `PipelineEvents`가 기대 순서로 불리는지
- 수동 확인 절차(README에 기록): 실제 워크스페이스에 앱 생성 → 티켓 생성 알림 → 시작 → 게이트 승인 한 번 → 반려 한 번.

## 8. 문서

- `AI_SDLC/README.md`에 "3-C. Slack으로 쓰기" 절: 매니페스트로 앱 만들기 → 토큰 → 채널 초대 → 사용자 그룹 ID 찾기 → `npm start` → 사용법 표.
- `runner/README.md`에 설정·이벤트 구조.
- `USAGE.md`에서 삭제된 `slides/` 관련 1장을 제거하고 Slack 절 추가.
