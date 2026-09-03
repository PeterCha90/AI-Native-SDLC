"""Baseline tests for the demo Todo API.

NOTE: there is deliberately no test here for empty-title rejection.
That gap is the point of the demo — the pipeline is expected to add it
after the e2e step catches the seeded bug (see README.md).
"""
from fastapi.testclient import TestClient

from app.main import app, todos

client = TestClient(app)


def setup_function():
    todos.clear()


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_list_starts_empty():
    res = client.get("/todos")
    assert res.status_code == 200
    assert res.json() == []


def test_create_and_list_todo():
    res = client.post("/todos", json={"title": "buy milk"})
    assert res.status_code == 201
    body = res.json()
    assert body["title"] == "buy milk"
    assert isinstance(body["id"], int)

    res = client.get("/todos")
    assert res.json() == [body]


def test_delete_todo():
    created = client.post("/todos", json={"title": "wash car"}).json()

    res = client.delete(f"/todos/{created['id']}")
    assert res.status_code == 204

    assert client.get("/todos").json() == []


def test_delete_missing_todo_returns_404():
    res = client.delete("/todos/999")
    assert res.status_code == 404
