import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function App() {
  const [todos, setTodos] = useState([])
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')

  const load = () => {
    fetch(`${API_URL}/todos`)
      .then((res) => res.json())
      .then(setTodos)
      .catch(() => setError('목록을 불러오지 못했습니다.'))
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
    <main>
      <h1>Demo Todo</h1>
      <form onSubmit={addTodo}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="할 일을 입력하세요"
        />
        <button type="submit">추가</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <span>{todo.title || '(empty)'}</span>
            <button onClick={() => removeTodo(todo.id)}>삭제</button>
          </li>
        ))}
      </ul>
    </main>
  )
}
