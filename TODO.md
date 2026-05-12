# 课表项目修复待办清单

> 生成时间：2026-05-12
> 来源：6 Agent 并行安全漏洞扫描 / Bug 扫描 / 代码规范化扫描综合报告

---

## P0 — 立即修复（安全/数据完整性）

### 认证与授权
- [x] **修复默认空密码认证绕过**
  - 位置：`docker-compose.yml:26` + `server.js:94`
  - 问题：`EDIT_PASSWORD=${EDIT_PASSWORD:-}` 默认传入空字符串，`server.js` 中 `process.env.EDIT_PASSWORD !== undefined` 为 true，空字符串在布尔判断中为 false，导致认证完全绕过
  - 建议：将空字符串视为"未设置"，使用 `process.env.EDIT_PASSWORD ? ... : generatePassword()`

- [x] **为日志接口添加认证**
  - 位置：`server.js:460-491`
  - 问题：`/api/logs` 和 `/api/logs/:file` 无身份验证，任何人可读取服务器日志
  - 建议：添加与编辑接口一致的密码认证中间件

### XSS 与前端安全
- [x] **废除内联 onclick，改用事件委托**
  - 位置：`index.html:658-662`
  - 问题：`escapeHtml` 不转义单引号，恶意课程 ID 可突破 onclick 字符串边界执行任意代码
  - 建议：使用 `data-id` 属性 + 事件委托模式

- [x] **修复日志路径遍历前缀绕过**
  - 位置：`server.js:480-483`
  - 问题：`startsWith('/data/logs')` 无法防御 `/data/logs-backup/xxx` 类路径
  - 建议：`resolvedPath.startsWith(resolvedLogDir + path.sep)`

### 数据一致性
- [x] **使用深拷贝生成默认配置**
  - 位置：`server.js:103-161`
  - 问题：`{...defaultSchedule}` 是浅拷贝，`courses`/`announcements`/`periodSettings` 引用被共享，修改会污染默认基线
  - 建议：使用 `JSON.parse(JSON.stringify(...))` 或工厂函数

- [x] **引入写锁防止并发数据丢失**
  - 位置：`server.js:144-230`
  - 问题：两个并发写请求读取同一版本，后保存的覆盖前者
  - 建议：使用 `async-mutex` 将 `load → modify → save` 串行化

- [x] **JSON 损坏时返回默认配置而非抛异常**
  - 位置：`server.js:163-178`
  - 问题：备份损坏文件后仍 `throw err`，与 BUGFIX.md 承诺不符
  - 建议：`scheduleCache = createDefaultSchedule(); return scheduleCache;`

- [x] **修复导入数据后客户端覆盖服务端验证结果**
  - 位置：`index.html:1117-1119`
  - 问题：导入成功后，客户端用原始导入文件中的非法值覆盖服务端返回的合法值
  - 建议：完全信任服务端返回的 `result.schedule`

---

## P1 — 本周修复（稳定性/可用性）

### 后端安全加固
- [x] **为密码生成改用 `crypto.randomInt()`**
  - 位置：`server.js:11-13`
  - 当前使用 `Math.random()`，非加密安全

- [x] **修复 X-Forwarded-For 速率限制绕过**
  - 位置：`server.js:58-65`
  - 直接信任客户端传入的 X-Forwarded-For，可伪造随机 IP 绕过限流

- [x] **为 rateLimitStore 添加 TTL 清理**
  - 位置：`server.js:37-56`
  - 永不过期，可被恶意填充导致 OOM

- [x] **限制 API 请求体大小和字段长度**
  - 位置：`server.js:207-342`
  - 课程名、公告内容等无长度限制，可构造超大 Payload 导致 DoS

- [x] **为日志接口添加限流**
  - 位置：`server.js:460-491`
  - 结合大文件读取，易被用作 DoS 放大器

### 数据完整性
- [x] **修复导入时 announcements 丢失**
  - 位置：`server.js:425-458`
  - 导入逻辑完全遗漏了 `announcements` 字段

- [x] **修复课程数据结构零验证**
  - 位置：`server.js:216-222`
  - 仅校验 `typeof courses === 'object'`，允许传入数组、字符串等非法结构

- [x] **修复 NaN 校验绕过**
  - 位置：`server.js:26-34`
  - `typeof NaN === 'number'` 为 true，但 `NaN < 1` 和 `NaN > 300` 均为 false

- [x] **修复 totalPeriods 与 periodSettings 长度不一致**
  - 位置：`server.js:232-254`
  - 两者间无任何一致性校验

### 前端 Bug 修复
- [x] **修复 localStorage JSON 解析崩溃**
  - 位置：`index.html:1188-1196`
  - `JSON.parse` 未处理异常，存储损坏后公告弹窗无法关闭

- [x] **修复课程起止周次逻辑校验**
  - 位置：`index.html:998`
  - 未验证 `startWeek <= endWeek`，课程可能永久不可见

- [x] **修复 `URL.revokeObjectURL` 过早释放**
  - 位置：`index.html:1099-1100`
  - 导出后立即释放，移动端浏览器下载可能失败

- [ ] **修复 Array.prototype.at() 兼容性**
  - 位置：`index.html:574-660`
  - ES2022 特性，旧浏览器直接报错白屏

### 部署与配置
- [x] **移除未使用的 `jsdom` 依赖**
  - 位置：`package.json:11`
  - 增加攻击面和镜像体积

- [x] **添加 SIGINT 优雅关闭处理**
  - 位置：`server.js:556-560`
  - 仅监听 SIGTERM，Ctrl+C 时日志可能丢失

---

## P2 — 本月改进（规范化/可维护性）

### 代码风格与工程化
- [ ] **添加 ESLint + Prettier 配置**
  - 当前项目无任何代码格式化/静态检查配置

- [ ] **统一错误响应格式和语言**
  - 当前中英文混用，无错误码体系

- [ ] **统一 IP 提取逻辑**
  - `server.js` 中 IP 提取逻辑重复 3 次，且正则过于宽松

- [ ] **提取密码验证中间件**
  - 每个写操作路由重复相同的密码检查代码

- [ ] **拆分 `server.js` 路由模块**
  - 当前 560+ 行，耦合了配置、工具函数、中间件、所有路由

- [ ] **拆分 `index.html` 为独立文件**
  - 1376 行内联全部 CSS/JS，缓存效率低、协作冲突高

### Docker 与部署
- [ ] **为 Dockerfile 创建非 root 用户**
  - 当前容器以 root 运行 Node 进程

- [ ] **修复 Docker Compose 卷映射冲突**
  - `./data:/data` 与 `./logs:/data/logs` 同时挂载，语义混乱

- [ ] **统一 Docker Compose 命令兼容性**
  - `install.sh`/`manage.sh` 硬编码 `docker-compose`，新版 Docker 可能不存在

- [ ] **提取 Shell 脚本公共库**
  - 三个部署脚本共有约 80 行重复代码

- [ ] **更新 Dockerfile 废弃参数**
  - `--only=production` → `--omit=dev`

### 无障碍与体验
- [ ] **移除 viewport 缩放限制**
  - `maximum-scale=1.0, user-scalable=no` 违反 WCAG 2.1

- [ ] **为 Modal 添加 ARIA 属性与焦点管理**
  - 缺少 `role="dialog"`、`aria-modal`、ESC 键关闭

- [ ] **为 Toast 添加 aria-live 区域**
  - 屏幕阅读器无法感知动态通知

---

## 历史修复回归验证

| BUGFIX.md 编号 | 问题 | 验证结果 | 说明 |
|----------------|------|----------|------|
| #7 | 数据文件为空时 JSON.parse 报错 | ✅ 已修复 | |
| #8 | 数据文件损坏导致服务崩溃 | ✅ 已修复 | 备份后返回默认配置 |
| #9 | 保存数据时目录不存在 | ✅ 已修复 | |
| #10 | 日志文件路径遍历漏洞 | ✅ 已修复 | `resolvedPath.startsWith(resolvedLogDir + path.sep)` |
| #11 | 缺少全局错误处理中间件 | ✅ 已修复 | |
| #12 | 导出文件名编码问题 | ✅ 已修复 | |
| #20 | 课程 ID 生成冲突 | ⚠️ 后端未同步 | 后端仍用 `Date.now() + Math.random()` |

---

*本清单由自动化扫描生成，建议按优先级逐项修复并打勾确认。*
