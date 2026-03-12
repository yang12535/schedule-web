# 📚 班级课表服务

简洁美观的班级课表管理系统，支持课程编辑、周次管理、数据导入导出等功能。

[![Docker](https://img.shields.io/badge/Docker-支持-blue)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

## ✨ 功能特性

- 📱 **响应式设计** - 支持手机、平板、电脑访问
- 🎨 **美观界面** - 现代化 UI，支持深色模式
- 📅 **周次管理** - 自动计算当前周次，支持单双周课程
- ✏️ **在线编辑** - 无需后端知识，密码保护编辑权限
- 💾 **数据持久** - 自动保存，支持导入导出
- 🐳 **Docker 部署** - 一键部署，支持 Debian/CentOS

## 🚀 快速部署

### 方式一：VPS 一键部署（推荐）

支持 **Debian/Ubuntu/CentOS/RHEL**：

```bash
curl -fsSL https://raw.githubusercontent.com/yang12535/schedule-web/main/deploy/install.sh | bash
```

或使用 Makefile：

```bash
make deploy
```

### 方式二：Docker Compose

```bash
# 1. 克隆仓库
git clone https://github.com/yang12535/schedule-web.git
cd schedule-web

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 文件设置参数

# 3. 启动服务
make start
# 或: docker-compose up -d
```

### 方式三：本地开发

```bash
# 安装依赖
make install-dev

# 启动服务
make dev
```

## 📋 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `CLASS_NAME` | 班级名称 | 我的课表 |
| `CLASS_DESC` | 学期描述 | - |
| `SEMESTER_START` | 学期开始日期 | 2024-03-01 |
| `EDIT_PASSWORD` | 编辑密码（留空则无需密码） | - |
| `HOST_PORT` | 服务端口 | 30080 |

## 🔧 管理命令

```bash
# 查看所有命令
make help

# 常用操作
make start      # 启动服务
make stop       # 停止服务
make restart    # 重启服务
make logs       # 查看日志
make backup     # 备份数据
make update     # 更新服务
```

或使用管理脚本：

```bash
./deploy/manage.sh [command]

# 命令说明：
#  start      - 启动服务
#  stop       - 停止服务
#  restart    - 重启服务
#  status     - 查看状态
#  logs       - 查看实时日志
#  password   - 查看编辑密码
#  backup     - 备份数据
#  restore    - 恢复数据
```

## 📁 目录结构

```
schedule-web/
├── src/                    # 源代码
│   ├── server/            # 后端服务 (Node.js + Express)
│   └── public/            # 前端页面
├── deploy/                # 部署脚本
│   ├── install.sh        # 一键安装脚本
│   └── manage.sh         # 管理脚本
├── data/                  # 数据存储 (Docker 挂载)
├── logs/                  # 日志文件 (Docker 挂载)
├── docker-compose.yml     # Docker Compose 配置
├── Dockerfile            # Docker 镜像构建
├── Makefile              # 快捷命令
└── .env.example          # 环境变量示例
```

## 📥 数据导入导出

### 导出数据
点击页面上的 "📤 导出" 按钮，下载 JSON 格式的课表数据。

### 导入数据
点击 "📥 导入" 按钮，选择之前导出的 JSON 文件。

**兼容旧版本数据**：支持自动迁移旧格式数据。

## 🛡️ 安全说明

- 默认启用密码保护，首次启动会生成随机 6 位数字密码
- 可通过 `EDIT_PASSWORD` 环境变量自定义密码
- 留空 `EDIT_PASSWORD` 可关闭密码保护（不推荐用于生产环境）
- 所有数据存储在本地 `data/` 目录

## 📝 更新日志

### v1.0.0
- ✅ 课程编辑功能
- ✅ 周次管理（单双周）
- ✅ 数据导入导出
- ✅ Docker 一键部署
- ✅ 兼容旧版本数据

## 🤝 贡献

欢迎提交 Issue 和 PR！

## 📄 许可证

MIT License © 2024
