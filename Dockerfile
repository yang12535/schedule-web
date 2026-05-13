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

# 创建数据目录并设置权限（node 用户可写）
RUN mkdir -p /data/logs && chmod 755 /data /data/logs && chown -R node:node /data /app

# 切换到非 root 用户运行（安全最佳实践）
USER node

# 环境变量
ENV NODE_ENV=production \
    DATA_FILE=/data/schedule.json \
    LOG_DIR=/data/logs \
    PUBLIC_PATH=/app/public \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/schedule || exit 1

CMD ["node", "server.js"]
