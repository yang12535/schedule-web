# 更新日志

## v1.0.0 (2024-03-12)

### ✨ 新功能
- 课程自动保存（添加/删除后自动同步到服务器）
- 兼容旧版本课表数据导入（自动迁移字段）
- VPS 一键部署脚本（支持 Debian/Ubuntu/CentOS/RHEL）
- Makefile 快捷命令管理

### 🐛 修复
- 空密码环境变量处理（EDIT_PASSWORD="" 表示无需密码）
- Docker 静态文件路径修复

### 📁 目录结构
```
schedule-web/
├── src/server/        # 后端代码
├── src/public/        # 前端代码
├── deploy/            # 部署脚本
├── docker-compose.yml
├── Dockerfile
└── Makefile
```

### 🚀 部署方式
```bash
# VPS 一键部署
curl -fsSL https://raw.githubusercontent.com/yang12535/schedule-web/main/deploy/install.sh | bash

# Docker Compose
cp .env.example .env
make start
```
