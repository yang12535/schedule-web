#!/bin/bash
set -e

# ========================================
# 课表服务 VPS 部署脚本
# 支持: Debian/Ubuntu/CentOS + Docker
# ========================================

# 生成随机6位数字密码
generate_password() {
    echo $((100000 + RANDOM % 900000))
}

# 配置（根据需要修改）
CLASS_NAME="${CLASS_NAME:-计算机1班}"
CLASS_DESC="${CLASS_DESC:-2024年春季学期}"
# 如果 EDIT_PASSWORD 留空，会自动生成随机密码
EDIT_PASSWORD="${EDIT_PASSWORD:-$(generate_password)}"
SEMESTER_START="${SEMESTER_START:-2024-03-01}"
HOST_PORT="${HOST_PORT:-30080}"
CONTAINER_NAME="${CONTAINER_NAME:-class-schedule}"

echo "========================================"
echo "  课表服务 VPS 部署"
echo "========================================"
echo ""

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "Docker 未安装，正在安装..."
    
    # 检测系统类型
    if [ -f /etc/debian_version ]; then
        # Debian/Ubuntu
        apt-get update
        apt-get install -y ca-certificates curl gnupg
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        chmod a+r /etc/apt/keyrings/docker.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
        apt-get update
        apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    elif [ -f /etc/redhat-release ]; then
        # CentOS/RHEL
        yum install -y yum-utils
        yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
        systemctl start docker
        systemctl enable docker
    else
        echo "不支持的系统，请手动安装 Docker"
        exit 1
    fi
    
    echo "Docker 安装完成"
fi

# 检查 Docker Compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "正在安装 Docker Compose..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    ln -sf /usr/local/bin/docker-compose /usr/bin/docker-compose
fi

# 创建工作目录
WORK_DIR="/opt/class-schedule"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

echo "工作目录: $WORK_DIR"

# 保存密码到文件
PASSWORD_FILE="$WORK_DIR/.password"
echo "$EDIT_PASSWORD" > "$PASSWORD_FILE"
chmod 600 "$PASSWORD_FILE"

# 创建 Dockerfile
cat > Dockerfile << 'EOF'
FROM node:18-alpine

WORKDIR /app

COPY server/package.json ./
RUN npm install --production

COPY server/ ./
COPY public/ ./public/

RUN mkdir -p /data/logs

ENV DATA_FILE=/data/schedule.json
ENV LOG_DIR=/data/logs
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
EOF

# 创建 docker-compose.yml
cat > docker-compose.yml << EOF
version: '3.8'

services:
  schedule:
    build: .
    container_name: $CONTAINER_NAME
    ports:
      - "$HOST_PORT:3000"
    volumes:
      - ./data:/data
      - ./logs:/data/logs
    environment:
      - CLASS_NAME=$CLASS_NAME
      - CLASS_DESC=$CLASS_DESC
      - EDIT_PASSWORD=$EDIT_PASSWORD
      - SEMESTER_START=$SEMESTER_START
      - DATA_FILE=/data/schedule.json
      - LOG_DIR=/data/logs
    restart: unless-stopped
    sysctls:
      - net.ipv6.conf.all.disable_ipv6=0
EOF

# 创建数据目录和日志目录
mkdir -p data logs

# 停止旧容器
echo "停止旧容器..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

# 构建并启动
echo "构建 Docker 镜像..."
docker-compose build --no-cache

echo "启动服务..."
docker-compose up -d

# 等待服务启动
sleep 3

# 检查状态
if docker ps | grep -q "$CONTAINER_NAME"; then
    # 获取服务器IP
    SERVER_IP=$(curl -s ipv4.icanhazip.com 2>/dev/null || echo "你的服务器IP")
    
    echo ""
    echo "========================================"
    echo "  ✅ 部署成功！"
    echo "========================================"
    echo ""
    echo "📚 班级名称: $CLASS_NAME"
    echo "📝 学期描述: $CLASS_DESC"
    echo ""
    echo "========================================"
    echo "  🔒 编辑密码: $EDIT_PASSWORD"
    echo "========================================"
    echo ""
    echo "⚠️  请妥善保存密码！已保存到: $PASSWORD_FILE"
    echo ""
    echo "🌐 访问地址:"
    echo "   http://$SERVER_IP:$HOST_PORT"
    echo ""
    echo "📁 数据目录: $WORK_DIR/data"
    echo "📁 日志目录: $WORK_DIR/logs"
    echo ""
    echo "📋 常用命令:"
    echo "   查看日志: docker logs -f $CONTAINER_NAME"
    echo "   查看密码: cat $PASSWORD_FILE"
    echo "   管理脚本: ./manage.sh"
    echo "========================================"
    
    # 保存部署信息
    cat > "$WORK_DIR/deploy.info" << EOF
部署时间: $(date)
班级名称: $CLASS_NAME
访问地址: http://$SERVER_IP:$HOST_PORT
编辑密码: $EDIT_PASSWORD
数据目录: $WORK_DIR/data
日志目录: $WORK_DIR/logs
EOF

else
    echo "❌ 部署失败，查看日志:"
    docker logs "$CONTAINER_NAME" 2>/dev/null || echo "容器未启动"
    exit 1
fi
