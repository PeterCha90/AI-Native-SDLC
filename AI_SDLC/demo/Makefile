.PHONY: install dev test e2e

install:
	cd backend && pip install -r requirements.txt
	cd frontend && npm install

dev:
	@echo "Starting backend (:8000) and frontend (:5173) — Ctrl+C to stop both."
	cd backend && uvicorn app.main:app --reload --port 8000 & \
	cd frontend && npm run dev & \
	wait

# Single command the pipeline's 04 TEST stage calls. Its exit code is the verdict.
test:
	cd backend && python -m pytest -q
	cd frontend && npm run build

e2e:
	bash e2e/check.sh
