#!/bin/bash
# ========================================
# 班级课表服务 - 管理脚本
# ========================================

WORK_DIR="${WORK_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
CONTAINER_NAME="class-schedule"
ENV_FILE="$WORK_DIR/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

load_env() {
    [ -f "$ENV_FILE" ] && { set -a; source "$ENV_FILE"; set +a; }
}

check_status() {
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo -e "${GREEN}运行中 ✓${NC}"; return 0
    else
        echo -e "${RED}已停止 ✗${NC}"; return 1
    fi
}

show_password() {
    if [ -f "$WORK_DIR/.password" ]; then
        cat "$WORK_DIR/.password"
    elif [ -f "$ENV_FILE" ]; then
        grep "EDIT_PASSWORD" "$ENV_FILE" | cut -d'=' -f2
    else
        docker logs "$CONTAINER_NAME" 2>/dev/null | grep "编辑密码:" | head -1 | awk -F': ' '{print $2}'
    fi
}

show_help() {
    echo "========================================"
    echo "  班级课表服务管理"
    echo "========================================"
    echo ""
    echo "用法: $0 [command]"
    echo ""
    echo "命令:"
    echo "  start      - 启动服务"
    echo "  stop       - 停止服务"
    echo "  restart    - 重启服务"
    echo "  status     - 查看状态"
    echo "  logs       - 查看实时日志"
    echo "  password   - 查看编辑密码"
    echo "  backup     - 备份数据"
    echo "  update     - 更新服务"
    echo "  reset      - 重置数据（谨慎！）"
    echo ""
    echo "当前状态: $(check_status)"
    echo "工作目录: $WORK_DIR"
    echo ""
}

case "${1:-status}" in
    start)
        info "启动服务..."
        cd "$WORK_DIR" && docker-compose up -d
        success "服务已启动"
        ;;
    stop)
        info "停止服务..."
        cd "$WORK_DIR" && docker-compose down
        success "服务已停止"
        ;;
    restart)
        info "重启服务..."
        cd "$WORK_DIR" && docker-compose restart
        success "服务已重启"
        ;;
    status)
        echo "========================================"
        echo "  服务状态"
        echo "========================================"
        echo ""
        echo "容器状态: $(check_status)"
        echo ""
        if docker ps | grep -q "^${CONTAINER_NAME}$"; then
            echo "--- 容器信息 ---"
            docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
            echo ""
            echo "--- 资源使用 ---"
            docker stats "$CONTAINER_NAME" --no-stream --format "CPU: {{.CPUPerc}} | 内存: {{.MemUsage}}"
            echo ""
        fi
        echo "--- 编辑密码 ---"
        echo "$(show_password)"
        ;;
    logs)
        docker logs -f "$CONTAINER_NAME"
        ;;
    password)
        echo "========================================"
        echo "  编辑密码"
        echo "========================================"
        echo ""
        echo "$(show_password)"
        echo ""
        ;;
    backup)
        BACKUP_DIR="$WORK_DIR/backups"
        mkdir -p "$BACKUP_DIR"
        BACKUP_FILE="$BACKUP_DIR/schedule-$(date +%Y%m%d-%H%M%S).json"
        [ -f "$WORK_DIR/data/schedule.json" ] && cp "$WORK_DIR/data/schedule.json" "$BACKUP_FILE" && success "备份完成: $BACKUP_FILE" || error "数据文件不存在"
        find "$BACKUP_DIR" -name "*.json" -type f -mtime +30 -delete
        ;;
    update)
        info "更新服务..."
        cd "$WORK_DIR"
        docker-compose pull 2>/dev/null || true
        docker-compose build --no-cache
        docker-compose up -d
        success "服务已更新"
        ;;
    reset)
        read -p "确定要重置所有数据吗？此操作不可恢复 [y/N]: " confirm
        [[ "$confirm" =~ ^[Yy]$ ]] && { docker stop "$CONTAINER_NAME"; rm -f "$WORK_DIR/data/schedule.json"; docker start "$CONTAINER_NAME"; success "数据已重置"; } || warn "已取消"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        show_help
        ;;
esac
