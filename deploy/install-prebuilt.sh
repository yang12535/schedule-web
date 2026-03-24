#!/bin/bash
# ========================================
# 班级课表服务 - 预编译镜像快速部署脚本
# 支持: Debian/Ubuntu/CentOS/RHEL + Docker
# 特点: 无需构建，直接使用 GitHub Container Registry 镜像
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

# 修复：兼容 docker compose 和 docker-compose
DOCKER_COMPOSE="docker compose"
if ! $DOCKER_COMPOSE version &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
fi

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
    echo "  班级课表服务 - 预编译镜像快速部署"
    echo "========================================"
    echo ""
    echo "  特点:"
    echo "    ✓ 无需本地构建，秒级启动"
    echo "    ✓ 自动拉取 GitHub Container Registry 最新镜像"
    echo "    ✓ 支持 amd64/arm64 架构"
    echo ""
    
    [ "$EUID" -ne 0 ] && error "请使用 root 权限运行此脚本"
    
    detect_os
    
    # 检查并安装 Docker
    if ! command -v docker &> /dev/null; then
        case $OS in
            ubuntu|debian) install_docker_debian ;;
            centos|rhel|fedora|rocky|almalinux) install_docker_centos ;;
            *) error "不支持的操作系统: $OS" ;;
        esac
    else
        success "Docker 已安装"
    fi
    
    # 创建工作目录
    WORK_DIR="${WORK_DIR:-/opt/class-schedule}"
    mkdir -p "$WORK_DIR"
    cd "$WORK_DIR"
    info "工作目录: $WORK_DIR"
    
    # 下载部署文件（仅需 docker-compose.yml 和 .env.example）
    info "下载部署文件..."
    curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/yang12535/schedule-web/main/docker-compose.yml
    curl -fsSL -o .env.example https://raw.githubusercontent.com/yang12535/schedule-web/main/.env.example
    success "部署文件下载完成"
    
    # 生成配置文件
    if [ ! -f ".env" ]; then
        RANDOM_PASS=$(generate_password)
        cat > .env << EOF
# ========================================
# 班级课表服务 - 环境配置
# ========================================

# 基础配置
CLASS_NAME=计算机网络1班
CLASS_DESC=2024年春季学期
SEMESTER_START=2024-03-01

# 安全设置
EDIT_PASSWORD=${RANDOM_PASS}

# 服务端口
HOST_PORT=30080

# 数据存储路径
DATA_PATH=./data
LOGS_PATH=./logs
EOF
        echo "$RANDOM_PASS" > .password
        chmod 600 .password
        success "配置文件已生成"
    else
        warn "配置文件已存在，跳过生成"
    fi
    
    # 创建数据目录
    set -a; source .env; set +a
    mkdir -p data logs
    # 修复：设置数据目录权限
    chmod 755 data logs
    
    # 停止旧服务
    info "停止旧服务..."
    $DOCKER_COMPOSE down 2>/dev/null || true
    
    # 拉取最新镜像并启动
    info "拉取最新镜像..."
    $DOCKER_COMPOSE pull
    
    info "启动服务..."
    $DOCKER_COMPOSE up -d
    
    # 等待服务启动
    sleep 3
    
    # 检查服务状态
    if docker ps | grep -q "class-schedule"; then
        SERVER_IP=$(curl -s ipv4.icanhazip.com 2>/dev/null || echo "你的服务器IP")
        clear
        echo "========================================"
        echo "  部署成功！"
        echo "========================================"
        echo ""
        echo "  班级名称: $CLASS_NAME"
        echo ""
        echo "  编辑密码: $(cat .password)"
        echo ""
        echo "  访问地址: http://$SERVER_IP:${HOST_PORT:-30080}"
        echo ""
        echo "  数据目录: $WORK_DIR/data"
        echo "  日志查看: docker logs -f class-schedule"
        echo ""
        echo "  管理命令:"
        echo "    停止:   $DOCKER_COMPOSE down"
        echo "    重启:   $DOCKER_COMPOSE restart"
        echo "    更新:   $DOCKER_COMPOSE pull && $DOCKER_COMPOSE up -d"
        echo "========================================"
    else
        error "部署失败，请检查日志: docker logs class-schedule"
    fi
}

main "$@"
