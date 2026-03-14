# 更新日志

## v1.0.1 (2026-03-14)

### 🐛 修复
- 修复周末错误标记当前课程的问题（day 6/0 时不高亮）
- 修复下一节课卡片遮挡弹窗底部按钮的问题
- 添加颜色选择强制校验和提示

### ✨ 改进
- 重构下一节课卡片 UI：
  - 上课中（>10分钟）：显示当前课程，绿色边框
  - 即将下课（≤10分钟）：主从切换，大字显示下一节课
  - 课间休息：显示下一节课倒计时，红色边框
- 添加显眼的颜色选择提示（保存前必须选择颜色）

## v1.0.0 (2026-03-12)

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
