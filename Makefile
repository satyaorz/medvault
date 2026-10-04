# MedVault developer commands. Run `make help`.
SHELL := /bin/bash
.DEFAULT_GOAL := help

AI_PY := ai-service/.venv/bin/python

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

infra: ## Start Postgres, Redis and S3 storage (Docker)
	docker compose up -d

infra-down: ## Stop infrastructure (keeps data)
	docker compose down

setup: ## Install all dependencies (Go modules, Python venv, npm)
	cd backend && go mod download
	cd ai-service && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt -r requirements-dev.txt
	cd frontend && npm install

api: ## Run the Go API on :8080
	cd backend && go run ./cmd/api

worker: ## Run the Go worker (document pipeline)
	cd backend && go run ./cmd/worker

ai: ## Run the Python AI service on :8000
	cd ai-service && .venv/bin/uvicorn app.main:app --port 8000 --reload

web: ## Run the Next.js frontend on :3000
	cd frontend && npm run dev

test: test-backend test-ai test-web ## Run every test suite

test-backend: ## Go unit + integration tests (needs `make infra`)
	cd backend && go vet ./... && go test ./...

test-ai: ## Python tests
	cd ai-service && .venv/bin/pytest -q

test-web: ## Frontend typecheck, lint and unit tests
	cd frontend && npm run typecheck && npm run lint && npm test

eval: ## Evaluate extraction accuracy on the labelled dataset (rules provider)
	cd ai-service && .venv/bin/python eval/run_eval.py --provider rules

up: ## Build and run the whole stack in Docker
	docker compose --profile app up -d --build

down: ## Stop the whole Docker stack
	docker compose --profile app down

.PHONY: help infra infra-down setup api worker ai web test test-backend test-ai test-web eval up down
