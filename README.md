# 📚 班级课表服务

简洁美观的班级课表管理系统，支持课程编辑、周次管理、数据导入导出等功能。

[![Docker](https://img.shields.io/badge/Docker-支持-blue)](https://www.docker.com/)
[![GitHub Container Registry](https://img.shields.io/badge/GHCR-预编译镜像-blue?logo=github)](https://github.com/yang12535/schedule-web/pkgs/container/schedule-web)
[![License](https://img.shields.io/badge/License-AGPL--3.0-green)](LICENSE)

## ✨ 功能特性

- 📱 **响应式设计** - 支持手机、平板、电脑访问
- 🎨 **美观界面** - 现代化 UI，支持深色模式
- 📅 **周次管理** - 自动计算当前周次，支持单双周课程
- ✏️ **在线编辑** - 无需后端知识，密码保护编辑权限
- 💾 **数据持久** - 自动保存，支持导入导出
- 🐳 **Docker 部署** - 一键部署，支持 Debian/CentOS
- 🔒 **安全加固** - XSS 防护、路径遍历防护、输入验证

## 🚀 快速部署

### 雨云 RCA 一键部署（准备中）

雨云平台侧应用目前尚未完成。当前仓库仅保留 RCA 配置、镜像和运维文档，正式入口、模板 ID 和推广链接需等平台配置完成并审核通过后再确认。

平台完成后，部署页面应随机生成编辑密码。部署完成后，打开“Web 管理页面”的公网地址即可使用；课表和日志都保存在 `/data`，备份时只需备份该目录。

详细配置、密码说明和备份步骤见 [雨云 RCA 部署指南](docs/rainyun-rca.md)。

### 方式一：预编译镜像快速部署（推荐 ⭐）

使用 GitHub Container Registry 固定版本镜像，无需构建，秒级启动：

```bash
curl -fsSL https://raw.githubusercontent.com/yang12535/schedule-web/main/deploy/install-prebuilt.sh | bash
```

或使用 Makefile：

```bash
make deploy-fast
```

**特点**：
- ⚡ 秒级启动，无需等待构建
- 🔄 固定使用已验证的 `v1.1.2` 镜像
- 🏗️ 支持 amd64/arm64 双架构

### 方式二：VPS 一键部署（完整构建）

如需本地构建镜像：

```bash
curl -fsSL https://raw.githubusercontent.com/yang12535/schedule-web/main/deploy/install.sh | bash
```

或使用 Makefile：

```bash
make deploy
```

### 方式三：Docker Compose

#### 使用预编译镜像（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/yang12535/schedule-web.git
cd schedule-web

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 文件设置参数

# 3. 拉取并启动（使用预编译镜像）
make update-image
# 或: docker-compose pull && docker-compose up -d
```

#### 本地构建

```bash
# 使用本地构建的镜像
docker-compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### 方式四：本地开发

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
| `SEMESTER_START` | 学期开始日期 | 当年 03-01 |
| `EDIT_PASSWORD` | 编辑密码；未设置时随机生成 | 自动生成 |
| `PRINT_EDIT_PASSWORD` | 是否在启动日志中显示自动生成的密码 | 服务默认 false，Compose 默认 true |
| `HOST_PORT` | 服务端口 | 30080 |

## 🔧 管理命令

```bash
# 查看所有命令
make help

# 常用操作
make start         # 启动服务
make stop          # 停止服务
make restart       # 重启服务
make logs          # 查看日志
make backup        # 备份数据
make update-image  # 更新到最新预编译镜像
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
├── src/                           # 源代码
│   ├── server/                   # 后端服务 (Node.js + Express)
│   └── public/                   # 前端页面
├── deploy/                       # 部署脚本
│   ├── install.sh               # 一键安装脚本（本地构建）
│   ├── install-prebuilt.sh      # 快速部署脚本（预编译镜像）⭐
│   └── manage.sh                # 管理脚本
├── .github/workflows/           # GitHub Actions
│   └── docker.yml               # 自动构建 Docker 镜像
├── data/                        # 数据存储 (Docker 挂载)
├── docker-compose.yml           # Docker Compose 配置（预编译镜像）⭐
├── docker-compose.build.yml     # Docker Compose 配置（本地构建）
├── Dockerfile                   # Docker 镜像构建
├── Makefile                     # 快捷命令
└── .env.example                 # 环境变量示例
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
- 只有显式传入空字符串才会关闭密码保护，公网部署禁止这样配置
- Docker Compose 未设置该变量时不会把它误传为空密码
- 编辑课程、设置、公告管理和日志读取都需要编辑密码；管理类读取接口使用 `x-password` header，避免密码进入 URL 或访问日志
- 公开公告只通过 `/api/announcements/active` 返回当前生效内容，不暴露后台公告列表
- 默认响应头包含 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY` 和 `Referrer-Policy: strict-origin-when-cross-origin`
- 所有持久化数据均存储在 `/data`，本地 Compose 对应 `data/` 目录
- **v1.0.2 安全加固**：添加 XSS 防护、路径遍历防护、输入验证

## 📊 日志与访问统计

- 运行日志保存在 `/data/logs/schedule-YYYY-MM-DD.log`，每条动态请求记录为 `METHOD path - IP: ...`
- 日志会过滤 URL 中的 `password`、`token`、`secret` 和 `api_key` 参数；需要传密码的管理接口应使用 header 或请求体
- `GET /healthz` 用于平台健康检查，不作为用户访问量统计口径
- 首屏会请求 `GET /api/schedule`，按天统计该接口可近似得到页面访问量

## ❓ 常见问题

### Q1：更新镜像后页面卡在"加载中..."，API 请求超时，容器 CPU 占用极高

**现象**：
- 页面标题显示正常，但课表数据一直显示"加载中..."
- `curl /api/schedule` 超时无响应
- `docker stats` 显示容器 CPU 占用 300%+

**根因**：
Docker bind mount 绑定的是**目录 inode**，而非路径名。如果在容器运行期间，宿主机上**删除并重建**了挂载源目录（如 `rm -rf data && mkdir data`），bind mount 会指向一个已被标记为 `(deleted)` 的孤儿 inode，容器内看到的 `/data` 实际是空的。

验证方法：
```bash
# 宿主机上检查 mountinfo
CONTAINER_ID=$(docker-compose ps -q schedule)
cat /proc/$(docker inspect --format '{{.State.Pid}}' "$CONTAINER_ID")/mountinfo | grep '/data'
# 若输出中包含 "(deleted)"（或转义形式 "\040(deleted)"），即确认此问题
```

**修复**：
```bash
# 停止并重建容器，让 Docker 重新建立挂载
make stop && make start
# 或手动：
docker-compose down
docker-compose up -d
```

**预防**：
- 备份或更新数据时，**不要删除 `data/` 目录本身**，只覆盖目录内的文件：
  ```bash
  # ✅ 正确：保留目录 inode
  cp backup/schedule.json data/schedule.json

  # ❌ 错误：会断开 bind mount
  rm -rf data/
  mkdir data
  cp backup/schedule.json data/
  ```
- 若使用 `rsync` 同步，加 `--inplace` 参数避免删除重建目录

### Q2：如何固定编辑密码，避免每次更新后变化？

在 `.env` 或 `docker-compose.yml` 中显式设置 `EDIT_PASSWORD`：
```yaml
environment:
  - EDIT_PASSWORD=你的密码
```
`EDIT_PASSWORD` 的行为分为三种情况：
- **未设置 / 未传入容器环境变量**：每次容器重启都会随机生成一个 6 位数字密码。
- **设置为空字符串**：关闭密码保护，仅限隔离的本地调试，禁止公网使用。
- **设置为具体值**：使用该值作为固定编辑密码。

---

## 📝 更新日志

### v1.1.2 (2026-06-16) - 保存、课表日期与安全修复
- ✅ 默认课表回退时生成新的更新时间，并严格校验节次设置
- ✅ 修复周标签和下一节课候选日期偏移
- ✅ 下一周课程改为蓝色提示并显示目标教学周
- ✅ 管理用公告列表需要编辑密码 header，安全响应头覆盖健康检查、静态文件和 API

### v1.1.1 (2026-06-06) - 雨云持久化权限修复
- ✅ 挂载 `/data` 后自动修正目录所有权，再降权运行服务
- ✅ 初始化失败时停止启动，避免进入可查看但无法保存的状态
- ✅ `/healthz` 实际验证持久化写入和原子重命名

### v1.1.0 (2026-06-06) - 雨云 RCA 预适配
- ✅ 标准化 `/healthz` 健康检查
- ✅ 修复 Compose 默认空密码问题
- ✅ 固定发布镜像版本并统一 `/data` 持久化
- ✅ 新增雨云 RCA 部署指南与模板参考（平台完成前为预配置文档）

### v1.0.5 (2026-04-28) - 安全修复与兼容性增强版
- ✅ 密码输入与会话存储安全增强
- ✅ 公告编辑、删除和加载兼容性修复

### v1.0.4 (2026-04-17) - 公告与补课功能版
- ✅ 新增弹窗公告（时段内生效）
- ✅ 新增单周补课模式

### v1.0.3 (2026-04-17) - 代码审查修复版
- ✅ 修复 9 项代码审查发现的问题（原子写入、API 404、跨周计算、时区等）

### v1.0.2 (2024-03-24) - 稳定性修复版
- ✅ 修复 20+ 个关键 Bug（详见 [BUGFIX.md](BUGFIX.md)）
- ✅ XSS 漏洞修复
- ✅ Docker 部署稳定性提升
- ✅ 前端输入验证增强
- ✅ 后端错误处理完善

### v1.0.1
- ✅ 修复周末课程标记问题
- ✅ 优化下一节课卡片 UI

### v1.0.0
- ✅ 课程编辑功能
- ✅ 周次管理（单双周）
- ✅ 数据导入导出
- ✅ Docker 一键部署
- ✅ 兼容旧版本数据

## 🤝 贡献

欢迎提交 Issue 和 PR！

## 📄 许可证

[AGPL-3.0](LICENSE) © 2026 yang12535
