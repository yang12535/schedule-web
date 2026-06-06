#!/bin/sh
# ========================================
# 班级课表服务 - Docker 入口脚本
# 以 root 修复 /data 目录权限（挂载卷会覆盖构建时的权限设置）
# 然后降级到 node 用户运行应用（安全最佳实践）
# ========================================

# 确保数据目录存在且对 node 用户可写
mkdir -p /data/logs
chown -R node:node /data
chmod -R u+rwx /data

# 降级到 node 用户运行应用
exec su-exec node node server.js
