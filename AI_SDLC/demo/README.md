# Demo Todo App

의도적으로 작은 시연용 앱. AI-native SDLC 파이프라인이 "e2e 실패 → Linear 티켓 생성 →
파이프라인 재실행 → 수정"까지 도는 것을 보여주기 위한 무대일 뿐, 앱 자체는 볼 게 없다.

스택: FastAPI (backend, :8000) + React/Vite (frontend, :5173). 화면은 하나 —
할 일 목록 + 추가 + 삭제.

## 실행

```bash
make install   # backend pip install + frontend npm install
make dev       # backend(:8000) + frontend(:5173) 동시 기동
make test      # backend pytest + frontend build — 성공/실패를 이 하나로 판단
make e2e       # ego-browser로 :5173 열어서 확인 (make dev 로 서버가 떠 있어야 함)
```

## 심어둔 버그

**빈 문자열 검증이 프런트에만 있고 API에는 없음.**

- `frontend/src/App.jsx`의 `addTodo`는 제출 전 `title.trim()`이 비어 있으면
  요청 자체를 보내지 않는다 — 정상적인 화면 사용으로는 절대 재현되지 않는다.
- `backend/app/main.py`의 `POST /todos`는 title이 빈 문자열이어도 그냥
  받아서 저장한다. `curl`이나 e2e처럼 API를 직접 두드리면 빈 항목이 생기고,
  화면에는 `(empty)`로 렌더링되어 목록이 깨진 것처럼 보인다.
- `backend/tests/test_todos.py`에는 이 케이스를 잡는 테스트가 **일부러 없다**.
  파이프라인이 e2e 실패 → 티켓 → 수정 흐름에서 이 테스트를 추가하는 것이
  시연 포인트다.

### 켜고 끄기

환경변수 하나로 제어한다.

```bash
# 버그 재현 (기본값, 아무것도 안 하면 이 상태)
unset DEMO_STRICT_VALIDATION

# 버그 수정 (검증 활성화 — 빈 title은 422로 거부됨)
export DEMO_STRICT_VALIDATION=1
make dev
```

시연 순서: 버그가 켜진 상태(기본값)로 `make e2e` 실행 → 실패 확인 →
파이프라인이 `backend/app/main.py`에 검증을 추가(또는
`DEMO_STRICT_VALIDATION=1`을 기본값으로)하고 회귀 테스트를 추가 →
`make test`, `make e2e` 재실행 → 통과. 다시 시연하려면 환경변수를
unset하고 서버를 재시작하면 원상복구.

## `make test`가 검사하는 것

- `backend`: `pytest` — CRUD 엔드포인트 기본 동작(빈 목록, 생성, 조회, 삭제,
  404). 빈 title 거부는 **의도적으로 없음**.
- `frontend`: `npm run build` — Vite 빌드 통과 여부. 이 데모는 TS를 쓰지
  않으므로 별도 타입체크/테스트 러너를 추가하지 않고 빌드 성공 여부를
  체크로 삼는다 (빌드가 구문/임포트 오류를 잡아준다).

## `make e2e`가 검사하는 것

`e2e/check.sh`가 하는 일:

1. API에 직접 빈 title로 `POST /todos` 호출 (프런트를 우회 — 버그 재현 경로).
2. `ego-browser`로 `http://localhost:5173`을 열어 렌더링된 텍스트를 확인.
3. API가 빈 항목을 받아줬고(`201`) 화면에 `(empty)`가 보이면 → 버그 재현
   성공, 스크립트는 **비정상 종료(exit 1)**. API가 거부했으면(`422`) →
   버그 없음, 통과(exit 0).
4. `ego-browser`가 설치돼 있지 않거나 서버가 안 떠 있으면 exit 2로
   구분해서 종료 (버그 발견과 환경 문제를 구분하기 위함).

`cliLog`는 stdout이 아니라 stderr로 출력되므로 스크립트 내부에서
`2>&1`로 병합한다.

## 파일 구조

```
demo/
├── Makefile
├── README.md
├── backend/
│   ├── requirements.txt
│   ├── pytest.ini
│   ├── app/main.py
│   └── tests/test_todos.py
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/{main.jsx,App.jsx,index.css}
└── e2e/check.sh
```
