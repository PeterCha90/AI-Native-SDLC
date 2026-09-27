<p align="center">
  <img src="https://img.shields.io/badge/AI--native-SDLC-blueviolet?style=for-the-badge" alt="AI-native SDLC" />
  <img src="https://img.shields.io/badge/version-0.1.0-blue?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-orange?style=for-the-badge" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=for-the-badge" alt="Node >= 22" />
</p>

<h1 align="center">🔁 AI-SDLC</h1>
<h3 align="center">Linear 티켓 하나가 6단계 개발 파이프라인이 되는 로컬 러너</h3>

- [The AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)을 실제로 돌아가게 만든 데모와 발표자료. 파이프라인 본체는 [`AI_SDLC/`](AI_SDLC/README.md)에 있다.

---

<p align="center">
  <img src="AI_SDLC/docs/assets/dashboard.png" alt="AI-SDLC 파이프라인 대시보드" width="100%" />
</p>

---

## 무엇이 들어 있나

| 경로 | 내용 |
| --- | --- |
| [`AI_SDLC/`](AI_SDLC/README.md) | Linear 티켓 → 6단계 `claude -p` 파이프라인 → 역할별 승인 게이트 → 자동 후속 티켓. 러너, Claude Code 플러그인, 데모 앱, 대시보드 |
| [`slides/`](slides/) | 개념 설명용 Remotion 애니메이션 발표자료 |
| [`USAGE.md`](USAGE.md) | 발표자료와 파이프라인 전체 사용 설명서 |
| [`docs/`](docs/) | 원문 정리와 설계 기록 |

두 부분은 독립적이다. 파이프라인은 [`AI_SDLC/README.md`](AI_SDLC/README.md)부터, 발표는 [`USAGE.md`](USAGE.md) 1장부터 보면 된다.

---

## 가장 빠른 확인

Linear나 API 키 없이 대시보드부터 띄워 볼 수 있다:

```bash
cd AI_SDLC/runner
npm install
npm run dashboard:demo
```

`http://localhost:3939/`을 연다. 실제로 돌리는 방법은 [`AI_SDLC/README.md`](AI_SDLC/README.md#실제로-돌리기)에 단계별로 있다.

---

<p align="center">
  Made by <a href="https://github.com/PeterCha90">Peter Cha</a>
</p>
