/**
 * 课表数据缓存失效测试
 * loadSchedule 缓存只在数据文件 mtime 变化时重读磁盘：
 * - 外部直接改 schedule.json 无需重启即可生效
 * - 服务自己保存（saveSchedule）后记录新 mtime，不会被误判为外部修改而立刻重读
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;

process.env.NODE_ENV = 'test';

const tmpDir = path.join(os.tmpdir(), `schedule-cache-test-${Date.now()}`);
const dataFile = path.join(tmpDir, 'schedule.json');
process.env.DATA_FILE = dataFile;
process.env.LOG_DIR = path.join(tmpDir, 'logs');
process.env.EDIT_PASSWORD = 'test123';
process.env.CLASS_NAME = '缓存测试班';
process.env.SEMESTER_START = '2026-08-31';
process.env.PUBLIC_PATH = path.join(__dirname, '..', 'src', 'public');

const request = require('supertest');
const { app, init } = require('../src/server/server');

// 外部直接改写数据文件，并把 mtime 钉到指定值（避免与上次写入落在同一毫秒）。
// 说明：utimes 经秒级浮点转换有亚毫秒精度损失，测试一律使用整秒 mtime 保证精确往返。
async function writeDataFileExternally(mutator, mtimeMs) {
  const data = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  mutator(data);
  await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
  const mtimeSec = mtimeMs / 1000;
  await fs.utimes(dataFile, mtimeSec, mtimeSec);
}

describe('课表数据缓存（mtime 失效）', () => {
  beforeAll(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await init();
  });

  afterAll(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  it('首次读取加载初始数据', async () => {
    const res = await request(app).get('/api/schedule').expect(200);
    expect(res.body.name).toBe('缓存测试班');
  });

  it('外部直接改数据文件（mtime 变化）后无需重启即生效', async () => {
    const mtimeMs = Math.floor(Date.now() / 1000) * 1000 + 20000; // 整秒，utimes 可精确往返
    await writeDataFileExternally(data => { data.name = '外部修改班'; }, mtimeMs);
    const res = await request(app).get('/api/schedule').expect(200);
    expect(res.body.name).toBe('外部修改班');
  });

  it('mtime 未变化时仍命中缓存，不重读磁盘', async () => {
    // 磁盘内容变了但 mtime 与缓存记录一致 → 继续返回缓存
    const stat = await fs.stat(dataFile);
    await writeDataFileExternally(data => { data.name = '幽灵班'; }, stat.mtimeMs);
    const res = await request(app).get('/api/schedule').expect(200);
    expect(res.body.name).toBe('外部修改班');
  });

  it('接口保存后记录新 mtime，不会被误判为外部修改而重读', async () => {
    const imported = {
      name: '接口保存班',
      semesterStart: '2026-08-31',
      totalPeriods: 2,
      totalWeeks: 16,
      periodSettings: [
        { startTime: '08:00', duration: 45 },
        { startTime: '08:55', duration: 45 }
      ],
      courses: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [] },
      announcements: []
    };
    await request(app)
      .post('/api/import')
      .send({ password: 'test123', data: imported })
      .expect(200);
    // 把文件 mtime 钉到整秒（保存后的真实 mtime 带亚毫秒，utimes 无法精确复原），
    // 先 GET 一次让缓存记录该 mtime
    const pinnedMs = Math.floor(Date.now() / 1000) * 1000 + 40000;
    const pinnedSec = pinnedMs / 1000;
    await fs.utimes(dataFile, pinnedSec, pinnedSec);
    const first = await request(app).get('/api/schedule').expect(200);
    expect(first.body.name).toBe('接口保存班');
    // 磁盘内容变了但 mtime 与保存后记录的一致 → 仍返回刚保存的缓存
    await writeDataFileExternally(data => { data.name = '幽灵班2'; }, pinnedMs);
    const res = await request(app).get('/api/schedule').expect(200);
    expect(res.body.name).toBe('接口保存班');
  });
});
