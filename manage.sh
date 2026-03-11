#!/bin/bash

# 课表服务管理脚本
WORK_DIR="/opt/class-schedule"
CONTAINER_NAME="class-schedule"
PASSWORD_FILE="$WORK_DIR/.password"

ACTION=${1:-status}

cd "$WORK_DIR" 2>/dev/null || { echo "工作目录不存在: $WORK_DIR"; exit 1; }

case $ACTION in
  start)
    echo "=== 启动服务 ==="
    docker-compose up -d
    ;;
  stop)
    echo "=== 停止服务 ==="
    docker-compose down
    ;;
  restart)
    echo "=== 重启服务 ==="
    docker-compose restart
    ;;
  logs)
    echo "=== 查看实时日志 ==="
    docker logs -f "$CONTAINER_NAME"
    ;;
  log-files)
    echo "=== 日志文件列表 ==="
    ls -la "$WORK_DIR/logs/" 2>/dev/null || echo "暂无日志文件"
    ;;
  log-view)
    # 查看指定日期的日志，如: ./manage.sh log-view 2024-03-11
    DATE=${2:-$(date +%Y-%m-%d)}
    LOG_FILE="$WORK_DIR/logs/schedule-${DATE}.log"
    if [ -f "$LOG_FILE" ]; then
      echo "=== 日志: $DATE ==="
      cat "$LOG_FILE"
    else
      echo "日志文件不存在: $LOG_FILE"
    fi
    ;;
  password)
    echo "=== 查看编辑密码 ==="
    if [ -f "$PASSWORD_FILE" ]; then
      echo "编辑密码: $(cat "$PASSWORD_FILE")"
    else
      docker logs "$CONTAINER_NAME" 2>/dev/null | grep "编辑密码:" | head -1
    fi
    ;;
  update)
    echo "=== 更新并重启 ==="
    docker-compose down
    docker-compose build --no-cache
    docker-compose up -d
    ;;
  shell)
    echo "=== 进入容器 ==="
    docker exec -it "$CONTAINER_NAME" sh
    ;;
  backup)
    echo "=== 备份数据 ==="
    mkdir -p "$WORK_DIR/backups"
    BACKUP_FILE="$WORK_DIR/backups/schedule-$(date +%Y%m%d-%H%M%S).json"
    cp "$WORK_DIR/data/schedule.json" "$BACKUP_FILE"
    echo "备份完成: $BACKUP_FILE"
    ls -la "$WORK_DIR/backups/"
    ;;
  clean-logs)
    echo "=== 清理旧日志 ==="
    # 保留最近30天的日志
    find "$WORK_DIR/logs" -name "*.log" -type f -mtime +30 -delete
    echo "已清理30天前的日志"
    ls -la "$WORK_DIR/logs/"
    ;;
  status|*)
    echo "班级课表服务管理脚本"
    echo ""
    echo "用法: ./manage.sh [command]"
    echo ""
    echo "命令:"
    echo "  start        - 启动服务"
    echo "  stop         - 停止服务"
    echo "  restart      - 重启服务"
    echo "  logs         - 查看实时日志"
    echo "  log-files    - 查看日志文件列表"
    echo "  log-view     - 查看指定日期日志 (如: ./manage.sh log-view 2024-03-11)"
    echo "  password     - 查看编辑密码"
    echo "  update       - 更新并重启"
    echo "  shell        - 进入容器"
    echo "  backup       - 备份数据"
    echo "  clean-logs   - 清理30天前的日志"
    echo "  status       - 查看状态"
    echo ""
    if [ -f "$PASSWORD_FILE" ]; then
      echo "🔒 编辑密码: $(cat "$PASSWORD_FILE")"
      echo ""
    fi
    docker ps | grep "$CONTAINER_NAME" && echo "" && echo "服务运行中 ✓" || echo "服务未运行 ✗"
    ;;
esac
