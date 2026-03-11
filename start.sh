#!/bin/bash
set -e

# 创建数据目录
mkdir -p data

# 构建镜像
echo "=== 构建Docker镜像 ==="
docker build -t class-schedule:latest .

# 停止旧容器
echo "=== 停止旧容器 ==="
docker stop class-schedule 2>/dev/null || true
docker rm class-schedule 2>/dev/null || true

# 启动新容器
echo "=== 启动容器 ==="
docker run -d \
  --name class-schedule \
  --restart unless-stopped \
  -p 30080:3000 \
  -v $(pwd)/data:/data \
  -e CLASS_NAME="计算机1班" \
  -e CLASS_DESC="2024年春季学期" \
  -e EDIT_PASSWORD="yang125fun" \
  -e SEMESTER_START="2024-03-01" \
  -e DATA_FILE=/data/schedule.json \
  class-schedule:latest

echo ""
echo "=== 部署完成 ==="
echo "访问地址: http://fn100.yang125.fun:30080"
echo "本地地址: http://localhost:30080"
echo "编辑密码: 123456"
echo ""
echo "查看日志: docker logs -f class-schedule"
