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
    }
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
