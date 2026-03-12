# ========================================
# 班级课表服务 - Makefile
# ========================================

.PHONY: help build start stop restart logs status clean deploy install

# 默认目标
help:
	@echo "班级课表服务管理命令"
	@echo ""
	@echo "本地开发:"
	@echo "  make dev          - 本地启动开发服务"
	@echo "  make install-dev  - 安装开发依赖"
	@echo ""
	@echo "Docker 部署:"
	@echo "  make build        - 构建 Docker 镜像"
	@echo "  make start        - 启动服务"
	@echo "  make stop         - 停止服务"
	@echo "  make restart      - 重启服务"
	@echo "  make logs         - 查看日志"
	@echo "  make status       - 查看状态"
	@echo "  make update       - 更新并重启"
	@echo ""
	@echo "数据管理:"
	@echo "  make backup       - 备份数据"
	@echo "  make reset        - 重置数据（谨慎！）"
	@echo ""
	@echo "VPS 一键部署:"
	@echo "  make deploy       - 部署到 VPS"

# Docker 命令
build:
	docker-compose build --no-cache

start:
	docker-compose up -d
	@echo "服务已启动: http://localhost:$(shell grep HOST_PORT .env 2>/dev/null | cut -d= -f2 || echo 30080)"

stop:
	docker-compose down

restart:
	docker-compose restart

logs:
	docker-compose logs -f

status:
	docker-compose ps

update:
	docker-compose pull
	docker-compose up -d

# 数据管理
backup:
	@mkdir -p backups
	@cp data/schedule.json backups/schedule-$(shell date +%Y%m%d-%H%M%S).json
	@echo "备份完成: backups/"

reset:
	@read -p "确定要重置所有数据吗？此操作不可恢复 [y/N]: " confirm; \
	if [ "$$confirm" = "y" ]; then \
		docker-compose down; \
		rm -f data/schedule.json; \
		docker-compose up -d; \
		echo "数据已重置"; \
	else \
		echo "已取消"; \
	fi

# 本地开发
dev:
	@cd src/server && npm install && npm start

install-dev:
	@cd src/server && npm install

# VPS 部署
deploy:
	@bash deploy/install.sh

# 清理
clean:
	docker-compose down -v
	docker system prune -f
