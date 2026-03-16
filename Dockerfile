# ========================================
# 班级课表服务 - Docker 构建
# ========================================

FROM node:18-alpine

WORKDIR /app

# 安装 wget (给 healthcheck 用) + 创建非 root 用户
RUN apk add --no-cache wget && \
    addgroup -g 1001 -S schedule && \
    adduser -S schedule -u 1001

# 安装依赖
COPY src/server/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# 复制应用代码
COPY src/server/*.js ./
COPY src/public/ ./public/

# 创建数据目录并改权限
RUN mkdir -p /data/logs && \
    chown -R schedule:schedule /app /data

# 切换到非 root 用户
USER schedule

# 环境变量
ENV NODE_ENV=production \
    DATA_FILE=/data/schedule.json \
    LOG_DIR=/data/logs \
    PUBLIC_PATH=/app/public \
    PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
