import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function App() {
  const [todos, setTodos] = useState([])
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    fetch(`${API_URL}/todos`)
      .then((res) => res.json())
      .then(setTodos)
      .catch(() => setError('목록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const addTodo = async (e) => {
    e.preventDefault()
    const trimmed = title.trim()
    // Client-side guard only — the API itself may not enforce this.
    // See backend README note on the seeded validation bug.
    if (!trimmed) return

    const res = await fetch(`${API_URL}/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    })
    if (!res.ok) {
      setError('추가에 실패했습니다.')
      return
    }
    setTitle('')
    setError('')
    load()
  }

  const removeTodo = async (id) => {
    await fetch(`${API_URL}/todos/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <main className="shell">
      <header className="masthead">
        <h1>할 일</h1>
        {!loading && <span className="count">{todos.length}개</span>}
      </header>

      <form className="composer" onSubmit={addTodo}>
        <label htmlFor="todo-title">새 할 일</label>
        <div className="row">
          <input
            id="todo-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 발표 자료 검토"
            autoComplete="off"
          />
          <button className="primary" type="submit" disabled={!title.trim()}>
            추가
          </button>
        </div>
      </form>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="skeleton" aria-hidden="true">
          <div />
          <div />
          <div />
        </div>
      ) : todos.length === 0 ? (
        <div className="empty">
          <p>아직 할 일이 없습니다.</p>
          <p>위 입력창에 첫 번째 항목을 추가해 보세요.</p>
        </div>
      ) : (
        <ul className="list">
          {todos.map((todo) => (
            <li key={todo.id}>
              <span>{todo.title || '(empty)'}</span>
              <button
                className="remove"
                type="button"
                onClick={() => removeTodo(todo.id)}
                aria-label={`${todo.title || '(empty)'} 삭제`}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
