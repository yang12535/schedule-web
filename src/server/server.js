const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || '/data/schedule.json';
const LOG_DIR = process.env.LOG_DIR || '/data/logs';

// 生成随机密码（6位数字）
function generatePassword() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 输入验证工具函数
function isValidDateString(str) {
  if (!str || typeof str !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str).getTime());
}

function isValidTimeString(str) {
  if (!str || typeof str !== 'string') return false;
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(str);
}

function isValidPeriodSettings(arr) {
  if (!Array.isArray(arr) || arr.length > 20) return false;
  for (const p of arr) {
    if (!isValidTimeString(p.startTime) || typeof p.duration !== 'number' || p.duration < 1 || p.duration > 300) {
      return false;
    }
  }
  return true;
}

// 内存级速率限制
const rateLimitStore = new Map();

function createRateLimiter(maxRequests, windowMs, keyFn) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const entry = rateLimitStore.get(key) || { count: 0, startTime: now };
    if (now - entry.startTime > windowMs) {
      entry.count = 1;
      entry.startTime = now;
    } else {
      entry.count++;
    }
    rateLimitStore.set(key, entry);
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests, please try again later' });
    }
    next();
  };
}

const strictRateLimit = createRateLimiter(10, 60 * 1000, req => {
  const ip = (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown').replace(/[\r\n]/g, '');
  return `${ip}:${req.path}`;
});

const generalRateLimit = createRateLimiter(200, 15 * 60 * 1000, req => {
  return (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown').replace(/[\r\n]/g, '');
});

// 保存日志到文件
const pendingLogs = new Set();

async function logToFile(message) {
  // 防御日志注入：将换行符替换为空格
  const safeMessage = String(message).replace(/[\r\n]/g, ' ');
  const promise = (async () => {
    try {
      await fs.mkdir(LOG_DIR, { recursive: true });
      const date = new Date();
      const dateStr = date.toISOString().split('T')[0];
      const logFile = path.join(LOG_DIR, `schedule-${dateStr}.log`);
      const timeStr = date.toLocaleString('zh-CN');
      const logLine = `[${timeStr}] ${safeMessage}\n`;
      await fs.appendFile(logFile, logLine);
    } catch (err) {
      console.error('日志写入失败:', err.message);
    }
  })();
  pendingLogs.add(promise);
  promise.finally(() => pendingLogs.delete(promise));
  return promise;
}

// Config
const CLASS_NAME = process.env.CLASS_NAME || '我的课表';
const CLASS_DESC = process.env.CLASS_DESC || '';
const EDIT_PASSWORD = process.env.EDIT_PASSWORD !== undefined ? process.env.EDIT_PASSWORD : generatePassword();
const SEMESTER_START = process.env.SEMESTER_START || `${new Date().getFullYear()}-03-01`;

const defaultPeriods = [
  {startTime:'08:00',duration:45},{startTime:'08:55',duration:45},{startTime:'10:00',duration:45},{startTime:'10:55',duration:45},
  {startTime:'14:00',duration:45},{startTime:'14:55',duration:45},{startTime:'16:00',duration:45},{startTime:'16:55',duration:45},
  {startTime:'19:00',duration:45},{startTime:'19:55',duration:45},{startTime:'20:50',duration:45},{startTime:'21:45',duration:45}
];

const defaultSchedule = {
  name: CLASS_NAME, description: CLASS_DESC, semesterStart: SEMESTER_START,
  updatedAt: new Date().toISOString(), totalPeriods: 12, totalWeeks: 16,
  periodSettings: defaultPeriods,
  courses: {monday:[],tuesday:[],wednesday:[],thursday:[],friday:[]},
  announcements: []
};

let scheduleCache = null;
let saveLock = Promise.resolve();

app.use(express.json());

// 静态文件路径 - 支持两种部署方式
const publicPath = process.env.PUBLIC_PATH || path.join(__dirname, 'public');
app.use(express.static(publicPath));

// 安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// 通用速率限制
app.use(generalRateLimit);

// 请求日志中间件
app.use((req, res, next) => {
  let ip = req.socket.remoteAddress || 'unknown';
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') {
    const firstIp = forwarded.split(',')[0].trim().replace(/[\r\n]/g, '');
    if (/^[\d.a-fA-F:]+$/.test(firstIp)) {
      ip = firstIp;
    }
  }
  logToFile(`${req.method} ${req.url} - IP: ${ip}`);
  next();
});

async function loadSchedule() {
  if (scheduleCache !== null) {
    return scheduleCache;
  }
  try {
    const content = await fs.readFile(DATA_FILE, 'utf8');
    if (!content || content.trim() === '') {
      console.log('数据文件为空，使用默认配置');
      scheduleCache = {...defaultSchedule};
      return scheduleCache;
    }
    const data = JSON.parse(content);
    scheduleCache = {...defaultSchedule, ...data, periodSettings: data.periodSettings || defaultPeriods};
    return scheduleCache;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('数据文件不存在，使用默认配置');
      scheduleCache = {...defaultSchedule};
      return scheduleCache;
    } else if (err instanceof SyntaxError) {
      console.error('数据文件格式错误:', err.message);
      await logToFile(`数据文件格式错误: ${err.message}`);
      const backupFile = `${DATA_FILE}.corrupted.${Date.now()}`;
      try {
        await fs.rename(DATA_FILE, backupFile);
        console.log(`已备份损坏文件到: ${backupFile}`);
      } catch (backupErr) {
        console.error('备份损坏文件失败:', backupErr.message);
      }
      throw err;
    } else {
      console.error('加载数据失败:', err.message);
      throw err;
    }
  }
}

async function saveSchedule(data) {
  const next = saveLock.then(async () => {
    const tempFile = `${DATA_FILE}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    try {
      // 确保目录存在
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
      await fs.rename(tempFile, DATA_FILE);
      scheduleCache = data;
    } catch (err) {
      // 清理 rename 失败时残留的临时文件；若文件不存在则静默忽略
      try { await fs.unlink(tempFile); } catch (e) { if (e.code !== 'ENOENT') console.error('清理临时文件失败:', e.message); }
      console.error('保存数据失败:', err.message);
      throw err;
    }
  });
  saveLock = next.catch(err => {
    console.error('Save lock chain error:', err.message);
  });
  return next;
}

app.get('/api/schedule', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    res.json(schedule);
  } catch (err) {
    console.error('加载课表失败:', err);
    res.status(500).json({error:'Failed to load'});
  }
});

app.put('/api/schedule/courses', strictRateLimit, async (req, res) => {
  try {
    const {password, courses} = req.body;
    if (EDIT_PASSWORD && password !== EDIT_PASSWORD) {
      await logToFile(`密码错误尝试 - 课程更新`);
      return res.status(403).json({error:'密码错误'});
    }
    
    // 验证 courses 数据结构
    if (!courses || typeof courses !== 'object') {
      return res.status(400).json({error:'Invalid courses data'});
    }
    
    const schedule = await loadSchedule();
    schedule.courses = courses;
    schedule.updatedAt = new Date().toISOString();
    await saveSchedule(schedule);
    await logToFile(`课程数据已更新`);
    res.json({success:true});
  } catch (err) {
    console.error('保存课程失败:', err);
    res.status(500).json({error:'Failed to save'});
  }
});

app.put('/api/schedule/settings', strictRateLimit, async (req, res) => {
  try {
    const {password, name, description, semesterStart, totalPeriods, totalWeeks, periodSettings} = req.body;
    if (EDIT_PASSWORD && password !== EDIT_PASSWORD) {
      await logToFile(`密码错误尝试 - 设置更新`);
      return res.status(403).json({error:'密码错误'});
    }
    const schedule = await loadSchedule();
    if (name !== undefined) schedule.name = String(name).slice(0, 100);
    if (description !== undefined) schedule.description = String(description).slice(0, 200);
    if (semesterStart && isValidDateString(semesterStart)) schedule.semesterStart = semesterStart;
    if (Number.isInteger(totalPeriods) && totalPeriods >= 1 && totalPeriods <= 20) {
      schedule.totalPeriods = totalPeriods;
      if (periodSettings === undefined && Array.isArray(schedule.periodSettings)) {
        if (schedule.periodSettings.length > totalPeriods) {
          schedule.periodSettings = schedule.periodSettings.slice(0, totalPeriods);
        } else if (schedule.periodSettings.length < totalPeriods) {
          const fallback = defaultPeriods[defaultPeriods.length - 1];
          for (let i = schedule.periodSettings.length; i < totalPeriods; i++) {
            schedule.periodSettings.push({ ...(defaultPeriods[i] || fallback) });
          }
        }
      }
    }
    if (Number.isInteger(totalWeeks) && totalWeeks >= 1 && totalWeeks <= 30) schedule.totalWeeks = totalWeeks;
    if (periodSettings && isValidPeriodSettings(periodSettings)) schedule.periodSettings = periodSettings;
    schedule.updatedAt = new Date().toISOString();
    await saveSchedule(schedule);
    await logToFile(`设置已更新: ${name || schedule.name}`);
    res.json({success:true});
  } catch (err) {
    console.error('保存设置失败:', err);
    res.status(500).json({error:'Failed to save'});
  }
});

app.post('/api/verify', strictRateLimit, async (req, res) => {
  try {
    const {password} = req.body;
    const valid = !EDIT_PASSWORD || password === EDIT_PASSWORD;
    if (!valid) await logToFile(`密码验证失败`);
    res.json({valid, requirePassword:!!EDIT_PASSWORD, name:CLASS_NAME, description:CLASS_DESC});
  } catch (err) {
    console.error('验证密码失败:', err);
    res.status(500).json({error:'Verification failed'});
  }
});

// 获取当前有效的公告列表
function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

app.get('/api/announcements/active', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    const today = formatLocalDate(new Date());
    const active = (schedule.announcements || []).filter(a => {
      if (a.enabled === false) return false;
      if (a.startDate && today < a.startDate) return false;
      if (a.endDate && today > a.endDate) return false;
      return true;
    });
    res.json({announcements: active});
  } catch (err) {
    console.error('获取公告失败:', err);
    res.status(500).json({error:'Failed to load announcements'});
  }
});

// 获取所有公告（管理用）
app.get('/api/announcements', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    res.json({announcements: schedule.announcements || []});
  } catch (err) {
    console.error('获取公告失败:', err);
    res.status(500).json({error:'Failed to load announcements'});
  }
});

// 添加/更新公告
app.post('/api/announcements', strictRateLimit, async (req, res) => {
  try {
    const {password, announcement} = req.body;
    if (EDIT_PASSWORD && password !== EDIT_PASSWORD) {
      await logToFile(`密码错误尝试 - 公告更新`);
      return res.status(403).json({error:'密码错误'});
    }
    if (!announcement || typeof announcement !== 'object' || !announcement.title || !announcement.content) {
      return res.status(400).json({error:'标题和内容不能为空'});
    }
    if (announcement.startDate && !isValidDateString(announcement.startDate)) {
      return res.status(400).json({error:'Invalid startDate format'});
    }
    if (announcement.endDate && !isValidDateString(announcement.endDate)) {
      return res.status(400).json({error:'Invalid endDate format'});
    }
    const schedule = await loadSchedule();
    if (!schedule.announcements) schedule.announcements = [];
    if (announcement.id) {
      const idx = schedule.announcements.findIndex(a => a.id === announcement.id);
      if (idx >= 0) {
        schedule.announcements[idx] = {...schedule.announcements[idx], ...announcement};
      } else {
        schedule.announcements.push(announcement);
      }
    } else {
      announcement.id = Date.now().toString() + Math.random().toString(36).slice(2, 5);
      schedule.announcements.push(announcement);
    }
    schedule.updatedAt = new Date().toISOString();
    await saveSchedule(schedule);
    await logToFile(`公告已更新: ${announcement.title}`);
    res.json({success:true, announcement});
  } catch (err) {
    console.error('保存公告失败:', err);
    res.status(500).json({error:'Failed to save announcement'});
  }
});

// 删除公告
app.delete('/api/announcements/:id', strictRateLimit, async (req, res) => {
  try {
    const {password} = req.body;
    if (EDIT_PASSWORD && password !== EDIT_PASSWORD) {
      await logToFile(`密码错误尝试 - 公告删除`);
      return res.status(403).json({error:'密码错误'});
    }
    const id = req.params.id;
    const schedule = await loadSchedule();
    if (!schedule.announcements) schedule.announcements = [];
    const beforeLen = schedule.announcements.length;
    schedule.announcements = schedule.announcements.filter(a => a.id !== id);
    if (schedule.announcements.length === beforeLen) {
      return res.status(404).json({error:'Announcement not found'});
    }
    schedule.updatedAt = new Date().toISOString();
    await saveSchedule(schedule);
    await logToFile(`公告已删除: ${id}`);
    res.json({success:true});
  } catch (err) {
    console.error('删除公告失败:', err);
    res.status(500).json({error:'Failed to delete announcement'});
  }
});

app.get('/api/export', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    await logToFile(`数据导出`);
    res.setHeader('Content-Type','application/json');
    res.setHeader('Content-Disposition',`attachment; filename="${encodeURIComponent(schedule.name)}_课表.json"`);
    res.json({...schedule, exportDate:new Date().toISOString()});
  } catch (err) {
    console.error('导出失败:', err);
    res.status(500).json({error:'Export failed'});
  }
});

// 旧课表数据兼容性处理
function migrateOldData(data) {
  if (!data || typeof data !== 'object') {
    return { ...defaultSchedule };
  }
  
  const migrated = { ...data };
  
  // 兼容旧版本 courses 结构（数组 vs 对象）
  if (Array.isArray(data.courses)) {
    // 旧格式：courses 是数组
    migrated.courses = {
      monday: [], tuesday: [], wednesday: [], thursday: [], friday: []
    };
    data.courses.forEach(course => {
      const day = course.day || 'monday';
      if (migrated.courses[day]) {
        migrated.courses[day].push({
          id: course.id || Date.now().toString() + Math.random().toString(36).substr(2, 5),
          name: course.name || course.title || '未命名课程',
          period: course.period || course.time || '1',
          location: course.location || course.room || '',
          teacher: course.teacher || course.instructor || '',
          day: day,
          startWeek: course.startWeek || 1,
          endWeek: course.endWeek || 16,
          weekType: course.weekType || 'all',
          type: course.type || ''
        });
      }
    });
  }
  
  // 兼容旧字段名
  if (data.title && !data.name) migrated.name = data.title;
  if (data.room && !data.location) migrated.location = data.room;
  if (data.instructor && !data.teacher) migrated.teacher = data.instructor;
  if (data.time && !data.period) migrated.period = data.time;
  
  return migrated;
}

app.post('/api/import', strictRateLimit, async (req, res) => {
  try {
    const {password, data} = req.body;
    if (EDIT_PASSWORD && password !== EDIT_PASSWORD) {
      await logToFile(`密码错误尝试 - 数据导入`);
      return res.status(403).json({error:'密码错误'});
    }
    if (!data || typeof data !== 'object') {
      return res.status(400).json({error:'Invalid data format'});
    }
    if (!data.courses) {
      return res.status(400).json({error:'Invalid format: missing courses'});
    }
    
    // 数据迁移（兼容旧格式）
    const migratedData = migrateOldData(data);
    
    const schedule = await loadSchedule();
    schedule.courses = migratedData.courses;
    if (migratedData.semesterStart && isValidDateString(migratedData.semesterStart)) schedule.semesterStart = migratedData.semesterStart;
    if (migratedData.name) schedule.name = String(migratedData.name).slice(0, 100);
    if (migratedData.description !== undefined) schedule.description = String(migratedData.description).slice(0, 200);
    if (Number.isInteger(migratedData.totalPeriods) && migratedData.totalPeriods >= 1 && migratedData.totalPeriods <= 20) schedule.totalPeriods = migratedData.totalPeriods;
    if (Number.isInteger(migratedData.totalWeeks) && migratedData.totalWeeks >= 1 && migratedData.totalWeeks <= 30) schedule.totalWeeks = migratedData.totalWeeks;
    if (migratedData.periodSettings && isValidPeriodSettings(migratedData.periodSettings)) schedule.periodSettings = migratedData.periodSettings;
    schedule.updatedAt = new Date().toISOString();
    await saveSchedule(schedule);
    await logToFile(`数据导入成功`);
    res.json({success:true, schedule});
  } catch (err) { 
    console.error('Import error:', err);
    res.status(500).json({error:'Import failed'}); 
  }
});

app.get('/api/logs', async (req, res) => {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const files = await fs.readdir(LOG_DIR);
    const logs = files.filter(f => f.endsWith('.log')).sort().reverse();
    res.json({logs});
  } catch (err) {
    console.error('读取日志列表失败:', err);
    res.status(500).json({error:'Failed to read logs'});
  }
});

app.get('/api/logs/:file', async (req, res) => {
  try {
    const file = req.params.file;
    if (!file.match(/^schedule-\d{4}-\d{2}-\d{2}\.log$/)) {
      return res.status(400).json({error:'Invalid filename'});
    }
    const filePath = path.join(LOG_DIR, file);
    // 防止目录遍历攻击
    const resolvedPath = path.resolve(filePath);
    const resolvedLogDir = path.resolve(LOG_DIR);
    if (!resolvedPath.startsWith(resolvedLogDir)) {
      return res.status(403).json({error:'Access denied'});
    }
    const content = await fs.readFile(filePath, 'utf8');
    res.type('text/plain').send(content);
  } catch (err) {
    console.error('读取日志失败:', err);
    res.status(404).json({error:'Log not found'});
  }
});

// 统一处理未匹配的 API 路由，返回 JSON 404
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API not found' });
});

// SPA fallback - 使用 PUBLIC_PATH
app.get('*', (req, res) => {
  const indexPath = path.join(publicPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('发送 index.html 失败:', err);
      res.status(500).send('Server Error');
    }
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('未处理的错误:', err);
  res.status(500).json({error:'Internal server error'});
});

async function init() {
  try {
    await fs.mkdir(path.dirname(DATA_FILE), {recursive:true});
    await fs.mkdir(LOG_DIR, {recursive:true});
    try { 
      await fs.access(DATA_FILE); 
    } catch { 
      console.log('初始化数据文件...');
      await saveSchedule(defaultSchedule); 
    }
    // 启动时加载数据到缓存
    await loadSchedule();
  } catch (err) { 
    console.error('Init error:', err);
    // 不抛出错误，让服务继续启动
  }
}

init().then(() => {
  app.listen(PORT, () => {
    const banner = `
========================================
📚 班级课表服务已启动
========================================
班级名称: ${CLASS_NAME}
访问地址: http://localhost:${PORT}
数据文件: ${DATA_FILE}
日志目录: ${LOG_DIR}
静态文件: ${publicPath}
----------------------------------------
${EDIT_PASSWORD ? '🔒 编辑密码: 已设置' : '🔓 编辑模式: 无需密码'}
========================================
    `;
    console.log(banner);
    logToFile(`服务启动 - 班级: ${CLASS_NAME}, 密码状态: ${EDIT_PASSWORD ? '已设置' : '无'}`);
  });
}).catch(err => {
  console.error('服务启动失败:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('收到 SIGTERM，等待日志写入完成...');
  await Promise.all(pendingLogs);
  process.exit(0);
});
