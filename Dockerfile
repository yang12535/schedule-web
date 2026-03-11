FROM node:18-alpine

WORKDIR /app

COPY server/package.json ./
RUN npm install --production

COPY server/ ./
COPY public/ ./public/

# 创建数据和日志目录
RUN mkdir -p /data/logs

ENV DATA_FILE=/data/schedule.json
ENV LOG_DIR=/data/logs
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
