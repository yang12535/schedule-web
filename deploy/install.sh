#!/bin/bash
# ========================================
# 班级课表服务 - VPS 一键部署脚本
# 支持: Debian/Ubuntu/CentOS/RHEL + Docker
# ========================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

generate_password() { echo $((100000 + RANDOM % 900000)); }

detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VERSION=$VERSION_ID
    else
        error "无法检测操作系统类型"
    fi
    info "检测到系统: $OS $VERSION"
}

install_docker_debian() {
    info "正在安装 Docker..."
    apt-get update
    apt-get install -y ca-certificates curl gnupg lsb-release
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$OS/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl start docker
    systemctl enable docker
    success "Docker 安装完成"
}

install_docker_centos() {
    info "正在安装 Docker..."
    yum install -y yum-utils
    yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl start docker
    systemctl enable docker
    success "Docker 安装完成"
}

main() {
    clear
    echo "========================================"
    echo "  班级课表服务 - VPS 一键部署"
    echo "========================================"
    echo ""
    
    [ "$EUID" -ne 0 ] && error "请使用 root 权限运行此脚本"
    
    detect_os
    
    if ! command -v docker &> /dev/null; then
        case $OS in
            ubuntu|debian) install_docker_debian ;;
            centos|rhel|fedora|rocky|almalinux) install_docker_centos ;;
            *) error "不支持的操作系统: $OS" ;;
        esac
    else
        success "Docker 已安装"
    fi
    
    WORK_DIR="${WORK_DIR:-/opt/class-schedule}"
    mkdir -p "$WORK_DIR"
    cd "$WORK_DIR"
    info "工作目录: $WORK_DIR"
    
    # 下载最新版本
    info "下载项目文件..."
    curl -fsSL -o /tmp/schedule-web.zip https://github.com/yang12535/schedule-web/releases/download/v1.0.0/schedule-web-v1.0.zip
    unzip -o /tmp/schedule-web.zip -d /tmp/
    cp -r /tmp/schedule-web-master/* .
    rm -rf /tmp/schedule-web-master /tmp/schedule-web.zip
    
    # 生成密码
    if [ ! -f ".env" ]; then
        RANDOM_PASS=$(generate_password)
        cat > .env << EOF
CLASS_NAME=计算机网络1班
CLASS_DESC=2024年春季学期
SEMESTER_START=2024-03-01
EDIT_PASSWORD=${RANDOM_PASS}
HOST_PORT=30080
DATA_PATH=./data
LOGS_PATH=./logs
EOF
        echo "$RANDOM_PASS" > .password
        chmod 600 .password
    fi
    
    set -a; source .env; set +a
    mkdir -p data logs
    
    info "停止旧服务..."
    docker-compose down 2>/dev/null || true
    
    info "构建并启动..."
    docker-compose build --no-cache
    docker-compose up -d
    
    sleep 3
    
    if docker ps | grep -q "class-schedule"; then
        SERVER_IP=$(curl -s ipv4.icanhazip.com 2>/dev/null || echo "你的服务器IP")
        clear
        echo "========================================"
        echo "  部署成功！"
        echo "========================================"
        echo ""
        echo "班级名称: $CLASS_NAME"
        echo ""
        echo "编辑密码: $(cat .password)"
        echo ""
        echo "访问地址: http://$SERVER_IP:${HOST_PORT:-30080}"
        echo ""
        echo "数据目录: $WORK_DIR/data"
        echo "管理脚本: $WORK_DIR/deploy/manage.sh"
        echo "========================================"
    else
        error "部署失败，请检查日志: docker logs class-schedule"
    fi
}

main "$@"
