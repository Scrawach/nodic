.PHONY: help up down logs status restart check

COMPOSE ?= docker compose

help:
	@echo "make up      — собрать и запустить БД, бэк и фронт: http://127.0.0.1:5173"
	@echo "make down    — остановить окружение, сохранив данные"
	@echo "make logs    — смотреть логи (Ctrl+C выходит из просмотра)"
	@echo "make status  — состояние контейнеров"
	@echo "make restart — перезапустить бэк и фронт"
	@echo "make check   — проверить типы, серверные тесты и сборку в Docker"

up:
	$(COMPOSE) --profile dev up --build -d --wait
	@echo "Nodic: http://127.0.0.1:5173"

down:
	$(COMPOSE) --profile dev down

logs:
	$(COMPOSE) --profile dev logs -f --tail=100

status:
	$(COMPOSE) --profile dev ps

restart:
	$(COMPOSE) --profile dev restart app

check: up
	$(COMPOSE) exec app npm run typecheck
	$(COMPOSE) exec app npm test
	$(COMPOSE) exec app npm run build
