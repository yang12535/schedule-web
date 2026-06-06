# ========================================
# 班级课表服务 - Docker 构建
# 支持多阶段构建，优化镜像大小
# ========================================

FROM node:22-alpine

# 安装 wget 用于健康检查，安装 tzdata 用于时区
RUN apk add --no-cache wget tzdata su-exec
ENV TZ=Asia/Shanghai

WORKDIR /app

# 安装依赖
COPY src/server/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# 复制应用代码
COPY src/server/*.js ./
COPY src/public/ ./public/

# 创建数据目录并设置权限（构建时设置基础权限）
RUN mkdir -p /data/logs && chmod 750 /data /data/logs && chown -R node:node /data

# 复制入口脚本并设置权限（以 root 运行来修复挂载卷权限，再降级到 node 用户）
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# 环境变量
ENV NODE_ENV=production \
    DATA_FILE=/data/schedule.json \
    LOG_DIR=/data/logs \
    PUBLIC_PATH=/app/public \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/healthz || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
