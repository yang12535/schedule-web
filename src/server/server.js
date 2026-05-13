const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || '/data/schedule.json';
const LOG_DIR = process.env.LOG_DIR || '/data/logs';

// 生成随机密码（6位数字）
function generatePassword() {
  return crypto.randomInt(100000, 1000000).toString();
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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
    if (!p || typeof p !== 'object') return false;
    if (!isValidTimeString(p.startTime) || !Number.isInteger(p.duration) || p.duration < 1 || p.duration > 300) {
      return false;
    }
  }
  return true;
}

function isValidCourse(course) {
  if (!course || typeof course !== 'object') return false;
  if (typeof course.name !== 'string' || !course.name.trim() || course.name.length > 100) return false;
  if (course.location !== undefined && course.location !== null && (typeof course.location !== 'string' || course.location.length > 100)) return false;
  if (course.teacher !== undefined && course.teacher !== null && (typeof course.teacher !== 'string' || course.teacher.length > 50)) return false;
  if (typeof course.period !== 'string' || !course.period.trim() || course.period.length > 20) return false;
  if (course.type !== undefined && course.type !== null && typeof course.type !== 'string') return false;
  return true;
}

function isValidCourses(courses) {
  if (!courses || typeof courses !== 'object' || Array.isArray(courses)) return false;
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  for (const day of days) {
    if (!Array.isArray(courses[day])) return false;
    for (const course of courses[day]) {
      if (!isValidCourse(course)) return false;
    }
  }
  return true;
}

function isValidAnnouncement(a) {
  if (!a || typeof a !== 'object') return false;
  if (typeof a.title !== 'string' || !a.title.trim() || a.title.length > 100) return false;
  if (typeof a.content !== 'string' || !a.content.trim() || a.content.length > 2000) return false;
  if (a.startDate && !isValidDateString(a.startDate)) return false;
  if (a.endDate && !isValidDateString(a.endDate)) return false;
  return true;
}

// 内存级速率限制
const rateLimitStore = new Map();

// TTL 清理：每5分钟清理过期的限流记录（测试环境禁用，避免 Jest open handles）
let rateLimitCleanupInterval = null;
if (process.env.NODE_ENV !== 'test') {
  rateLimitCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore) {
      if (now > entry.expiresAt) {
        rateLimitStore.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  rateLimitCleanupInterval.unref();
}

function createRateLimiter(maxRequests, windowMs, keyFn) {
  // 测试环境跳过限流，避免测试被误拦截
  if (process.env.NODE_ENV === 'test') {
    return (req, res, next) => next();
  }
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const entry = rateLimitStore.get(key) || { count: 0, startTime: now, expiresAt: now + windowMs };
    if (now - entry.startTime > windowMs) {
      entry.count = 1;
      entry.startTime = now;
      entry.expiresAt = now + windowMs;
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

function getClientIp(req) {
  let ip = req.socket.remoteAddress || 'unknown';
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
      const firstIp = forwarded.split(',')[0].trim().replace(/[\r\n]/g, '');
      if (/^[\d.a-fA-F:]+$/.test(firstIp)) {
        ip = firstIp;
      }
    }
  }
  return ip.replace(/[\r\n]/g, '');
}

const strictRateLimit = createRateLimiter(10, 60 * 1000, req => {
  return `${getClientIp(req)}:${req.path}`;
});

const generalRateLimit = createRateLimiter(200, 15 * 60 * 1000, req => {
  return getClientIp(req);
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
const EDIT_PASSWORD = process.env.EDIT_PASSWORD ? process.env.EDIT_PASSWORD : generatePassword();
const SEMESTER_START = process.env.SEMESTER_START || `${new Date().getFullYear()}-03-01`;
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

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

function createDefaultSchedule() {
  return JSON.parse(JSON.stringify(defaultSchedule));
}

let scheduleCache = null;

app.use(express.json({ limit: '1mb' }));

// 轻量健康检查端点（不写日志、不限流，供 Docker/K8s 使用）
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

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

function sanitizeUrl(url) {
  return String(url).replace(/([?&])(password|token|secret|api_key)=([^&]*)/gi, '$1$2=***');
}

// 请求日志中间件
app.use((req, res, next) => {
  const ip = getClientIp(req);
  logToFile(`${req.method} ${sanitizeUrl(req.url)} - IP: ${ip}`);
  next();
});

// 写锁：将 load → modify → save 串行化
let saveLock = Promise.resolve();
function withSaveLock(fn) {
  const next = saveLock.then(async () => {
    return await fn();
  });
  saveLock = next.catch(() => {});
  return next;
}

async function loadSchedule() {
  if (scheduleCache !== null) {
    return scheduleCache;
  }
  try {
    const content = await fs.readFile(DATA_FILE, 'utf8');
    if (!content || content.trim() === '') {
      console.log('数据文件为空，使用默认配置');
      scheduleCache = createDefaultSchedule();
      return scheduleCache;
    }
    const data = JSON.parse(content);
    scheduleCache = {...createDefaultSchedule(), ...data, periodSettings: data.periodSettings || JSON.parse(JSON.stringify(defaultPeriods))};
    return scheduleCache;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('数据文件不存在，使用默认配置');
      scheduleCache = createDefaultSchedule();
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
      scheduleCache = createDefaultSchedule();
      return scheduleCache;
    } else {
      console.error('加载数据失败:', err.message);
      throw err;
    }
  }
}

async function saveSchedule(data) {
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
    if (!isValidCourses(courses)) {
      return res.status(400).json({error:'Invalid courses data'});
    }
    
    await withSaveLock(async () => {
      const schedule = await loadSchedule();
      const newSchedule = JSON.parse(JSON.stringify(schedule));
      newSchedule.courses = courses;
      newSchedule.updatedAt = new Date().toISOString();
      await saveSchedule(newSchedule);
    });
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
    const updatedName = await withSaveLock(async () => {
      const schedule = await loadSchedule();
      const newSchedule = JSON.parse(JSON.stringify(schedule));
      const newTotalPeriods = Number.isInteger(totalPeriods) && totalPeriods >= 1 && totalPeriods <= 20 ? totalPeriods : newSchedule.totalPeriods;
      if (periodSettings) {
        if (!isValidPeriodSettings(periodSettings)) {
          throw new HttpError(400, 'Invalid periodSettings');
        }
        if (periodSettings.length !== newTotalPeriods) {
          throw new HttpError(400, 'periodSettings length does not match totalPeriods');
        }
        newSchedule.periodSettings = periodSettings;
      }
      if (name !== undefined) newSchedule.name = String(name).slice(0, 100);
      if (description !== undefined) newSchedule.description = String(description).slice(0, 200);
      if (semesterStart && isValidDateString(semesterStart)) newSchedule.semesterStart = semesterStart;
      if (Number.isInteger(totalPeriods) && totalPeriods >= 1 && totalPeriods <= 20) newSchedule.totalPeriods = totalPeriods;
      if (Number.isInteger(totalWeeks) && totalWeeks >= 1 && totalWeeks <= 30) newSchedule.totalWeeks = totalWeeks;
      if (newSchedule.periodSettings.length !== newSchedule.totalPeriods) {
        throw new HttpError(400, 'periodSettings length does not match totalPeriods');
      }
      newSchedule.updatedAt = new Date().toISOString();
      await saveSchedule(newSchedule);
      return newSchedule.name;
    });
    await logToFile(`设置已更新: ${name || updatedName}`);
    res.json({success:true});
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({error: err.message});
    }
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
    if (!isValidAnnouncement(announcement)) {
      return res.status(400).json({error:'标题或内容格式不正确'});
    }
    const normalizedId = announcement.id && typeof announcement.id === 'string' ? announcement.id.trim() : null;
    const sanitizedAnnouncement = {
      id: normalizedId && normalizedId.length <= 50
        ? normalizedId
        : Date.now().toString() + crypto.randomBytes(4).toString('hex'),
      title: announcement.title,
      content: announcement.content,
      startDate: announcement.startDate || null,
      endDate: announcement.endDate || null,
      enabled: announcement.enabled !== false
    };
    await withSaveLock(async () => {
      const schedule = await loadSchedule();
      const newSchedule = JSON.parse(JSON.stringify(schedule));
      if (!newSchedule.announcements) newSchedule.announcements = [];
      if (normalizedId) {
        const idx = newSchedule.announcements.findIndex(a => a.id === normalizedId);
        if (idx >= 0) {
          newSchedule.announcements[idx] = sanitizedAnnouncement;
        } else {
          newSchedule.announcements.push(sanitizedAnnouncement);
        }
      } else {
        newSchedule.announcements.push(sanitizedAnnouncement);
      }
      newSchedule.updatedAt = new Date().toISOString();
      await saveSchedule(newSchedule);
    });
    await logToFile(`公告已更新: ${sanitizedAnnouncement.title}`);
    res.json({success:true, announcement: sanitizedAnnouncement});
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
    await withSaveLock(async () => {
      const schedule = await loadSchedule();
      const newSchedule = JSON.parse(JSON.stringify(schedule));
      if (!newSchedule.announcements) newSchedule.announcements = [];
      const beforeLen = newSchedule.announcements.length;
      newSchedule.announcements = newSchedule.announcements.filter(a => a.id !== id);
      if (newSchedule.announcements.length === beforeLen) {
        throw new HttpError(404, 'Announcement not found');
      }
      newSchedule.updatedAt = new Date().toISOString();
      await saveSchedule(newSchedule);
    });
    await logToFile(`公告已删除: ${id}`);
    res.json({success:true});
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({error: err.message});
    }
    console.error('删除公告失败:', err);
    res.status(500).json({error:'Failed to delete announcement'});
  }
});

app.get('/api/export', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    await logToFile(`数据导出`);
    res.setHeader('Content-Type','application/json');
    const filename = `${schedule.name}_课表.json`;
    // RFC 5987: encodeURIComponent 不编码 *!'()，这些字符在 attr-char 中不安全，需额外转义
    const encoded = encodeURIComponent(filename)
      .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    const asciiFallback = 'schedule_export.json';
    res.setHeader('Content-Disposition',`attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`);
    res.json({...schedule, exportDate:new Date().toISOString()});
  } catch (err) {
    console.error('导出失败:', err);
    res.status(500).json({error:'Export failed'});
  }
});

// 旧课表数据兼容性处理
function migrateOldData(data) {
  if (!data || typeof data !== 'object') {
    return createDefaultSchedule();
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
          id: course.id || Date.now().toString() + crypto.randomBytes(4).toString('hex'),
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
    
    await withSaveLock(async () => {
      const schedule = await loadSchedule();
      const newSchedule = JSON.parse(JSON.stringify(schedule));
      const newTotalPeriods = Number.isInteger(migratedData.totalPeriods) && migratedData.totalPeriods >= 1 && migratedData.totalPeriods <= 20 ? migratedData.totalPeriods : newSchedule.totalPeriods;
      if (migratedData.periodSettings) {
        if (!isValidPeriodSettings(migratedData.periodSettings)) {
          throw new HttpError(400, 'Invalid periodSettings');
        }
        if (migratedData.periodSettings.length !== newTotalPeriods) {
          throw new HttpError(400, 'periodSettings length does not match totalPeriods');
        }
        newSchedule.periodSettings = migratedData.periodSettings;
      }
      if (!isValidCourses(migratedData.courses)) {
        throw new HttpError(400, 'Invalid courses structure');
      }
      newSchedule.courses = migratedData.courses;
      if (migratedData.semesterStart && isValidDateString(migratedData.semesterStart)) newSchedule.semesterStart = migratedData.semesterStart;
      if (migratedData.name) newSchedule.name = String(migratedData.name).slice(0, 100);
      if (migratedData.description !== undefined) newSchedule.description = String(migratedData.description).slice(0, 200);
      if (Number.isInteger(migratedData.totalPeriods) && migratedData.totalPeriods >= 1 && migratedData.totalPeriods <= 20) newSchedule.totalPeriods = migratedData.totalPeriods;
      if (Number.isInteger(migratedData.totalWeeks) && migratedData.totalWeeks >= 1 && migratedData.totalWeeks <= 30) newSchedule.totalWeeks = migratedData.totalWeeks;
      if (newSchedule.periodSettings.length !== newSchedule.totalPeriods) {
        throw new HttpError(400, 'periodSettings length does not match totalPeriods');
      }
      if (Array.isArray(migratedData.announcements)) {
        newSchedule.announcements = migratedData.announcements.filter(isValidAnnouncement).map(a => ({
          id: (typeof a.id === 'string' && a.id.trim()) ? a.id.trim() : Date.now().toString() + crypto.randomBytes(4).toString('hex'),
          title: a.title,
          content: a.content,
          startDate: a.startDate || null,
          endDate: a.endDate || null,
          enabled: typeof a.enabled === 'boolean' ? a.enabled : true
        }));
      }
      newSchedule.updatedAt = new Date().toISOString();
      await saveSchedule(newSchedule);
    });
    await logToFile(`数据导入成功`);
    const resultSchedule = await loadSchedule();
    res.json({success:true, schedule: resultSchedule});
  } catch (err) { 
    if (err.status === 400) {
      return res.status(400).json({error: err.message});
    }
    console.error('Import error:', err);
    res.status(500).json({error:'Import failed'}); 
  }
});

// 日志接口认证中间件（仅允许 header 传参，防止密码写入 URL 日志）
function requireLogAuth(req, res, next) {
  const rawPassword = req.headers['x-password'];
  const password = Array.isArray(rawPassword) ? rawPassword[0] : (rawPassword || '');
  if (EDIT_PASSWORD && password !== EDIT_PASSWORD) {
    return res.status(403).json({error:'Access denied'});
  }
  next();
}

app.get('/api/logs', strictRateLimit, requireLogAuth, async (req, res) => {
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

app.get('/api/logs/:file', strictRateLimit, requireLogAuth, async (req, res) => {
  try {
    const file = req.params.file;
    if (!file.match(/^schedule-\d{4}-\d{2}-\d{2}\.log$/)) {
      return res.status(400).json({error:'Invalid filename'});
    }
    const filePath = path.join(LOG_DIR, file);
    // 防止目录遍历攻击
    const resolvedPath = path.resolve(filePath);
    const resolvedLogDir = path.resolve(LOG_DIR);
    if (!resolvedPath.startsWith(resolvedLogDir + path.sep)) {
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
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({error:'Request entity too large'});
  }
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
      await saveSchedule(createDefaultSchedule()); 
    }
    // 启动时加载数据到缓存
    await loadSchedule();
  } catch (err) { 
    console.error('Init error:', err);
    // 不抛出错误，让服务继续启动
  }
}

// 导出供测试使用
module.exports = { app, init };

if (require.main === module) {
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
      if (!process.env.EDIT_PASSWORD && EDIT_PASSWORD) {
        if (process.env.PRINT_EDIT_PASSWORD === 'true') {
          console.log(`🔑 自动生成的编辑密码: ${EDIT_PASSWORD}`);
        } else {
          console.log('🔑 编辑密码已自动生成（设置 PRINT_EDIT_PASSWORD=true 可在日志中查看）');
        }
      }
      logToFile(`服务启动 - 班级: ${CLASS_NAME}, 密码状态: ${EDIT_PASSWORD ? '已设置' : '无'}`);
    });
  }).catch(err => {
    console.error('服务启动失败:', err);
    process.exit(1);
  });

  process.on('SIGTERM', async () => {
    console.log('收到 SIGTERM，等待日志写入完成...');
    if (rateLimitCleanupInterval) clearInterval(rateLimitCleanupInterval);
    await Promise.all(pendingLogs);
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('收到 SIGINT，等待日志写入完成...');
    if (rateLimitCleanupInterval) clearInterval(rateLimitCleanupInterval);
    await Promise.all(pendingLogs);
    process.exit(0);
  });
}
