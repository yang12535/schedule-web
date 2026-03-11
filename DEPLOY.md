# VPS 部署指南

支持系统：Debian 11+/Ubuntu 20.04+/CentOS 7+

## 快速部署（一键脚本）

```bash
# 下载部署脚本
curl -fsSL https://raw.githubusercontent.com/your-repo/class-schedule/main/deploy.sh -o deploy.sh
chmod +x deploy.sh

# 运行部署（使用默认配置）
sudo ./deploy.sh

# 或自定义配置
sudo CLASS_NAME="软件工程2班" EDIT_PASSWORD="mypassword" HOST_PORT=8080 ./deploy.sh
```

## 手动部署

### 1. 安装 Docker

**Debian/Ubuntu:**
```bash
apt-get update
apt-get install -y docker.io docker-compose
systemctl enable docker --now
```

**CentOS:**
```bash
yum install -y docker docker-compose
systemctl enable docker --now
```

### 2. 上传代码到服务器

```bash
# 本地打包上传
tar czvf kebiao.tar.gz kebiao/
scp kebiao.tar.gz root@your-server-ip:/opt/

# 服务器上解压
ssh root@your-server-ip
cd /opt
tar xzvf kebiao.tar.gz
cd kebiao
```

### 3. 启动服务

```bash
docker-compose up -d
```

## 配置说明

编辑 `docker-compose.yml`：

```yaml
environment:
  - CLASS_NAME=你的班级名称        # 班级名称
  - CLASS_DESC=学期描述             # 学期描述
  - EDIT_PASSWORD=123456           # 编辑密码（留空则无需密码）
  - SEMESTER_START=2024-03-01      # 学期开始日期
```

## 常用命令

```bash
# 查看日志
docker logs -f class-schedule

# 重启服务
docker-compose restart

# 停止服务
docker-compose down

# 更新代码后重建
docker-compose up -d --build

# 备份数据
cp -r data data.backup.$(date +%Y%m%d)

# 查看状态
docker ps
```

## 多班级部署

创建多个实例：

```yaml
# docker-compose.yml
version: '3.8'

services:
  class1:
    build: .
    container_name: schedule-class1
    ports:
      - "30081:3000"
    volumes:
      - ./data/class1:/data
    environment:
      - CLASS_NAME=计算机1班
      - EDIT_PASSWORD=pass1
    restart: unless-stopped

  class2:
    build: .
    container_name: schedule-class2
    ports:
      - "30082:3000"
    volumes:
      - ./data/class2:/data
    environment:
      - CLASS_NAME=计算机2班
      - EDIT_PASSWORD=pass2
    restart: unless-stopped
```

## Nginx 反向代理（推荐）

配合域名使用：

```nginx
server {
    listen 80;
    server_name schedule.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:30080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### HTTPS 配置（SSL）

使用 Let's Encrypt 证书：

```nginx
server {
    listen 443 ssl;
    server_name schedule.yourdomain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://localhost:30080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# HTTP 跳转 HTTPS
server {
    listen 80;
    server_name schedule.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

## 防火墙设置

```bash
# Ubuntu/Debian
ufw allow 30080/tcp

# CentOS
firewall-cmd --permanent --add-port=30080/tcp
firewall-cmd --reload
```

## 数据备份

```bash
# 自动备份脚本（添加到 crontab）
0 2 * * * cd /opt/class-schedule && cp data/schedule.json backups/schedule-$(date +\%Y\%m\%d).json
```

## 常见问题

### Q1: 静态文件返回 404

**现象：** 页面空白，控制台显示 `Error: ENOENT: no such file or directory`

**解决：**
- 确保 `Dockerfile` 中正确复制了 `public/` 目录
- 检查 `PUBLIC_PATH` 环境变量是否正确设置（默认为 `/app/public`）
- 重新构建镜像：`docker-compose up -d --build`

### Q2: 数据无法保存

**现象：** 刷新页面后数据丢失

**解决：**
- 检查 Docker 卷挂载是否正确：`-v ./data:/data`
- 确保宿主机目录有写入权限：`chmod 755 ./data`
- 查看日志确认错误：`docker logs class-schedule`

### Q3: Nginx 反向代理后无法访问

**现象：** 502 Bad Gateway

**解决：**
- 确认容器正在运行：`docker ps`
- 检查端口映射是否正确：`ports: - "30080:3000"`
- 确认 Nginx 配置的 upstream 端口正确

### Q4: 如何修改密码

编辑 `docker-compose.yml` 中的 `EDIT_PASSWORD`，然后重启：

```bash
docker-compose restart
```

或直接查看当前密码：

```bash
# 查看启动日志中的密码
docker logs class-schedule | grep "编辑密码"

# 或查看密码文件
cat /opt/class-schedule/.password
```

### Q5: 如何更新代码

```bash
cd /opt/class-schedule
git pull origin master
docker-compose up -d --build
```

### Q6: 日志文件在哪里

日志保存在 `logs/` 目录，按天归档：

```bash
# 查看日志列表
ls -la logs/

# 查看今天的日志
cat logs/schedule-$(date +%Y-%m-%d).log
```

## 故障排查

```bash
# 查看容器日志
docker logs class-schedule

# 进入容器
docker exec -it class-schedule sh

# 检查端口监听
netstat -tlnp | grep 30080

# 测试 API
curl http://localhost:30080/api/schedule
```
