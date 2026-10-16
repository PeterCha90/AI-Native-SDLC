# JEV 메일 분석기

TypeSafe AI의 **JEV** System One 모델로 Gmail 받은편지함을 실시간 분류하는 데모 사이트입니다.

메일을 한 통씩 JEV에 보내고, 돌아오는 결과를 스트리밍으로 받아 프로그레스바와 파이차트를
채워 나갑니다. 분류 기준(Choice 옵션)은 우측 Settings 패널에서 즉시 바꿀 수 있고,
스팸으로 분류된 메일은 **Noul** 질문으로 "몇 % 확률로 스팸인지" 다시 측정합니다.

## 무엇을 보여주는 데모인가

| 화면 요소 | 대응하는 TypeSafe 개념 |
|---|---|
| 실시간 메일 스트림 | 실제 받은편지함 내용 — JEV에 보낸 state를 행마다 펼쳐서 확인 |
| 카테고리 파이차트 | `Choice` — 정해진 선택지 중 하나 + 선택지별 확률 + confidence |
| 우측 Settings 패널 | `Choice`의 `criteria` 를 런타임에 편집 (재학습 없음) |
| "검토 필요" 표시 | Confidence-gated routing — 낮은 confidence는 사람에게 |
| 2차 스팸 확률 분석 | `Noul` — 예/아니오를 0~1 확률로 (한 요청에 3문항 fan-out) |
| 실시간 비용 패널 | `usage.input_tokens` × 단가 |
| 소요 시간 / 처리 속도 | 메일 읽기 시간과 분류 시간을 분리해 측정 |

## 실행

```bash
npm install
npm run dev
# http://localhost:4321
```

Node.js 20 이상이 필요합니다 (`@typesafe-ai/sdk` 요구사항).

## 환경 변수

`.env` 파일:

```bash
TYPESAFE_AI_API_KEY=sk-...        # 필수. https://console.typesafe.ai/keys
# TYPESAFE_MODEL=jev-latest       # 선택. 기본값 jev-latest

# Gmail (선택) — 없으면 샘플 데이터로 동작합니다
# GOOGLE_ACCOUNT_EMAIL=you@gmail.com
# GOOGLE_CREDENTIALS_PATH=/absolute/path/to/credentials/you@gmail.com.json
```

### Gmail 연결

이 데모는 자체 OAuth 앱을 등록하지 않고, 이미 이 컴퓨터에 저장된 Google OAuth 자격증명
파일(`token` / `refresh_token` / `client_id` / `client_secret` 를 담은 JSON)을 **서버에서만**
읽습니다. 기본 경로는 `~/.config/workspace-mcp/credentials/<이메일>.json` 이며,
`gmail.readonly` 스코프만 사용합니다. 메일은 읽기만 하고 라벨 변경·삭제·발송은 하지 않습니다.

자격증명이 없거나 만료되면 앱은 실패하지 않고 **번들 샘플 메일 18건**으로 전환합니다.
이때 화면 상단에 `샘플 데이터` 배지가 표시됩니다.

## 비용

JEV는 **입력 토큰만** 과금하고 출력 토큰은 무료입니다.

- `jev-1.13` — **$42 / 10억 토큰** (= $0.042 / 100만 토큰)
- 메일 1건당 대략 400~600 입력 토큰 → **건당 약 $0.00003**
- 메일 30건 분석 ≈ **$0.0009** / **500건 분석 ≈ $0.015**

비용 패널이 `usage` 를 누적해 실시간으로 달러 금액을 계산합니다.
단가는 `src/lib/pricing.ts` 한 곳에만 있습니다.

## 실측 성능 (실제 받은편지함, 동시 요청 12개)

| 메일 수 | 총 소요 | 메일 읽기 | 분류 | 처리 속도 | 비용 |
|---|---|---|---|---|---|
| 500건 | 30.9초 | 17.4초 | **13.5초** | 36.9건/초 | $0.015 |

메일을 읽어오는 시간과 JEV가 분류하는 시간은 **따로 측정해서 따로 표시**합니다.
합쳐서 보여주면 분류가 실제보다 느린 것처럼 읽히기 때문입니다.
한 번에 최대 **500건**까지 분석할 수 있습니다 (설정에서 조절).

## 구조

```
src/
  lib/
    questions.ts   ← JEV에 보내는 질문과 임계값 전부. 리뷰는 여기만 보면 됩니다
    pricing.ts     ← 단가와 비용 계산
    defaults.ts    ← 기본 카테고리 7종과 팔레트
    types.ts       ← 서버/클라이언트 공용 타입 + SSE 이벤트
    typesafe.ts    ← TypeSafeClient 생성 (API 키는 서버에만)
    gmail.ts       ← OAuth 토큰 갱신 + 메일 조회 + 샘플 폴백
    pool.ts        ← 동시 실행 제한
    sse.ts / sseClient.ts
    useAnalysis.ts ← 두 번의 분석 패스와 누적 usage
    useElapsed.ts  ← 진행 중 경과 시간 타이머
    format.ts      ← 상대 시각·소요 시간·처리 속도 포맷
    emailState.ts  ← JEV에 보내는 state (SDK 비의존 — UI에서도 그대로 사용)
    useSettings.ts ← Choice 옵션 CRUD, localStorage 저장
    aggregate.ts   ← 결과 → 차트 슬라이스 집계
  app/
    api/mailbox    ← 메일함 연결 상태
    api/analyze    ← SSE: Choice 분류 패스
    api/spam       ← SSE: Noul 스팸 확률 패스
  components/      ← 메일 스트림, 차트, 프로그레스바, 비용 패널, 표, 설정 패널
```

질문 문구와 임계값은 의도적으로 `src/lib/questions.ts` 한 파일에 모았습니다.
TypeSafe 문서가 권하는 리뷰 방식입니다 — 사람이 실제로 읽어야 하는 건 질문과 상수뿐입니다.

## 동작 방식

1. `분석 시작` → 서버가 Gmail에서 메일 N건의 헤더와 미리보기를 읽습니다.
2. 각 메일을 `{ from, subject, received, preview }` 구조화 state로 JEV에 보냅니다.
   본문은 보내지 않습니다 — 제목과 미리보기만으로 충분하고 요청이 가벼워집니다.
3. 동시 요청 수만큼 병렬로 돌리고, 완료되는 즉시 SSE로 결과를 내려보냅니다.
   프로그레스바는 실제 완료 건수에 연동됩니다.
4. `스팸 확률 재분석` → `isSpam` 으로 표시된 카테고리에 들어간 메일만 골라
   한 요청에 3개의 Noul 질문(스팸/피싱/정상 마케팅)을 던지고 확률을 받습니다.

메일 스트림의 각 행을 클릭하면 그 메일에 대해 **JEV에 실제로 보낸 state JSON**과
**선택지별 확률 분포**를 그대로 볼 수 있습니다. 라이브 세션임을 증명하는 화면입니다.

한 메일이 실패해도 전체 실행은 계속되며, 해당 행에만 오류가 표시됩니다.

## 한계

- 읽기 전용입니다. Gmail의 라벨을 바꾸거나 메일을 옮기지 않습니다.
- 메일 본문은 분석에 쓰지 않습니다 (제목 + 스니펫만).
- 로컬 데모용입니다. 인증이 없으므로 공개 배포하지 마세요.
- Gmail 조회가 실패하면 조용히 샘플 데이터로 전환됩니다. 화면에는 `샘플 데이터`
  배지가, 서버 로그에는 `[gmail] ...` 경고가 남습니다.
