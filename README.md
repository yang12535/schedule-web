# 班级课表服务

单班级课表管理服务，一个 Docker 容器服务一个班级。

## 功能特性

- 📚 **单班级模式** - 一个容器服务一个班级
- 👁️ **查看/编辑切换** - 首页直接显示课表，右上角切换模式
- 🔒 **密码保护** - 可选设置编辑密码
- 📝 **在线编辑** - 添加、编辑、删除课程
- 🎨 **颜色标记** - 不同类型课程用不同颜色
- 📤 **导入/导出** - 支持 JSON 格式备份
- 📅 **周次导航** - 支持查看不同周的课表

## 快速部署

### Docker Compose（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/yang12535/schedule-web.git
cd schedule-web

# 2. 启动服务
docker-compose up -d
```

或使用自定义配置：

```yaml
# docker-compose.yml
version: '3.8'
services:
  schedule:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - CLASS_NAME=计算机1班
      - CLASS_DESC=2024春季学期
      - EDIT_PASSWORD=123456
      - SEMESTER_START=2024-03-01
    restart: unless-stopped
```

### Docker Run

```bash
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/data \
  -e CLASS_NAME="计算机1班" \
  -e EDIT_PASSWORD="123456" \
  -e SEMESTER_START="2024-03-01" \
  --name class-schedule \
  yang12535/schedule-web:latest
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| CLASS_NAME | 班级/课表名称 | 我的课表 |
| CLASS_DESC | 课表描述 | - |
| EDIT_PASSWORD | 编辑密码（留空则自动生成6位数字） | - |
| SEMESTER_START | 学期开始日期 | 当年3月1日 |
| PORT | 服务端口 | 3000 |
| DATA_FILE | 数据文件路径 | /data/schedule.json |
| LOG_DIR | 日志目录 | /data/logs |

## 使用说明

1. **查看课表**: 打开首页直接显示课表
2. **切换编辑**: 点击右上角"查看"按钮，输入密码进入编辑模式
3. **查看密码**: 编辑密码在启动日志中显示
   ```bash
   docker logs class-schedule
   # 输出: 🔒 编辑密码: 123456
   ```
4. **添加课程**: 编辑模式下点击"添加课程"
5. **保存更改**: 编辑完成后点击"保存"
6. **导出备份**: 编辑模式下可导出 JSON 备份

## 常见问题

遇到问题请查看 [DEPLOY.md](DEPLOY.md) 中的"常见问题"章节，包括：
- 静态文件返回 404
- 数据无法保存
- Nginx 反向代理配置
- SSL/HTTPS 配置

## 数据备份

数据存储在 `./data/schedule.json`，建议定期备份：

```bash
# 手动备份
cp data/schedule.json backup/schedule-$(date +%Y%m%d).json

# 自动备份（添加到 crontab）
0 2 * * * cd /opt/schedule-web && cp data/schedule.json backups/schedule-$(date +\%Y\%m\%d).json
```

## 多班级部署

为每个班级创建独立的容器：

```bash
# 计算机1班
docker run -d -p 3001:3000 -v ./data/class1:/data \
  -e CLASS_NAME="计算机1班" -e EDIT_PASSWORD="pass1" \
  --name schedule-class1 yang12535/schedule-web:latest

# 计算机2班  
docker run -d -p 3002:3000 -v ./data/class2:/data \
  -e CLASS_NAME="计算机2班" -e EDIT_PASSWORD="pass2" \
  --name schedule-class2 yang12535/schedule-web:latest
```

## 许可证

[AGPL-3.0](LICENSE)
