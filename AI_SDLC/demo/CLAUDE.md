# CLAUDE.md

## 명령어
- 설치: `make install` (backend `pip install -r requirements.txt` + frontend `npm install`)
- 개발 서버: `make dev` (backend :8000 + frontend :5173 동시 기동, Ctrl+C로 둘 다 정지)
- 테스트: `make test` (backend `pytest -q` + frontend `npm run build`, 성공/실패를 이 하나로 판단)
- e2e: `make e2e` (`e2e/check.sh` 실행, 사전에 `make dev`로 두 서버가 떠 있어야 함)
- 별도 lint 명령 없음 — 이 데모는 TS를 쓰지 않고, `npm run build`(Vite)가 구문/임포트
  오류를 잡는 걸로 대신한다.

## 컨벤션
- 커밋/브랜치 네이밍에 별도 규칙 없음 — 이 저장소는 파이프라인이 worktree 안에서 생성하는
  코드 diff를 담는 시연용 앱이다. 유일한 기준은 아래 "작업 검증"이 통과하는지다.
- 백엔드 요청 바디는 pydantic 모델(`TodoCreate`)로 검증한다. 새 엔드포인트를 추가할 때도
  수동 dict 파싱 대신 이 패턴을 따른다.

## 아키텍처
- FastAPI(`backend/app/main.py`, :8000)와 React/Vite(`frontend/src/App.jsx`, :5173)가
  분리된 두 프로세스로 뜬다. 데이터는 인메모리 리스트(`todos`)뿐이라 백엔드 재시작 시
  전부 사라진다(DB 없음).
- 프런트는 `VITE_API_URL`(기본 `http://localhost:8000`)로 백엔드를 호출한다. 데모라
  CORS는 `allow_origins=["*"]`로 전부 열려 있다.
- 빈 title 처리 여부는 `DEMO_STRICT_VALIDATION` 환경변수로 토글되는 시연용 스위치다.

## 반복된 실수
- `e2e/check.sh`가 쓰는 `ego-browser`의 `cliLog()`는 stdout이 아니라 **stderr**로 출력한다.
  `2>&1`로 병합하지 않으면 스냅샷이 조용히 사라지고, 빈 출력을 "통과"로 오독하게 된다.
  두 번 겪고 나서야 스크립트에 `2>&1`을 박아 넣었다 — 이 스크립트나 비슷한 `ego-browser`
  호출을 새로 만들 때 다시 빠뜨리지 말 것.
- `DEMO_STRICT_VALIDATION`을 shell에서 `export`/`unset`해도 이미 떠 있는
  `uvicorn --reload` 프로세스에는 반영되지 않는다(자식 프로세스 환경은 기동 시점 스냅샷이라
  `--reload`가 코드 변경은 잡아도 환경변수 변경은 못 잡는다). 값을 바꿨으면 `make dev`를
  재시작해야 한다.

## 작업 검증
아래가 모두 통과해야 변경이 끝난 것이다.
- `cd backend && python -m pytest -q`
- `cd frontend && npm run build`
- `bash e2e/check.sh` (선행 조건: `make dev`로 backend/frontend가 떠 있어야 함)

## AI-native SDLC 참고
- 파이프라인 산출물: `docs/intent/`, `docs/spec/`, `docs/plan/` (티켓 ID로 파일명)
- 각 산출물은 사람이 검토·커밋해야 다음 단계로 넘어간다
- 프로덕션 배포는 `RELEASE_APPROVED=1` 없이는 `hooks/production-gate.sh`가 차단한다
