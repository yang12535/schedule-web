/**
 * 公网只读入口 + ICP 页脚配置测试
 * createReadonlyApp()：写接口整体 403，只读 API/静态资源透传
 * /api/ui-config：主入口 readonly=false，只读入口 readonly=true
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;

process.env.NODE_ENV = 'test';

const tmpDir = path.join(os.tmpdir(), `schedule-readonly-test-${Date.now()}`);
process.env.DATA_FILE = path.join(tmpDir, 'schedule.json');
process.env.LOG_DIR = path.join(tmpDir, 'logs');
process.env.EDIT_PASSWORD = 'test123';
process.env.SEMESTER_START = '2026-08-31';
process.env.ICP_NUMBER = '皖ICP备2025105642号';
process.env.PUBLIC_PATH = path.join(__dirname, '..', 'src', 'public');

const request = require('supertest');
const { app, init, createReadonlyApp, resolveReadonlyListenPort } = require('../src/server/server');

describe('公网只读入口', () => {
  let readonlyApp;

  beforeAll(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await init();
    readonlyApp = createReadonlyApp();
  });

  afterAll(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  it('主入口 /api/ui-config 返回 readonly=false 与备案号', async () => {
    const res = await request(app).get('/api/ui-config').expect(200);
    expect(res.body.readonly).toBe(false);
    expect(res.body.icpNumber).toBe('皖ICP备2025105642号');
  });

  it('只读入口 /api/ui-config 返回 readonly=true', async () => {
    const res = await request(readonlyApp).get('/api/ui-config').expect(200);
    expect(res.body.readonly).toBe(true);
    expect(res.body.icpNumber).toBe('皖ICP备2025105642号');
  });

  it('只读入口放行 GET 只读 API 与静态首页', async () => {
    await request(readonlyApp).get('/api/schedule').expect(200);
    await request(readonlyApp).get('/api/announcements/active').expect(200);
    await request(readonlyApp).get('/api/calendar.ics').expect(200);
    const res = await request(readonlyApp).get('/').expect(200);
    expect(res.text).toContain('班级课表');
  });

  it('只读入口关闭全部写接口（即使密码正确）', async () => {
    const writeRequests = [
      request(readonlyApp).post('/api/import').send({ password: 'test123', data: { courses: {} } }),
      request(readonlyApp).put('/api/schedule/courses').send({ password: 'test123', courses: {} }),
      request(readonlyApp).put('/api/schedule/settings').send({ password: 'test123', name: 'x' }),
      request(readonlyApp).post('/api/announcements').send({ password: 'test123', announcement: { title: 't', content: 'c' } }),
      request(readonlyApp).post('/api/verify').send({ password: 'test123' }),
      request(readonlyApp).delete('/api/announcements/abc').send({ password: 'test123' })
    ];
    for (const req of writeRequests) {
      const res = await req;
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/read-only/i);
    }
  });

  it('主入口写接口不受影响（密码正确可写）', async () => {
    const res = await request(app)
      .post('/api/announcements')
      .send({ password: 'test123', announcement: { title: '主入口写入', content: 'ok' } })
      .expect(200);
    expect(res.body.success).toBe(true);
  });
});

describe('resolveReadonlyListenPort（只读端口校验）', () => {
  it('未配置（0/空）时不启用只读入口', () => {
    expect(resolveReadonlyListenPort(0, 3000)).toBe(0);
    expect(resolveReadonlyListenPort('', 3000)).toBe(0);
    expect(resolveReadonlyListenPort(undefined, 3000)).toBe(0);
  });

  it('与主端口相同时跳过只读监听，避免 EADDRINUSE 崩进程', () => {
    expect(resolveReadonlyListenPort(3000, 3000)).toBe(0);
    expect(resolveReadonlyListenPort('3000', '3000')).toBe(0);
  });

  it('超出端口范围或非法值时跳过只读监听', () => {
    expect(resolveReadonlyListenPort(70000, 3000)).toBe(0);
    expect(resolveReadonlyListenPort(-1, 3000)).toBe(0);
    expect(resolveReadonlyListenPort('abc', 3000)).toBe(0);
  });

  it('合法且与主端口不同的端口正常返回', () => {
    expect(resolveReadonlyListenPort(3001, 3000)).toBe(3001);
    expect(resolveReadonlyListenPort('3001', '3000')).toBe(3001);
  });
});
