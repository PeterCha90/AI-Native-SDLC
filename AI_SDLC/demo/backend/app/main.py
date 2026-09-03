"""Tiny Todo API — demo stage for the AI-native SDLC pipeline.

Intentional bug (see README.md "심어둔 버그"):
  POST /todos does not reject an empty/whitespace-only title unless
  DEMO_STRICT_VALIDATION=1 is set. The frontend already blocks empty
  submissions in the UI, so the bug only surfaces when something calls
  the API directly (e.g. an e2e test, or curl) — which is exactly how
  the demo's e2e step is meant to catch it.
"""
import os
from itertools import count

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Demo Todo API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_ids = count(1)
todos: list[dict] = []


class TodoCreate(BaseModel):
    title: str


def _strict_validation_enabled() -> bool:
    # ponytail: single env var toggle, no config file. Flip DEMO_STRICT_VALIDATION=1
    # to turn the seeded bug OFF (i.e. enable the validation the API is missing).
    return os.getenv("DEMO_STRICT_VALIDATION") == "1"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/todos")
def list_todos():
    return todos


@app.post("/todos", status_code=201)
def create_todo(todo: TodoCreate):
    title = todo.title
    if _strict_validation_enabled() and not title.strip():
        raise HTTPException(status_code=422, detail="title must not be empty")
    item = {"id": next(_ids), "title": title}
    todos.append(item)
    return item


@app.delete("/todos/{todo_id}", status_code=204)
def delete_todo(todo_id: int):
    global todos
    before = len(todos)
    todos = [t for t in todos if t["id"] != todo_id]
    if len(todos) == before:
        raise HTTPException(status_code=404, detail="todo not found")
    return None
