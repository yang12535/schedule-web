# ========================================
# 班级课表服务 - Docker 构建
# 支持多阶段构建，优化镜像大小
# ========================================

FROM node:22-alpine

# 安装 wget 用于健康检查，tzdata 用于时区，su-exec 用于启动后降权
RUN apk add --no-cache wget tzdata su-exec
ENV TZ=Asia/Shanghai

WORKDIR /app

# 安装依赖
COPY src/server/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# 复制应用代码
COPY src/server/*.js ./
COPY src/public/ ./public/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# 镜像内目录先设置权限；挂载卷覆盖 /data 后由 entrypoint 再次修正。
RUN mkdir -p /data/logs \
    && chmod 750 /data /data/logs \
    && chown -R node:node /data \
    && chmod 755 /usr/local/bin/docker-entrypoint.sh

# 环境变量
ENV NODE_ENV=production \
    DATA_FILE=/data/schedule.json \
    LOG_DIR=/data/logs \
    PUBLIC_PATH=/app/public \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/healthz || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
