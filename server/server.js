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

// 保存日志到文件
async function logToFile(message) {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `schedule-${dateStr}.log`);
    const timeStr = date.toLocaleString('zh-CN');
    const logLine = `[${timeStr}] ${message}\n`;
    await fs.appendFile(logFile, logLine);
  } catch (err) {
    console.error('日志写入失败:', err.message);
  }
}

// Config
const CLASS_NAME = process.env.CLASS_NAME || '我的课表';
const CLASS_DESC = process.env.CLASS_DESC || '';
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || generatePassword();
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
  courses: {monday:[],tuesday:[],wednesday:[],thursday:[],friday:[]}
};

app.use(express.json());

// 静态文件路径 - 支持两种部署方式
const publicPath = process.env.PUBLIC_PATH || path.join(__dirname, '../public');
app.use(express.static(publicPath));

// 请求日志中间件
app.use(async (req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  await logToFile(`${req.method} ${req.url} - IP: ${ip}`);
  next();
});

async function loadSchedule() {
  try {
    const data = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    return {...defaultSchedule, ...data, periodSettings: data.periodSettings || defaultPeriods};
  } catch { return {...defaultSchedule}; }
}

async function saveSchedule(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/schedule', async (req, res) => {
  try { res.json(await loadSchedule()); } 
  catch { res.status(500).json({error:'Failed to load'}); }
});

app.put('/api/schedule/courses', async (req, res) => {
  try {
    const {password, courses} = req.body;
    if (EDIT_PASSWORD && password !== EDIT_PASSWORD) {
      await logToFile(`密码错误尝试 - 课程更新`);
      return res.status(403).json({error:'密码错误'});
    }
    const schedule = await loadSchedule();
    schedule.courses = courses;
    schedule.updatedAt = new Date().toISOString();
    await saveSchedule(schedule);
    await logToFile(`课程数据已更新`);
    res.json({success:true});
  } catch { res.status(500).json({error:'Failed to save'}); }
});

app.put('/api/schedule/settings', async (req, res) => {
  try {
    const {password, name, description, semesterStart, totalPeriods, totalWeeks, periodSettings} = req.body;
    if (EDIT_PASSWORD && password !== EDIT_PASSWORD) {
      await logToFile(`密码错误尝试 - 设置更新`);
      return res.status(403).json({error:'密码错误'});
    }
    const schedule = await loadSchedule();
    if (name !== undefined) schedule.name = name;
    if (description !== undefined) schedule.description = description;
    if (semesterStart) schedule.semesterStart = semesterStart;
    if (totalPeriods >= 1 && totalPeriods <= 20) schedule.totalPeriods = totalPeriods;
    if (totalWeeks >= 1 && totalWeeks <= 30) schedule.totalWeeks = totalWeeks;
    if (periodSettings?.length >= 1) schedule.periodSettings = periodSettings;
    schedule.updatedAt = new Date().toISOString();
    await saveSchedule(schedule);
    await logToFile(`设置已更新: ${name || schedule.name}`);
    res.json({success:true});
  } catch { res.status(500).json({error:'Failed to save'}); }
});

app.post('/api/verify', async (req, res) => {
  const {password} = req.body;
  const valid = !EDIT_PASSWORD || password === EDIT_PASSWORD;
  if (!valid) await logToFile(`密码验证失败`);
  res.json({valid, requirePassword:!!EDIT_PASSWORD, name:CLASS_NAME, description:CLASS_DESC});
});

app.get('/api/export', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    await logToFile(`数据导出`);
    res.setHeader('Content-Type','application/json');
    res.setHeader('Content-Disposition',`attachment; filename="${schedule.name}_课表.json"`);
    res.json({...schedule, exportDate:new Date().toISOString()});
  } catch { res.status(500).json({error:'Export failed'}); }
});

app.post('/api/import', async (req, res) => {
  try {
    const {password, data} = req.body;
    if (EDIT_PASSWORD && password !== EDIT_PASSWORD) {
      await logToFile(`密码错误尝试 - 数据导入`);
      return res.status(403).json({error:'密码错误'});
    }
    if (!data?.courses) return res.status(400).json({error:'Invalid format'});
    const schedule = await loadSchedule();
    schedule.courses = data.courses;
    if (data.semesterStart) schedule.semesterStart = data.semesterStart;
    if (data.name) schedule.name = data.name;
    if (data.description !== undefined) schedule.description = data.description;
    if (data.totalPeriods >= 1 && data.totalPeriods <= 20) schedule.totalPeriods = data.totalPeriods;
    if (data.totalWeeks >= 1 && data.totalWeeks <= 30) schedule.totalWeeks = data.totalWeeks;
    if (data.periodSettings?.length >= 1) schedule.periodSettings = data.periodSettings;
    schedule.updatedAt = new Date().toISOString();
    await saveSchedule(schedule);
    await logToFile(`数据导入成功`);
    res.json({success:true, schedule});
  } catch { res.status(500).json({error:'Import failed'}); }
});

app.get('/api/logs', async (req, res) => {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const files = await fs.readdir(LOG_DIR);
    const logs = files.filter(f => f.endsWith('.log')).sort().reverse();
    res.json({logs});
  } catch { res.status(500).json({error:'Failed to read logs'}); }
});

app.get('/api/logs/:file', async (req, res) => {
  try {
    const file = req.params.file;
    if (!file.match(/^schedule-\d{4}-\d{2}-\d{2}\.log$/)) {
      return res.status(400).json({error:'Invalid filename'});
    }
    const content = await fs.readFile(path.join(LOG_DIR, file), 'utf8');
    res.type('text/plain').send(content);
  } catch { res.status(404).json({error:'Log not found'}); }
});

// SPA fallback - 使用 PUBLIC_PATH
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

async function init() {
  try {
    await fs.mkdir(path.dirname(DATA_FILE), {recursive:true});
    await fs.mkdir(LOG_DIR, {recursive:true});
    try { await fs.access(DATA_FILE); } catch { await saveSchedule(defaultSchedule); }
  } catch (err) { console.error('Init error:', err); }
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
${EDIT_PASSWORD ? `🔒 编辑密码: ${EDIT_PASSWORD}` : '🔓 编辑模式: 无需密码'}
========================================
    `;
    console.log(banner);
    logToFile(`服务启动 - 班级: ${CLASS_NAME}, 密码: ${EDIT_PASSWORD || '无'}`);
  });
});
