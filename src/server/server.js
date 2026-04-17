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
  courses: {monday:[],tuesday:[],wednesday:[],thursday:[],friday:[]}
};

app.use(express.json());

// 静态文件路径 - 支持两种部署方式
const publicPath = process.env.PUBLIC_PATH || path.join(__dirname, 'public');
app.use(express.static(publicPath));

// 请求日志中间件
app.use(async (req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  await logToFile(`${req.method} ${req.url} - IP: ${ip}`);
  next();
});

async function loadSchedule() {
  try {
    const content = await fs.readFile(DATA_FILE, 'utf8');
    if (!content || content.trim() === '') {
      console.log('数据文件为空，使用默认配置');
      return {...defaultSchedule};
    }
    const data = JSON.parse(content);
    return {...defaultSchedule, ...data, periodSettings: data.periodSettings || defaultPeriods};
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('数据文件不存在，使用默认配置');
    } else if (err instanceof SyntaxError) {
      console.error('数据文件格式错误:', err.message);
      await logToFile(`数据文件格式错误: ${err.message}`);
    } else {
      console.error('加载数据失败:', err.message);
    }
    return {...defaultSchedule};
  }
}

async function saveSchedule(data) {
  const tempFile = `${DATA_FILE}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    // 确保目录存在
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
    await fs.rename(tempFile, DATA_FILE);
  } catch (err) {
    // 清理 rename 失败时残留的临时文件；若文件不存在则静默忽略
    try { await fs.unlink(tempFile); } catch { /* ignore cleanup errors */ }
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

app.put('/api/schedule/courses', async (req, res) => {
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
  } catch (err) {
    console.error('保存设置失败:', err);
    res.status(500).json({error:'Failed to save'});
  }
});

app.post('/api/verify', async (req, res) => {
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

app.post('/api/import', async (req, res) => {
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
    if (migratedData.semesterStart) schedule.semesterStart = migratedData.semesterStart;
    if (migratedData.name) schedule.name = migratedData.name;
    if (migratedData.description !== undefined) schedule.description = migratedData.description;
    if (migratedData.totalPeriods >= 1 && migratedData.totalPeriods <= 20) schedule.totalPeriods = migratedData.totalPeriods;
    if (migratedData.totalWeeks >= 1 && migratedData.totalWeeks <= 30) schedule.totalWeeks = migratedData.totalWeeks;
    if (migratedData.periodSettings?.length >= 1) schedule.periodSettings = migratedData.periodSettings;
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
${EDIT_PASSWORD ? `🔒 编辑密码: ${EDIT_PASSWORD}` : '🔓 编辑模式: 无需密码'}
========================================
    `;
    console.log(banner);
    logToFile(`服务启动 - 班级: ${CLASS_NAME}, 密码: ${EDIT_PASSWORD || '无'}`);
  });
}).catch(err => {
  console.error('服务启动失败:', err);
  process.exit(1);
});
