# ========================================
# 班级课表服务 - Docker 构建
# 支持多阶段构建，优化镜像大小
# ========================================

FROM node:22-alpine

# 安装 wget 用于健康检查，安装 tzdata 用于时区
RUN apk add --no-cache wget tzdata
ENV TZ=Asia/Shanghai

WORKDIR /app

# 安装依赖
COPY src/server/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# 复制应用代码
COPY src/server/*.js ./
COPY src/public/ ./public/

# 复制入口脚本并设置权限
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# 环境变量
ENV NODE_ENV=production \
    DATA_FILE=/data/schedule.json \
    LOG_DIR=/data/logs \
    PUBLIC_PATH=/app/public \
    PORT=3000

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
