const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// 与前端共用的 UMD 工具模块；仓库布局（src/server + src/public）与
// Docker 镜像布局（/app/server.js + /app/public）不同，做双路径回退。
let ScheduleDateUtils, ScheduleHolidays;
try {
  ScheduleDateUtils = require('./public/js/date-utils');
  ScheduleHolidays = require('./public/js/holidays');
} catch (err) {
  ScheduleDateUtils = require('../public/js/date-utils');
  ScheduleHolidays = require('../public/js/holidays');
}

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || '/data/schedule.json';
const LOG_DIR = process.env.LOG_DIR || '/data/logs';

// 生成随机密码（6位数字）
function generatePassword() {
  return crypto.randomInt(100000, 1000000).toString();
}

const AUTO_GENERATE_PASSWORD_VALUE = '__AUTO_GENERATE__';

function resolveEditPassword(env = process.env) {
  const isSet = Object.prototype.hasOwnProperty.call(env, 'EDIT_PASSWORD');
  if (!isSet || env.EDIT_PASSWORD === AUTO_GENERATE_PASSWORD_VALUE) {
    return { value: generatePassword(), generated: true };
  }
  return { value: env.EDIT_PASSWORD, generated: false };
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
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(year);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
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
  if (course.skipWeek !== undefined && course.skipWeek !== null && (!Number.isInteger(course.skipWeek) || course.skipWeek < 1 || course.skipWeek > 30)) return false;
  if (course.startWeek !== undefined && course.startWeek !== null && (!Number.isInteger(course.startWeek) || course.startWeek < 1 || course.startWeek > 30)) return false;
  if (course.endWeek !== undefined && course.endWeek !== null && (!Number.isInteger(course.endWeek) || course.endWeek < 1 || course.endWeek > 30)) return false;
  if (course.startWeek !== undefined && course.startWeek !== null && course.endWeek !== undefined && course.endWeek !== null && course.startWeek > course.endWeek) return false;
  if (course.weekType !== undefined && course.weekType !== null && !['all', 'odd', 'even'].includes(course.weekType)) return false;
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

// ===== 调休补课日（「班」日）校验 =====
const MAKEUP_WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

function isValidMakeupDay(day) {
  if (!day || typeof day !== 'object' || Array.isArray(day)) return false;
  if (typeof day.id !== 'string' || !day.id.trim() || day.id.length > 50) return false;
  if (!isValidDateString(day.date)) return false;
  if (day.name !== undefined && day.name !== null && (typeof day.name !== 'string' || day.name.length > 50)) return false;
  if (!['pending', 'confirmed'].includes(day.status)) return false;
  if (day.copyFrom !== undefined && day.copyFrom !== null && !MAKEUP_WEEKDAYS.includes(day.copyFrom)) return false;
  if (!Array.isArray(day.courses) || day.courses.length > 20) return false;
  for (const course of day.courses) {
    if (!isValidCourse(course)) return false;
  }
  return true;
}

function isValidMakeupDays(arr) {
  if (!Array.isArray(arr) || arr.length > 50) return false;
  return arr.every(isValidMakeupDay);
}

function parsePositivePeriodNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function getMaxPeriodNumber(period) {
  if (!period || typeof period !== 'string') return 0;
  const normalized = period.replace(/[第节]/g, '').trim();
  if (normalized.includes('-')) {
    const parts = normalized.split('-').map(part => part.trim());
    if (parts.length === 2) {
      const start = parsePositivePeriodNumber(parts[0]);
      const end = parsePositivePeriodNumber(parts[1]);
      if (start > 0 && end > 0 && start <= end) return end;
    }
    return 0;
  }
  if (normalized.includes(',')) {
    return normalized.split(',').reduce((max, part) => {
      const number = parsePositivePeriodNumber(part.trim());
      return number > max ? number : max;
    }, 0);
  }
  return parsePositivePeriodNumber(normalized);
}

function getMaxCoursePeriod(courses) {
  if (!courses || typeof courses !== 'object') return 0;
  let max = 0;
  for (const list of Object.values(courses)) {
    if (!Array.isArray(list)) continue;
    for (const course of list) {
      const period = getMaxPeriodNumber(course && course.period);
      if (period > max) max = period;
    }
  }
  return max;
}

function isValidAnnouncement(a) {
  if (!a || typeof a !== 'object') return false;
  if (typeof a.title !== 'string' || !a.title.trim() || a.title.length > 100) return false;
  if (typeof a.content !== 'string' || !a.content.trim() || a.content.length > 2000) return false;
  if (a.startDate && !isValidDateString(a.startDate)) return false;
  if (a.endDate && !isValidDateString(a.endDate)) return false;
  if (a.startDate && a.endDate && a.startDate > a.endDate) return false;
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
const EDIT_PASSWORD_CONFIG = resolveEditPassword();
const EDIT_PASSWORD = EDIT_PASSWORD_CONFIG.value;
const SEMESTER_START = process.env.SEMESTER_START || `${new Date().getFullYear()}-03-01`;
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const ICP_NUMBER = process.env.ICP_NUMBER || '';
const READONLY_PORT = Number(process.env.READONLY_PORT) || 0;

// 只读端口与主端口必须不同：同进程同端口二次 listen 会 EADDRINUSE 崩掉整个服务。
// 无效配置（超出端口范围 / 与主端口相同）打日志并跳过只读监听，返回 0。
function resolveReadonlyListenPort(readonlyPort, mainPort) {
  const port = Number(readonlyPort);
  if (!Number.isInteger(port) || port <= 0) return 0; // 未配置，不启用
  if (port > 65535 || port === Number(mainPort)) {
    console.warn(`READONLY_PORT=${readonlyPort} 无效（需为 1-65535 且与主端口 ${mainPort} 不同），跳过只读入口`);
    return 0;
  }
  return port;
}

const defaultPeriods = [
  {startTime:'08:00',duration:45},{startTime:'08:55',duration:45},{startTime:'10:00',duration:45},{startTime:'10:55',duration:45},
  {startTime:'14:00',duration:45},{startTime:'14:55',duration:45},{startTime:'16:00',duration:45},{startTime:'16:55',duration:45},
  {startTime:'19:00',duration:45},{startTime:'19:55',duration:45},{startTime:'20:50',duration:45},{startTime:'21:45',duration:45}
];

function formatClockTime(minutes) {
  const minutesInDay = 24 * 60;
  const normalized = ((minutes % minutesInDay) + minutesInDay) % minutesInDay;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function resizePeriodSettings(settings, count) {
  const resized = Array.isArray(settings) ? settings.slice(0, count).map(p => ({ ...p })) : [];
  while (resized.length < count) {
    const preset = defaultPeriods[resized.length];
    if (preset) {
      resized.push({ ...preset });
      continue;
    }
    const last = resized[resized.length - 1] || defaultPeriods[defaultPeriods.length - 1];
    const [h, m] = last.startTime.split(':');
    const nextStart = Number(h) * 60 + Number(m) + last.duration + 10;
    resized.push({
      startTime: formatClockTime(nextStart),
      duration: last.duration
    });
  }
  return resized;
}

const defaultSchedule = {
  name: CLASS_NAME, description: CLASS_DESC, semesterStart: SEMESTER_START,
  totalPeriods: 12, totalWeeks: 16,
  periodSettings: defaultPeriods,
  courses: {monday:[],tuesday:[],wednesday:[],thursday:[],friday:[]},
  announcements: [],
  makeupDays: []
};

function createDefaultSchedule() {
  return {
    ...JSON.parse(JSON.stringify(defaultSchedule)),
    updatedAt: new Date().toISOString()
  };
}

let scheduleCache = null;
// 缓存对应的数据文件 mtime；只在 mtime 变化时重读磁盘
let scheduleCacheMtime = null;

app.use(express.json({ limit: '1mb' }));

// 安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

async function checkStorageWritable(dataFile = DATA_FILE) {
  const dataDir = path.dirname(dataFile);
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const probeFile = path.join(dataDir, `.healthz.${suffix}`);
  const renamedProbeFile = `${probeFile}.renamed`;

  try {
    await fs.writeFile(probeFile, 'ok');
    await fs.rename(probeFile, renamedProbeFile);
  } finally {
    await fs.unlink(probeFile).catch(err => {
      if (err.code !== 'ENOENT') throw err;
    });
    await fs.unlink(renamedProbeFile).catch(err => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
}

// 健康检查同时验证持久化目录可写及原子重命名可用。
app.get('/healthz', async (req, res) => {
  try {
    await checkStorageWritable();
    res.status(200).json({ ok: true, service: 'schedule-web' });
  } catch (err) {
    console.error('存储健康检查失败:', err.message);
    res.status(503).json({ ok: false, service: 'schedule-web', storage: 'unavailable' });
  }
});

// 静态文件路径 - 支持两种部署方式
const publicPath = process.env.PUBLIC_PATH || path.join(__dirname, 'public');
app.use(express.static(publicPath));

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
  saveLock = next.catch(err => {
    if (!(err instanceof HttpError)) {
      console.error('Save failed:', err);
    }
  });
  return next;
}

async function loadSchedule() {
  // 缓存失效检查：外部直接改 data/schedule.json 时 mtime 变化，下次读取重新加载，无需重启。
  let stat = null;
  try {
    stat = await fs.stat(DATA_FILE);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('检查数据文件状态失败:', err.message);
    }
  }
  if (scheduleCache !== null && stat && scheduleCacheMtime !== null && stat.mtimeMs === scheduleCacheMtime) {
    return scheduleCache;
  }
  try {
    const content = await fs.readFile(DATA_FILE, 'utf8');
    if (!content || content.trim() === '') {
      console.log('数据文件为空，使用默认配置');
      scheduleCache = createDefaultSchedule();
      scheduleCacheMtime = stat ? stat.mtimeMs : null;
      return scheduleCache;
    }
    const data = JSON.parse(content);
    scheduleCache = {...createDefaultSchedule(), ...data, periodSettings: data.periodSettings || JSON.parse(JSON.stringify(defaultPeriods))};
    scheduleCacheMtime = stat ? stat.mtimeMs : null;
    return scheduleCache;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('数据文件不存在，使用默认配置');
      scheduleCache = createDefaultSchedule();
      scheduleCacheMtime = null;
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
      scheduleCacheMtime = null;
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
    // 记录新 mtime，避免自己保存后被误判为外部修改而立刻重读
    try {
      scheduleCacheMtime = (await fs.stat(DATA_FILE)).mtimeMs;
    } catch (e) {
      scheduleCacheMtime = null;
    }
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

// 调休补课日（「班」日）：整体替换 makeupDays 数组
app.put('/api/schedule/makeup-days', strictRateLimit, async (req, res) => {
  try {
    const {password, makeupDays} = req.body;
    if (EDIT_PASSWORD && password !== EDIT_PASSWORD) {
      await logToFile(`密码错误尝试 - 调休补课日更新`);
      return res.status(403).json({error:'密码错误'});
    }

    // 验证 makeupDays 数据结构
    if (!isValidMakeupDays(makeupDays)) {
      return res.status(400).json({error:'Invalid makeupDays data'});
    }

    await withSaveLock(async () => {
      const schedule = await loadSchedule();
      const newSchedule = JSON.parse(JSON.stringify(schedule));
      newSchedule.makeupDays = makeupDays;
      newSchedule.updatedAt = new Date().toISOString();
      await saveSchedule(newSchedule);
    });
    await logToFile(`调休补课日已更新`);
    res.json({success:true});
  } catch (err) {
    console.error('保存调休补课日失败:', err);
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
      const hasPeriodSettings = periodSettings !== undefined;
      if (hasPeriodSettings) {
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
      if (semesterStart !== undefined) {
        if (!isValidDateString(semesterStart)) {
          throw new HttpError(400, 'Invalid semesterStart');
        }
        newSchedule.semesterStart = semesterStart;
      }
      if (Number.isInteger(totalPeriods) && totalPeriods >= 1 && totalPeriods <= 20) newSchedule.totalPeriods = totalPeriods;
      if (Number.isInteger(totalWeeks) && totalWeeks >= 1 && totalWeeks <= 30) newSchedule.totalWeeks = totalWeeks;
      if (totalPeriods !== undefined && !hasPeriodSettings) {
        newSchedule.periodSettings = newSchedule.periodSettings.slice(0, newSchedule.totalPeriods);
      }
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

app.get('/api/ui-config', (req, res) => {
  res.json({ readonly: false, icpNumber: ICP_NUMBER });
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
app.get('/api/announcements', strictRateLimit, requireHeaderAuth, async (req, res) => {
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
    if (announcement.startDate && announcement.endDate && announcement.startDate > announcement.endDate) {
      return res.status(400).json({error:'Invalid date range'});
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

// ===== ICS 日历订阅导出 =====
function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatIcsLocalDateTime(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}T${pad2(date.getHours())}${pad2(date.getMinutes())}00`;
}

function formatIcsUtcDateTime(date) {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}00Z`;
}

function escapeIcsText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 §3.1：content line 不应超过 75 octet，超出时用 CRLF + 单个空格折叠。
// 按 UTF-8 字节数计算长度，并按字符边界切分，不会截断多字节字符（如中文）。
function foldIcsLine(line) {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const parts = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75; // 首行最多 75 octet
  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (currentBytes + chBytes > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
      limit = 74; // 续行需为前导空格留出 1 octet
    }
    current += ch;
    currentBytes += chBytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

// 与前端 parsePeriods 行为一致：支持 "1-2"、"1,3"、"3"、"第1-2节"
function parsePeriodNumbers(period) {
  if (!period || typeof period !== 'string') return [];
  const normalized = period.replace(/[第节]/g, '').trim();
  if (normalized.includes('-')) {
    const parts = normalized.split('-').map(Number);
    if (parts.length === 2 && Number.isInteger(parts[0]) && Number.isInteger(parts[1]) && parts[0] > 0 && parts[0] <= parts[1]) {
      return Array.from({ length: parts[1] - parts[0] + 1 }, (_, i) => parts[0] + i);
    }
    return [];
  }
  if (normalized.includes(',')) {
    // 升序排序：倒序/乱序输入（如 "3,1"）会让 DTSTART/DTEND 颠倒，生成非法 VEVENT
    return normalized.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  }
  const n = Number(normalized);
  return Number.isInteger(n) && n > 0 ? [n] : [];
}

function isCourseActiveInWeek(course, week, totalWeeks) {
  if (!course || typeof course !== 'object') return false;
  const start = Number.isInteger(course.startWeek) ? course.startWeek : 1;
  const end = Number.isInteger(course.endWeek) ? course.endWeek : totalWeeks;
  const weekType = course.weekType || 'all';
  if (week < start || week > end) return false;
  if (weekType === 'odd') return week % 2 === 1;
  if (weekType === 'even') return week % 2 === 0;
  return true;
}

const ICS_DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const ICS_DAY_NAMES = { monday: '周一', tuesday: '周二', wednesday: '周三', thursday: '周四', friday: '周五' };

// 时段划分（按节次）：上午 1-5、下午 6-9、晚上 10-13
const ICS_SLOT_LABELS = { morning: '上午', afternoon: '下午', evening: '晚上' };
function slotOfFirstPeriod(firstPeriod) {
  if (firstPeriod >= 1 && firstPeriod <= 5) return 'morning';
  if (firstPeriod >= 6 && firstPeriod <= 9) return 'afternoon';
  if (firstPeriod >= 10 && firstPeriod <= 13) return 'evening';
  return null;
}

// 汇总事件标题：「📋 上午：高等数学、体育理论」——时段名 + 该时段全部课程名
// （按上课时间排序、顿号分隔、同名去重）。日历 App 的推送通知只显示 SUMMARY，
// 所以课名必须直接进标题。整串超过 60 字符时保留前若干门完整课名，
// 尾部以「等N节」截断（N 为未列出的课程门数）。
const ICS_SUMMARY_TITLE_MAX = 60;
function buildSlotSummaryTitle(label, names) {
  const prefix = `📋 ${label}：`;
  const full = prefix + names.join('、');
  if (full.length <= ICS_SUMMARY_TITLE_MAX) return full;
  let keptCount = 0;
  let keptLen = 0;
  for (let i = 0; i < names.length; i++) {
    const addLen = names[i].length + (keptCount > 0 ? 1 : 0); // 课名 + 顿号
    const suffix = `等${names.length - i - 1}节`;
    if (prefix.length + keptLen + addLen + suffix.length > ICS_SUMMARY_TITLE_MAX) break;
    keptLen += addLen;
    keptCount++;
  }
  return prefix + names.slice(0, keptCount).join('、') + `等${names.length - keptCount}节`;
}

// 按 semesterStart + 周次范围把课程展开成本学期全部上课日的 VEVENT。
// 节假日（holidays.js 内置表）当天的事件跳过。
// 调休补课日（schedule.makeupDays）不走周次展开：confirmed 的补课日按 date 直接生成
// 事件（DESCRIPTION 标注「补课」及 copyFrom），pending（等待学校通知）的跳过。
function buildCalendarIcs(schedule) {
  const totalWeeksNum = Number.isInteger(schedule.totalWeeks) ? schedule.totalWeeks : 16;
  const periodSettings = Array.isArray(schedule.periodSettings) ? schedule.periodSettings : [];
  const dtstamp = formatIcsUtcDateTime(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//schedule-web//class-schedule//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(schedule.name || '班级课表')}`,
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Shanghai',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:CST',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE'
  ];
  // 事件先收集到 events，输出前按「天 × 时段」分组生成独立的时段汇总 VEVENT
  const events = [];
  for (let week = 1; week <= totalWeeksNum; week++) {
    ICS_DAY_KEYS.forEach((day, dayIndex) => {
      const courses = (schedule.courses && schedule.courses[day]) || [];
      for (const course of courses) {
        if (!isCourseActiveInWeek(course, week, totalWeeksNum)) continue;
        if (Number.isInteger(course.skipWeek) && course.skipWeek === week) continue;
        const periods = parsePeriodNumbers(course.period);
        if (periods.length === 0) continue;
        const first = periodSettings[periods[0] - 1];
        const last = periodSettings[periods[periods.length - 1] - 1];
        if (!first || !last) continue;
        const [sh, sm] = first.startTime.split(':').map(Number);
        const [eh, em] = last.startTime.split(':').map(Number);
        const start = ScheduleDateUtils.getAcademicDate(schedule.semesterStart, week, dayIndex, sh, sm);
        if (!start) continue;
        const endBase = ScheduleDateUtils.getAcademicDate(schedule.semesterStart, week, dayIndex, eh, em);
        const end = new Date(endBase.getTime() + (Number(last.duration) || 45) * 60000);
        const holiday = ScheduleHolidays.getHolidayInfo(start);
        if (holiday && holiday.type === 'holiday') continue;
        const uid = `sw-${crypto.createHash('sha1').update([
          course.name, day, course.period, week, course.location || '', course.teacher || ''
        ].join('|')).digest('hex').slice(0, 20)}@schedule-web`;
        const desc = [];
        if (course.teacher) desc.push(`教师：${course.teacher}`);
        desc.push(`第${week}周 ${ICS_DAY_NAMES[day]} 第${course.period}节`);
        const eventLines = ['BEGIN:VEVENT'];
        eventLines.push(`UID:${uid}`);
        eventLines.push(`DTSTAMP:${dtstamp}`);
        eventLines.push(`DTSTART;TZID=Asia/Shanghai:${formatIcsLocalDateTime(start)}`);
        eventLines.push(`DTEND;TZID=Asia/Shanghai:${formatIcsLocalDateTime(end)}`);
        eventLines.push(`SUMMARY:${escapeIcsText(course.name)}`);
        if (course.location) eventLines.push(`LOCATION:${escapeIcsText(course.location)}`);
        eventLines.push(`DESCRIPTION:${escapeIcsText(desc.join('\n'))}`);
        // VALARM 与 END:VEVENT 在全天事件收集完毕后按课间隙统一生成（见下方 dayGroups 逻辑）
        events.push({
          dayKey: `w${week}-${day}`,
          start: start.getTime(),
          end: end.getTime(),
          slot: slotOfFirstPeriod(periods[0]),
          name: course.name,
          descLine: `${course.name} ${pad2(start.getHours())}:${pad2(start.getMinutes())}-${pad2(end.getHours())}:${pad2(end.getMinutes())}${course.location ? ` @${course.location}` : ''}`,
          lines: eventLines
        });
      }
    });
  }
  // 调休补课日：confirmed 按日期直接生成事件，pending 跳过
  const makeupDays = Array.isArray(schedule.makeupDays) ? schedule.makeupDays : [];
  for (const day of makeupDays) {
    if (!day || day.status !== 'confirmed') continue;
    const baseDate = ScheduleDateUtils.parseLocalDate(day.date);
    if (!baseDate) continue;
    const dayCourses = Array.isArray(day.courses) ? day.courses : [];
    for (const course of dayCourses) {
      const periods = parsePeriodNumbers(course.period);
      if (periods.length === 0) continue;
      const first = periodSettings[periods[0] - 1];
      const last = periodSettings[periods[periods.length - 1] - 1];
      if (!first || !last) continue;
      const [sh, sm] = first.startTime.split(':').map(Number);
      const [eh, em] = last.startTime.split(':').map(Number);
      const start = new Date(baseDate.getTime());
      start.setHours(sh, sm, 0, 0);
      const end = new Date(baseDate.getTime());
      end.setHours(eh, em, 0, 0);
      end.setTime(end.getTime() + (Number(last.duration) || 45) * 60000);
      // UID 稳定：由补课日期 + 课程信息哈希而成，同一补课日重复导出不变
      const uid = `swm-${crypto.createHash('sha1').update([
        day.date, course.name, course.period, course.location || '', course.teacher || ''
      ].join('|')).digest('hex').slice(0, 20)}@schedule-web`;
      const desc = [];
      if (course.teacher) desc.push(`教师：${course.teacher}`);
      desc.push(day.copyFrom ? `补课·补${ICS_DAY_NAMES[day.copyFrom]}` : '补课');
      desc.push(`${day.date} 第${course.period}节`);
      const eventLines = ['BEGIN:VEVENT'];
      eventLines.push(`UID:${uid}`);
      eventLines.push(`DTSTAMP:${dtstamp}`);
      eventLines.push(`DTSTART;TZID=Asia/Shanghai:${formatIcsLocalDateTime(start)}`);
      eventLines.push(`DTEND;TZID=Asia/Shanghai:${formatIcsLocalDateTime(end)}`);
      eventLines.push(`SUMMARY:${escapeIcsText(course.name)}`);
      if (course.location) eventLines.push(`LOCATION:${escapeIcsText(course.location)}`);
      eventLines.push(`DESCRIPTION:${escapeIcsText(desc.join('\n'))}`);
      // VALARM 与 END:VEVENT 在全天事件收集完毕后按课间隙统一生成（见下方 dayGroups 逻辑）
      events.push({
        dayKey: `m-${day.date}`,
        start: start.getTime(),
        end: end.getTime(),
        slot: slotOfFirstPeriod(periods[0]),
        name: course.name,
        descLine: `${course.name} ${pad2(start.getHours())}:${pad2(start.getMinutes())}-${pad2(end.getHours())}:${pad2(end.getMinutes())}${course.location ? ` @${course.location}` : ''}`,
        lines: eventLines
      });
    }
  }
  // 单课提醒时机按课间隙自适应：按天分组、按开始时间排序后，计算每节课与当天前一节课的
  // 间隙 gap（分钟）= 本课开始 - 前课结束。无同日前课或 gap ≥ 30（如午休/晚饭后第一节）
  // → 课前 30 分钟提醒（-PT30M）；gap < 30（短课间，含 gap≤0 叠课兜底取 0）→ 前一节课
  // 下课时刻提醒（TRIGGER = 负的间隙分钟数），效果为前课一下课就弹。
  const dayGroups = new Map(); // dayKey -> events[]
  for (const ev of events) {
    if (!dayGroups.has(ev.dayKey)) dayGroups.set(ev.dayKey, []);
    dayGroups.get(ev.dayKey).push(ev);
  }
  for (const group of dayGroups.values()) {
    group.sort((a, b) => a.start - b.start);
    group.forEach((ev, i) => {
      const prev = group[i - 1];
      const gap = prev ? Math.round((ev.start - prev.end) / 60000) : null;
      const longGap = gap === null || gap >= 30;
      ev.lines.push('BEGIN:VALARM');
      ev.lines.push('ACTION:DISPLAY');
      ev.lines.push(longGap ? 'TRIGGER:-PT30M' : `TRIGGER:-PT${Math.max(gap, 0)}M`);
      ev.lines.push(`DESCRIPTION:${escapeIcsText(longGap ? `${ev.name} 30 分钟后开始` : `上一节已下课，接下来：${ev.name}`)}`);
      ev.lines.push('END:VALARM');
      ev.lines.push('END:VEVENT');
    });
  }
  // 时段汇总提醒：按「天 × 时段」分组，每组有课的时段额外生成一个独立的汇总 VEVENT。
  // 很多日历客户端（Google 日历等）一个 VEVENT 只认一条 VALARM，所以不能像课程事件那样
  // 把汇总提醒作为第二条闹钟塞进首课事件，必须独立成事件；课程事件仍只有一条自适应 VALARM。
  // 汇总事件 DTSTART = 该时段当天最早课的上课时间 - 60 分钟，DTEND = DTSTART + 5 分钟，
  // 闹钟 TRIGGER:PT0M（事件开始时提醒）。
  const slotGroups = new Map(); // `${dayKey}|${slot}` -> events[]
  for (const ev of events) {
    if (!ev.slot) continue;
    const key = `${ev.dayKey}|${ev.slot}`;
    if (!slotGroups.has(key)) slotGroups.set(key, []);
    slotGroups.get(key).push(ev);
  }
  for (const [key, group] of slotGroups) {
    group.sort((a, b) => a.start - b.start);
    const slot = key.split('|').pop();
    const label = ICS_SLOT_LABELS[slot];
    const summaryStart = new Date(group[0].start - 60 * 60000);
    const summaryEnd = new Date(summaryStart.getTime() + 5 * 60000);
    const dateStr = formatIcsLocalDateTime(new Date(group[0].start)).slice(0, 8);
    // UID 稳定：由日期 + 时段 + 课程名列表哈希而成，重复导出不变，且不与课程事件冲突
    const uid = `sw-daily-${crypto.createHash('sha1').update(
      [dateStr, slot, ...group.map(e => e.name)].join('|')
    ).digest('hex').slice(0, 20)}@schedule-web`;
    // 标题直接列课名（按上课时间排序、顿号分隔、同名去重），超长时以「等N节」截断
    const names = [];
    for (const e of group) {
      if (!names.includes(e.name)) names.push(e.name);
    }
    const title = buildSlotSummaryTitle(label, names);
    const eventLines = ['BEGIN:VEVENT'];
    eventLines.push(`UID:${uid}`);
    eventLines.push(`DTSTAMP:${dtstamp}`);
    eventLines.push(`DTSTART;TZID=Asia/Shanghai:${formatIcsLocalDateTime(summaryStart)}`);
    eventLines.push(`DTEND;TZID=Asia/Shanghai:${formatIcsLocalDateTime(summaryEnd)}`);
    eventLines.push(`SUMMARY:${escapeIcsText(title)}`);
    eventLines.push(`DESCRIPTION:${escapeIcsText(group.map(e => e.descLine).join('\n'))}`);
    eventLines.push('BEGIN:VALARM');
    eventLines.push('ACTION:DISPLAY');
    eventLines.push('TRIGGER:PT0M');
    // 推送通知只展示标题，VALARM 的 DESCRIPTION 与 SUMMARY 保持同一串带课名文本
    eventLines.push(`DESCRIPTION:${escapeIcsText(title)}`);
    eventLines.push('END:VALARM');
    eventLines.push('END:VEVENT');
    lines.push(...eventLines);
  }
  for (const ev of events) lines.push(...ev.lines);
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

app.get('/api/calendar.ics', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    const ics = buildCalendarIcs(schedule);
    await logToFile('ICS 日历导出');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="schedule.ics"');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(ics);
  } catch (err) {
    console.error('导出 ICS 失败:', err);
    res.status(500).json({ error: 'Failed to export calendar' });
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
      if (!isValidCourses(migratedData.courses)) {
        throw new HttpError(400, 'Invalid courses structure');
      }
      const importedTotalPeriods = Number.isInteger(migratedData.totalPeriods) && migratedData.totalPeriods >= 1 && migratedData.totalPeriods <= 20 ? migratedData.totalPeriods : 0;
      const hasPeriodSettings = migratedData.periodSettings !== undefined && migratedData.periodSettings !== null;
      const periodSettingsLength = hasPeriodSettings && Array.isArray(migratedData.periodSettings) ? migratedData.periodSettings.length : 0;
      const maxCoursePeriod = getMaxCoursePeriod(migratedData.courses);
      const newTotalPeriods = Math.max(importedTotalPeriods || newSchedule.totalPeriods, periodSettingsLength, maxCoursePeriod);
      if (!Number.isInteger(newTotalPeriods) || newTotalPeriods < 1 || newTotalPeriods > 20) {
        throw new HttpError(400, 'Invalid totalPeriods');
      }
      if (hasPeriodSettings) {
        if (!isValidPeriodSettings(migratedData.periodSettings)) {
          throw new HttpError(400, 'Invalid periodSettings');
        }
        newSchedule.periodSettings = resizePeriodSettings(migratedData.periodSettings, newTotalPeriods);
      } else {
        newSchedule.periodSettings = resizePeriodSettings(newSchedule.periodSettings, newTotalPeriods);
      }
      if (!isValidPeriodSettings(newSchedule.periodSettings)) {
        throw new HttpError(400, 'Invalid periodSettings');
      }
      newSchedule.courses = migratedData.courses;
      if (migratedData.semesterStart && isValidDateString(migratedData.semesterStart)) newSchedule.semesterStart = migratedData.semesterStart;
      if (migratedData.name) newSchedule.name = String(migratedData.name).slice(0, 100);
      if (migratedData.description !== undefined) newSchedule.description = String(migratedData.description).slice(0, 200);
      newSchedule.totalPeriods = newTotalPeriods;
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

// 只允许 header 传参，防止密码写入 URL 日志。
function requireHeaderAuth(req, res, next) {
  const rawPassword = req.headers['x-password'];
  const password = Array.isArray(rawPassword) ? rawPassword[0] : (rawPassword || '');
  if (EDIT_PASSWORD && password !== EDIT_PASSWORD) {
    return res.status(403).json({error:'Access denied'});
  }
  next();
}

app.get('/api/logs', strictRateLimit, requireHeaderAuth, async (req, res) => {
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

app.get('/api/logs/:file', strictRateLimit, requireHeaderAuth, async (req, res) => {
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
  await fs.mkdir(path.dirname(DATA_FILE), {recursive:true});
  await fs.mkdir(LOG_DIR, {recursive:true});
  await checkStorageWritable();
  try {
    await fs.access(DATA_FILE);
  } catch {
    console.log('初始化数据文件...');
    await saveSchedule(createDefaultSchedule());
  }
  // 启动时加载数据到缓存
  await loadSchedule();
}

// ===== 公网只读入口 =====
// 设置 READONLY_PORT 后，在同一进程内再起一个只读监听：
// - 所有非 GET/HEAD/OPTIONS 的 /api 请求一律 403（写接口整体关闭）
// - /api/ui-config 返回 readonly: true，前端据此隐藏登录/编辑入口
// - 静态资源与只读 API（课表/公告/ICS）透传到主 app
// 典型用法：tailnet 入口绑主端口（可编辑），公网 nginx 反代到只读端口。
function createReadonlyApp() {
  const readonlyApp = express();
  readonlyApp.disable('x-powered-by');
  readonlyApp.get('/api/ui-config', (req, res) => {
    res.json({ readonly: true, icpNumber: ICP_NUMBER });
  });
  readonlyApp.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return res.status(403).json({ error: 'Public endpoint is read-only' });
    }
    next();
  });
  readonlyApp.use(app);
  return readonlyApp;
}

// 导出供测试使用
module.exports = { app, init, resolveEditPassword, checkStorageWritable, createDefaultSchedule, buildCalendarIcs, buildSlotSummaryTitle, parsePeriodNumbers, foldIcsLine, isValidMakeupDays, createReadonlyApp, resolveReadonlyListenPort };

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
      if (EDIT_PASSWORD_CONFIG.generated) {
        if (process.env.PRINT_EDIT_PASSWORD === 'true') {
          console.log(`🔑 自动生成的编辑密码: ${EDIT_PASSWORD}`);
        } else {
          console.log('🔑 编辑密码已自动生成（设置 PRINT_EDIT_PASSWORD=true 可在日志中查看）');
        }
      }
      logToFile(`服务启动 - 班级: ${CLASS_NAME}, 密码状态: ${EDIT_PASSWORD ? '已设置' : '无'}`);
    });
    const readonlyListenPort = resolveReadonlyListenPort(READONLY_PORT, PORT);
    if (readonlyListenPort) {
      createReadonlyApp().listen(readonlyListenPort, () => {
        console.log(`🔒 公网只读入口已启动: http://localhost:${readonlyListenPort}（写接口关闭）`);
        logToFile(`只读入口启动 - 端口: ${readonlyListenPort}`);
      });
    }
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
