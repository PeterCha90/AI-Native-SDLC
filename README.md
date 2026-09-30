<p align="center">
  <img src="https://img.shields.io/badge/AI--native-SDLC-blueviolet?style=for-the-badge" alt="AI-native SDLC" />
  <img src="https://img.shields.io/badge/version-0.4.0-blue?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-orange?style=for-the-badge" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=for-the-badge" alt="Node >= 22" />
</p>

<h1 align="center">🔁 AI-SDLC</h1>
<h3 align="center">내 저장소에 6단계 개발 파이프라인과 승인 게이트를 거는 Claude Code 플러그인</h3>

- [The AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)을 실제로 돌아가게 만든 플러그인과 러너. 본체는 [`AI_SDLC/`](AI_SDLC/README.md)에 있다.

---

```
🆕 ENG-12 로그인 폼이 빈 값을 저장함 — @minji
[▶ 파이프라인 시작]  [무시]

┗━ 🧵 ⏳ 03 Build 실행 중 → ✅ 완료 (12분)
     🔐 게이트: 04 Test 승인 대기 — @product-owners  [✅ 승인] [⛔ 반려]
```

러너가 Slack 채널에 올리는 알림·게이트 메시지의 예시다. 자세한 모양은 [`AI_SDLC/README.md`](AI_SDLC/README.md)에 있다.

---

## 무엇이 들어 있나

| 경로 | 내용 |
| --- | --- |
| [`AI_SDLC/`](AI_SDLC/README.md) | Claude Code 플러그인(6단계 스킬, hook, 승인 게이트)과 Linear로 자동 실행하는 러너, Slack 봇 |
| [`USAGE.md`](USAGE.md) | 파이프라인 전체 사용 설명서 |
| [`docs/`](docs/) | 원문 정리와 설계 기록 |

---

## 시작하기

플러그인을 설치하고, 내 저장소를 준비하고, 티켓 하나를 넘기면 된다:

```bash
claude plugin marketplace add PeterCha90/FastCampus
claude plugin install ai-native-sdlc@ai-sdlc
```

Claude Code를 다시 시작한 뒤 내 저장소에서:

```
/sdlc-init
/sdlc-run ENG-12
```

Linear·Slack으로 자동 실행하려면 러너도 두 줄이면 된다(클론 없이):

```bash
npx ai-sdlc-runner init
npx ai-sdlc-runner start
```

설치 범위, 업데이트, Linear·Slack으로 자동 실행하는 방법은 [`AI_SDLC/README.md`](AI_SDLC/README.md)에 순서대로 있다.

---

<p align="center">
  Made by <a href="https://github.com/PeterCha90">Peter Cha</a>
</p>
