# zoetrope

## 1. 무엇이고, 무엇이 아닌지

[zoetrope](https://zoetrope.furkankly.dev/)는 **Claude Code 세션 JSONL 트랜스크립트 전용 뷰어**다. `~/.claude/projects/<project>/<session-id>.jsonl` 하나만 입력으로 받는다.

무엇이 아닌지가 더 중요하다.

- **자체 설정 DSL이 없다.** 파이프라인 구조, 단계 이름, 상태 전이 같은 걸 zoetrope에 알려줄 방법이 없다.
- **임의 포맷을 먹지 않는다.** 이 프로젝트의 파이프라인(01 intent ~ 06 maintain)을 아무 JSON이나 로그로 기록해서 zoetrope에 넘기는 건 불가능하다. 오직 Claude Code가 실제로 만든 세션 JSONL만 읽는다.

그래서 이 설계는 파이프라인의 각 단계를 **실제 `claude -p` 헤드리스 세션으로 실행**한다. zoetrope에 맞는 시각화 데이터를 따로 만드는 게 아니라, `claude -p`를 쓰면 Claude Code가 알아서 세션 트랜스크립트를 `~/.claude/projects/`에 남기고, zoetrope는 그걸 그대로 그린다. 시각화는 파이프라인 실행의 **부수 효과**로 공짜로 따라오는 것이지, 별도로 구현한 기능이 아니다. `architecture.md` §1의 다이어그램에서 각 단계 박스 아래에 붙는 JSONL 생성이 바로 이 지점이다.

## 2. 설치 (3가지)

- CLI: `brew install furkankly/tap/zoetrope` 또는 `cargo install zoetrope` → `zoe` 명령 사용
- 브라우저(설치 불필요): https://zoetrope.furkankly.dev/app — `.jsonl` 파일을 드래그앤드롭
- Rust 라이브러리 크레이트로도 배포된다 (직접 통합이 필요할 때)

npm 패키지는 없다. Node 생태계 도구로 착각하지 말 것.

## 3. 파이프라인을 실시간으로 보는 절차

1. `runner/` 로컬 데몬을 기동한다. Linear webhook을 수신 대기.
2. Linear에서 티켓을 하나 만든다(또는 06 maintain이 자동으로 만든다). runner가 webhook을 받아 01 intent 단계를 `claude -p`로 실행한다.
3. 이 순간 `~/.claude/projects/<project-slug>/<session-id>.jsonl`이 새로 생긴다. `<project-slug>`는 파이프라인을 실행 중인 프로젝트 경로 기준으로 Claude Code가 정하고, `<session-id>`는 세션마다 새로 발급된다 — 즉 01, 02, 03… 각 단계가 별도의 `claude -p` 호출이면 단계마다 새 JSONL 파일이 생긴다.
4. 가장 최근에 생긴 JSONL을 찾아 `zoe <file.jsonl> --follow`로 연다. 라이브 세션을 실시간으로 따라가려면(파일을 찾지 않고 현재 프로젝트를 바로 추적하려면) `zoe`(인자 없이) 또는 `zoe <dir>`(다른 프로젝트 디렉터리 지정)를 쓸 수도 있다.
5. 단계가 넘어갈 때마다(01→02→03…) 새 세션이 시작되므로, 계속 같은 파일을 follow하는 게 아니라 최신 JSONL로 갈아타야 할 수 있다. 시연에서는 이 전환을 미리 연습해둔다.

참고 명령:

```bash
zoe                          # 현재 프로젝트의 라이브 세션 추적
zoe <dir>                    # 다른 프로젝트 디렉터리의 세션 추적
zoe <file.jsonl>             # 기록을 처음부터 재생
zoe <file.jsonl> --follow    # 라이브 엣지에서 열기 (실시간 이어보기)
zoe <file.jsonl> --speed N   # 재생 속도 (기본 8.0)
zoe inspect <file.jsonl>     # 헤드리스로 세션 트리 출력 (터미널 텍스트, 파싱 확인용)
```

## 4. 시연 화면 배치 제안

터미널 두 개를 나란히 띄운다.

- **왼쪽**: runner 로그 (`runner/` 프로세스의 stdout). 어느 티켓을 받았는지, 몇 단계로 넘어갔는지 텍스트로 확인.
- **오른쪽**: `zoe --follow`. 같은 순간 세션 트리가 그려지는 걸 시각적으로 확인.

관객 입장에서 "왼쪽 로그에 뜬 게 오른쪽 그래프로 그대로 나타난다"는 대응이 보이면 설득력이 커진다. 브라우저 버전(https://zoetrope.furkankly.dev/app)은 네트워크가 불안하거나 CLI 설치가 안 된 상황에서의 대체 경로로 남겨둔다(`.jsonl` 파일을 직접 드래그앤드롭하면 되므로 설치 자체가 필요 없다).

## 5. 깨질 수 있다는 경고

Claude Code의 세션 JSONL 형식은 **문서화되지 않은 내부 형식**이다. zoetrope는 이걸 리버스 엔지니어링해서 만들었다. 즉:

- Claude Code가 업데이트되면서 JSONL 스키마가 바뀌면 zoetrope 렌더링이 깨지거나 일부가 비어 보일 수 있다.
- zoetrope는 알 수 없는 레코드 타입은 건너뛰고, 필드가 없으면 폴백값을 쓰는 식으로 방어하지만, 이건 "안 깨진다"는 보장이 아니라 "덜 깨진다"는 정도다.

시연 전이나 이상하게 보일 때 확인할 것: `zoe inspect <session>.jsonl`을 돌려서 세션 트리가 텍스트로 정상 출력되는지 본다. 여기서 트리가 뜨면 파싱 자체는 되는 것이고, 안 뜨거나 에러가 나면 Claude Code 버전과 zoetrope 버전 조합 문제일 가능성이 높다 — 이 경우 시연 직전이라면 미리 녹화해둔 화면으로 대체한다(`demo-scenario.md` §실패 대비 참조).
