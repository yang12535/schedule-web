/**
 * 课表服务 API 测试
 * 覆盖核心读写接口
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;

// 在加载 server.js 前设置环境变量，避免污染真实数据
const tmpDir = path.join(os.tmpdir(), `schedule-test-${Date.now()}`);
process.env.DATA_FILE = path.join(tmpDir, 'schedule.json');
process.env.LOG_DIR = path.join(tmpDir, 'logs');
process.env.EDIT_PASSWORD = 'test123';
process.env.CLASS_NAME = 'TestClass';
process.env.CLASS_DESC = 'Test Description';
process.env.SEMESTER_START = '2024-03-01';

const request = require('supertest');
const { app, init } = require('../src/server/server');

describe('Schedule API', () => {
  beforeAll(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await init();
  });

  afterAll(async () => {
    // 清理临时文件
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  describe('GET /api/schedule', () => {
    it('应返回默认课表结构', async () => {
      const res = await request(app).get('/api/schedule').expect(200);
      expect(res.body).toHaveProperty('name');
      expect(res.body).toHaveProperty('courses');
      expect(res.body).toHaveProperty('periodSettings');
      expect(Array.isArray(res.body.courses.monday)).toBe(true);
    });
  });

  describe('POST /api/verify', () => {
    it('正确密码应返回 valid=true', async () => {
      const res = await request(app)
        .post('/api/verify')
        .send({ password: 'test123' })
        .expect(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.requirePassword).toBe(true);
    });

    it('错误密码应返回 valid=false', async () => {
      const res = await request(app)
        .post('/api/verify')
        .send({ password: 'wrong' })
        .expect(200);
      expect(res.body.valid).toBe(false);
    });
  });

  describe('PUT /api/schedule/courses', () => {
    it('应能添加课程', async () => {
      const newCourses = {
        password: 'test123',
        courses: {
          monday: [
            {
              id: 'course-1',
              name: '数学',
              location: 'A101',
              teacher: '张老师',
              period: '1-2',
              type: 'math',
              startWeek: 1,
              endWeek: 16,
              weekType: 'all'
            }
          ],
          tuesday: [],
          wednesday: [],
          thursday: [],
          friday: []
        }
      };

      await request(app)
        .put('/api/schedule/courses')
        .send(newCourses)
        .expect(200);

      const res = await request(app).get('/api/schedule').expect(200);
      expect(res.body.courses.monday).toHaveLength(1);
      expect(res.body.courses.monday[0].name).toBe('数学');
    });

    it('未授权应返回 403', async () => {
      await request(app)
        .put('/api/schedule/courses')
        .send({ password: 'wrong', courses: { monday: [] } })
        .expect(403);
    });

    it('XSS 课程名应能被正常保存（转义由前端负责）', async () => {
      const malicious = {
        password: 'test123',
        courses: {
          monday: [
            {
              id: 'xss-1',
              name: '<script>alert(1)</script>',
              location: 'A101',
              teacher: '张老师',
              period: '1',
              type: 'default',
              startWeek: 1,
              endWeek: 16,
              weekType: 'all'
            }
          ],
          tuesday: [],
          wednesday: [],
          thursday: [],
          friday: []
        }
      };

      await request(app)
        .put('/api/schedule/courses')
        .send(malicious)
        .expect(200);

      const saved = await request(app).get('/api/schedule').expect(200);
      const name = saved.body.courses.monday[0].name;
      // 服务端保存原始值，渲染转义由前端负责
      expect(name).toBe('<script>alert(1)</script>');
    });
  });

  describe('PUT /api/schedule/settings', () => {
    it('应能更新节次设置', async () => {
      // 默认 totalPeriods=12，periodSettings 长度必须匹配
      const periodSettings = Array.from({ length: 12 }, (_, i) => ({
        startTime: `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${String((i % 2) * 30).padStart(2, '0')}`,
        duration: 45
      }));

      const settings = {
        password: 'test123',
        totalPeriods: 12,
        periodSettings
      };

      await request(app)
        .put('/api/schedule/settings')
        .send(settings)
        .expect(200);

      const res = await request(app).get('/api/schedule').expect(200);
      expect(res.body.periodSettings).toHaveLength(12);
    });
  });

  describe('GET /api/export', () => {
    it('应导出 JSON 文件', async () => {
      const res = await request(app)
        .get('/api/export')
        .expect(200)
        .expect('Content-Type', /json/);
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.body).toHaveProperty('name');
    });
  });

  describe('POST /api/import', () => {
    it('应能导入合法数据', async () => {
      const payload = {
        password: 'test123',
        data: {
          name: '导入班级',
          courses: {
            monday: [],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: []
          },
          periodSettings: Array.from({ length: 12 }, (_, i) => ({
            startTime: `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:00`,
            duration: 45
          })),
          announcements: []
        }
      };

      await request(app)
        .post('/api/import')
        .send(payload)
        .expect(200);

      const res = await request(app).get('/api/schedule').expect(200);
      expect(res.body.name).toBe('导入班级');
    });
  });

  describe('GET /api/announcements', () => {
    it('应返回公告列表', async () => {
      const res = await request(app).get('/api/announcements').expect(200);
      expect(Array.isArray(res.body.announcements)).toBe(true);
    });
  });
});
