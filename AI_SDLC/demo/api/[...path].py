"""Vercel serverless entry point for the demo Todo API.

Deliberately thin: it adds no behaviour of its own, it only re-exposes the very
same `backend/app/main.py` the local `make dev` runs. The seeded bug must live in
exactly one place — if this file carried its own copy of the handlers, the
pipeline could "fix" the bug locally while the deployed app still showed it.

Mounted under /api because the frontend is served from the same origin, so the
browser calls /api/todos rather than a separate backend host.
"""
import os
import sys

from fastapi import FastAPI

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from app.main import app as todo_api  # noqa: E402  (needs the sys.path line above)

app = FastAPI()
app.mount("/api", todo_api)
