import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";

const COUNT_WORD = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];
const FILTERS = [
  { id: "all", label: "전체" },
  { id: "active", label: "진행 중" },
  { id: "done", label: "완료" },
];

function today() {
  const d = new Date();
  const week = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()} ${week}요일`;
}

/** 서버가 준 에러를 사용자 말로 바꾼다. 4xx 는 입력 문제, 5xx 는 우리 쪽 문제다. */
function humanize(err) {
  if (err.status >= 500) return "서버와의 연결이 잠시 불안정해요";
  if (err.status === 404) return "이미 사라진 항목이에요. 목록을 새로 고칠게요";
  if (err.status === 409) return "이미 목록에 있는 할 일이에요";
  if (err.status === 400) return err.message.includes("비어") ? "할 일 내용을 입력해 주세요" : err.message;
  return "네트워크에 연결할 수 없어요";
}

export default function App() {
  const [todos, setTodos] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [title, setTitle] = useState("");
  const [inputError, setInputError] = useState("");
  const [filter, setFilter] = useState("all");
  const [leaving, setLeaving] = useState(() => new Set());
  const [toast, setToast] = useState(null);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef(null);

  const notify = useCallback((err, retry) => {
    setToast({ id: Date.now(), text: humanize(err), code: err.status ?? "offline", retry });
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setTodos(await api("GET", "/api/todos"));
    } catch (err) {
      setLoadError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function add(e) {
    e.preventDefault();
    setAdding(true);
    try {
      // 빈 제목도 서버로 보낸다. 검증은 서버 몫이고, 그 400 이 모니터가 보는 실제 지표가 된다.
      const todo = await api("POST", "/api/todos", { title });
      setTodos((ts) => [...ts, todo]);
      setTitle("");
      setInputError("");
    } catch (err) {
      if (err.status === 400 || err.status === 409) setInputError(humanize(err));
      else notify(err, () => inputRef.current?.form?.requestSubmit());
    } finally {
      setAdding(false);
      inputRef.current?.focus();
    }
  }

  async function toggle(todo) {
    setTodos((ts) => ts.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)));
    try {
      await api("PATCH", `/api/todos/${todo.id}`, { done: !todo.done });
    } catch (err) {
      setTodos((ts) => ts.map((t) => (t.id === todo.id ? todo : t)));
      notify(err, () => toggle(todo));
      if (err.status === 404) load();
    }
  }

  async function remove(todo) {
    try {
      await api("DELETE", `/api/todos/${todo.id}`);
      setLeaving((s) => new Set(s).add(todo.id));
      setTimeout(() => {
        setTodos((ts) => ts.filter((t) => t.id !== todo.id));
        setLeaving((s) => {
          const next = new Set(s);
          next.delete(todo.id);
          return next;
        });
      }, 420);
    } catch (err) {
      notify(err, () => remove(todo));
      if (err.status === 404) load();
    }
  }

  async function clearDone() {
    for (const t of todos.filter((t) => t.done)) await remove(t);
  }

  const list = todos ?? [];
  const left = list.filter((t) => !t.done).length;
  const doneCount = list.length - left;
  const progress = list.length ? doneCount / list.length : 0;
  const visible = useMemo(
    () => list.filter((t) => (filter === "all" ? true : filter === "done" ? t.done : !t.done)),
    [list, filter],
  );

  return (
    <div className="page">
      <div className="grain" aria-hidden />

      <section className="hero">
        <span className="eyebrow rise" style={{ "--d": "0ms" }}>
          Daybook <i>·</i> {today()}
        </span>
        <h1 className="rise" style={{ "--d": "80ms" }}>
          {todos === null ? (
            <>
              오늘의 기록을
              <br />
              펼치는 중
            </>
          ) : left === 0 ? (
            <>
              오늘 할 일을
              <br />
              <em>모두</em> 끝냈어요.
            </>
          ) : (
            <>
              남은 일,
              <br />
              <em>{COUNT_WORD[left] ?? left}</em> 가지.
            </>
          )}
        </h1>
        <div className="progress rise" style={{ "--d": "160ms" }}>
          <Ring value={progress} />
          <div>
            <div className="progress-num">
              {doneCount}
              <span> / {list.length}</span>
            </div>
            <div className="progress-label">완료한 일</div>
          </div>
        </div>
        <p className="quote rise" style={{ "--d": "240ms" }}>
          작은 일을 끝내는 습관이
          <br />큰 하루를 만든다.
        </p>
      </section>

      <section className="panel rise" style={{ "--d": "200ms" }}>
        <div className="bezel">
          <div className="core">
            <form className="composer" onSubmit={add}>
              <div className={`field ${inputError ? "invalid" : ""}`}>
                <input
                  ref={inputRef}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (inputError) setInputError("");
                  }}
                  placeholder="새로운 할 일을 적어보세요"
                  aria-invalid={!!inputError}
                  aria-describedby="composer-error"
                />
                <button type="submit" className="cta" disabled={adding}>
                  <span>추가</span>
                  <span className="cta-icon">
                    <Icon name="arrow" />
                  </span>
                </button>
              </div>
              <p id="composer-error" className={`field-error ${inputError ? "show" : ""}`} role="alert">
                {inputError || " "}
              </p>
            </form>

            <div className="toolbar">
              <div className="filters" role="tablist">
                {FILTERS.map((f) => (
                  <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>
                    {f.label}
                  </button>
                ))}
              </div>
              {doneCount > 0 && (
                <button className="link" onClick={clearDone}>
                  완료한 일 지우기
                </button>
              )}
            </div>

            {loadError ? (
              <div className="state">
                <Icon name="cloud" />
                <p>할 일을 불러오지 못했어요</p>
                <span>{humanize(loadError)}</span>
                <button className="ghost-pill" onClick={load}>
                  다시 시도
                </button>
              </div>
            ) : todos === null ? (
              <ul className="list">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="skeleton" style={{ "--d": `${i * 90}ms` }} />
                ))}
              </ul>
            ) : visible.length === 0 ? (
              <div className="state">
                <Icon name="leaf" />
                <p>{filter === "done" ? "아직 완료한 일이 없어요" : "비어 있는 하루예요"}</p>
                <span>{filter === "done" ? "하나씩 체크해 보세요" : "위에 첫 번째 할 일을 적어보세요"}</span>
              </div>
            ) : (
              <ul className="list">
                {visible.map((t, i) => (
                  <li key={t.id} className={`item ${t.done ? "done" : ""} ${leaving.has(t.id) ? "leaving" : ""}`} style={{ "--d": `${Math.min(i, 8) * 45}ms` }}>
                    <button className="check" onClick={() => toggle(t)} aria-label={t.done ? "완료 취소" : "완료"}>
                      <svg viewBox="0 0 24 24">
                        <path d="M6 12.5l4 4 8-9" />
                      </svg>
                    </button>
                    <span className="title">
                      <span className="title-text">{t.title}</span>
                    </span>
                    <button className="remove" onClick={() => remove(t)} aria-label="삭제">
                      <Icon name="close" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <div className={`toast ${toast ? "show" : ""}`} role="status">
        {toast && (
          <>
            <span className="toast-code">{toast.code}</span>
            <span>{toast.text}</span>
            {toast.retry && (
              <button
                onClick={() => {
                  const r = toast.retry;
                  setToast(null);
                  r();
                }}
              >
                다시 시도
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Ring({ value }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r={r} className="ring-track" />
      <circle cx="32" cy="32" r={r} className="ring-bar" strokeDasharray={c} strokeDashoffset={c * (1 - value)} />
    </svg>
  );
}

function Icon({ name }) {
  const paths = {
    arrow: <path d="M7 17L17 7M9 7h8v8" />,
    close: <path d="M7 7l10 10M17 7L7 17" />,
    cloud: <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18zM12 11v3M12 16.5v.01" />,
    leaf: <path d="M5 19c8 0 14-5 14-14-9 0-14 6-14 14zm0 0l7-7" />,
  };
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden>
      {paths[name]}
    </svg>
  );
}
