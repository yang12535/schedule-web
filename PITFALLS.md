# 部署踩坑记录

本文档记录部署过程中遇到的问题及解决方案。

---

## 坑 1：nginx.conf UTF-8 BOM 头

**问题：** nginx 启动失败，报错 `unknown directive "server"`

**原因：** 某些编辑器保存的 nginx.conf 包含 UTF-8 BOM 头（`EF BB BF`），nginx 无法识别。

**解决：**
```bash
# 检测 BOM
head -c 3 nginx.conf | xxd

# 如有 BOM，重写文件
cat > nginx.conf << 'NGINXEOF'
server {
    listen 80;
    server_name localhost;
    
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ =404;
    }
    
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1d;
        add_header Cache-Control "public, immutable";
    }
}
NGINXEOF
```

---

## 坑 2：Node.js 服务器静态文件路径

**问题：** 课表服务返回 404，`Error: ENOENT: no such file or directory, stat '/public/index.html'`

**原因：** server.js 中静态文件路径配置为 `/public`，但 Dockerfile 中复制到 `/app/public`。

**解决：**
```javascript
// server.js 中的问题代码
app.use(express.static(path.join(__dirname, '../public'))); // ❌ 错误

// 修复方案 1：修改 Dockerfile，复制 public 到根目录
COPY public /public

// 修复方案 2：修改 server.js 路径
app.use(express.static('/app/public')); // ✅ 正确
```

**实际修复命令：**
```bash
# 进入容器复制 public 到根目录
docker exec schedule-web cp -r /app/public /
```

---

## 坑 3：Nginx Proxy Manager 数据库配置

**问题：** NPM 修改代理配置后不生效，或生成错误的 nginx 配置。

**原因：** 直接修改 database.sqlite 后，NPM 会重新生成 nginx 配置覆盖修改。

**解决：**
1. 修改数据库中的 `proxy_host` 表
2. 确保证书目录正确：`/data/custom_ssl/npm-{id}/`
3. 重启 NPM 容器

**关键字段：**
- `forward_host`: 目标主机名或 IP
- `forward_port`: 目标端口
- `certificate_id`: 关联的证书 ID
- `ssl_forced`: 是否强制 SSL (0/1)

---

## 坑 4：SSL 证书配置

**问题：** HTTPS 返回 000 或 SSL 握手失败

**原因：**
1. 证书文件路径不正确
2. 证书和私钥不匹配
3. nginx 配置中 `connection_upgrade` 变量未定义

**解决步骤：**

### 1. 验证证书和私钥匹配
```bash
CERT_MD5=$(openssl x509 -noout -modulus -in fullchain.pem | openssl md5)
KEY_MD5=$(openssl rsa -noout -modulus -in privkey.pem | openssl md5)
[ "$CERT_MD5" = "$KEY_MD5" ] && echo "匹配" || echo "不匹配"
```

### 2. 证书目录结构
```
/data/custom_ssl/
└── npm-5/
    ├── fullchain.pem  # 证书链
    └── privkey.pem    # 私钥
```

### 3. 手动 nginx 配置模板
```nginx
server {
  listen 443 ssl;
  server_name class.yang125.fun;
  
  ssl_certificate /data/custom_ssl/npm-5/fullchain.pem;
  ssl_certificate_key /data/custom_ssl/npm-5/privkey.pem;
  
  location / {
    proxy_pass http://schedule-web:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

# HTTP 强制跳转 HTTPS
server {
  listen 80;
  server_name class.yang125.fun;
  return 301 https://$server_name$request_uri;
}
```

---

## 坑 5：VPS 网络访问 GitHub

**问题：** 无法 git clone 或 curl 下载 GitHub 文件

**原因：** VPS 网络限制或 DNS 污染

**解决：**
```bash
# 方案 1：本地下载后 SCP 上传
# 本地执行：
curl -L -H "Authorization: token xxx" https://github.com/.../archive/main.zip -o file.zip
scp file.zip root@vps:/tmp/

# 方案 2：修改网关临时访问
sudo ip route del default via 原网关
sudo ip route add default via 192.168.31.237  # 可访问 GitHub 的网关
# 下载完成后改回原网关
```

---

## 坑 6：Docker 卷挂载权限

**问题：** 数据写入失败或权限被拒绝

**解决：**
```bash
# 确保宿主机目录存在且有正确权限
mkdir -p /opt/schedule-web/data /opt/schedule-web/logs
chmod 755 /opt/schedule-web/data /opt/schedule-web/logs

# Docker 运行命令
docker run -d \
  -v /opt/schedule-web/data:/data \
  -v /opt/schedule-web/logs:/data/logs \
  schedule-web:latest
```

---

## 快速部署检查清单

- [ ] nginx.conf 无 BOM 头
- [ ] 静态文件路径正确（server.js vs Dockerfile）
- [ ] NPM 数据库配置正确（proxy_host 表）
- [ ] 证书文件存在且匹配
- [ ] 证书目录命名正确（npm-{id}）
- [ ] Docker 网络配置正确
- [ ] 防火墙放行端口（80/443/30080）

---

**部署成功标志：**
```bash
# HTTP 跳转测试
curl -I http://class.yang125.fun/  # 返回 301

# HTTPS 访问测试
curl -k https://class.yang125.fun/  # 返回 200
```
