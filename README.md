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

```yaml
version: '3.8'
services:
  schedule:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - CLASS_NAME=计算机1班        # 班级名称
      - CLASS_DESC=2024春季学期     # 班级描述
      - EDIT_PASSWORD=yourpassword  # 编辑密码（留空则不设密码）
      - SEMESTER_START=2024-03-01   # 学期开始日期
    restart: unless-stopped
```

启动：
```bash
docker-compose up -d
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
  schedule-server
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| CLASS_NAME | 班级/课表名称 | 我的课表 |
| CLASS_DESC | 课表描述 | - |
| EDIT_PASSWORD | 编辑密码（留空则不限制） | - |
| SEMESTER_START | 学期开始日期 | 当年3月1日 |
| PORT | 服务端口 | 3000 |
| DATA_FILE | 数据文件路径 | /data/schedule.json |

## 使用说明

1. **查看课表**: 打开首页直接显示课表
2. **切换编辑**: 点击右上角"查看模式"按钮，输入密码进入编辑模式
3. **查看密码**: 编辑密码在启动日志中显示
   ```bash
   docker logs class-schedule
   # 输出: 🔒 编辑密码: 123456
   ```
4. **添加课程**: 编辑模式下点击"添加课程"
5. **保存更改**: 编辑完成后点击"保存"
6. **导出备份**: 编辑模式下可导出 JSON 备份

## 数据备份

数据存储在 `./data/schedule.json`，建议定期备份：

```bash
cp data/schedule.json backup/schedule-$(date +%Y%m%d).json
```

## 多班级部署

为每个班级创建独立的容器：

```bash
# 计算机1班
docker run -d -p 3001:3000 -v ./data/class1:/data \
  -e CLASS_NAME="计算机1班" -e EDIT_PASSWORD="pass1" \
  --name schedule-class1 schedule-server

# 计算机2班  
docker run -d -p 3002:3000 -v ./data/class2:/data \
  -e CLASS_NAME="计算机2班" -e EDIT_PASSWORD="pass2" \
  --name schedule-class2 schedule-server
```

或使用反向代理：
```
/class1 -> schedule-class1:3000
/class2 -> schedule-class2:3000
```

---

## 部署踩坑

部署过程中踩过的坑记录在 [PITFALLS.md](./PITFALLS.md) 中，包括：

1. nginx.conf UTF-8 BOM 头问题
2. Node.js 服务器静态文件路径问题
3. Nginx Proxy Manager 数据库配置
4. SSL 证书配置
5. VPS 网络访问 GitHub
6. Docker 卷挂载权限

**部署前必看！**
