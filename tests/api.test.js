/**
 * 课表服务 API 测试
 * 覆盖核心读写接口
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;

// 显式设置测试环境，确保限流/定时器等行为一致
process.env.NODE_ENV = 'test';

// 在加载 server.js 前设置环境变量，避免污染真实数据
const tmpDir = path.join(os.tmpdir(), `schedule-test-${Date.now()}`);
process.env.DATA_FILE = path.join(tmpDir, 'schedule.json');
process.env.LOG_DIR = path.join(tmpDir, 'logs');
process.env.EDIT_PASSWORD = 'test123';
process.env.CLASS_NAME = 'TestClass';
process.env.CLASS_DESC = 'Test Description';
process.env.SEMESTER_START = '2024-03-01';
process.env.PUBLIC_PATH = path.join(__dirname, '..', 'src', 'public');

const request = require('supertest');
const { app, init, resolveEditPassword, checkStorageWritable, createDefaultSchedule } = require('../src/server/server');

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

    it('静态入口也应带安全响应头', async () => {
      const res = await request(app).get('/').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('每次创建默认课表时应生成当前时间的 updatedAt', () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date('2026-06-07T01:00:00.000Z'));
        const first = createDefaultSchedule();
        jest.setSystemTime(new Date('2026-06-07T02:00:00.000Z'));
        const second = createDefaultSchedule();

        expect(first.updatedAt).toBe('2026-06-07T01:00:00.000Z');
        expect(second.updatedAt).toBe('2026-06-07T02:00:00.000Z');
      } finally {
        jest.useRealTimers();
      }
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

    it.each([
      ['非整数 startWeek', { startWeek: 1.5 }],
      ['非整数 endWeek', { endWeek: '16' }],
      ['startWeek 大于 endWeek', { startWeek: 12, endWeek: 2 }],
      ['未知 weekType', { weekType: 'monthly' }]
    ])('应拒绝无效周元数据：%s', async (_name, overrides) => {
      const course = {
        id: 'invalid-week-meta',
        name: '异常周次课程',
        location: 'A101',
        teacher: '张老师',
        period: '1',
        type: 'default',
        startWeek: 1,
        endWeek: 16,
        weekType: 'all',
        ...overrides
      };

      const res = await request(app)
        .put('/api/schedule/courses')
        .send({
          password: 'test123',
          courses: {
            monday: [course],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: []
          }
        })
        .expect(400);

      expect(res.body.error).toBe('Invalid courses data');
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

    it.each([null, false])('periodSettings=%p 时应返回 400', async invalidPeriodSettings => {
      const res = await request(app)
        .put('/api/schedule/settings')
        .send({
          password: 'test123',
          periodSettings: invalidPeriodSettings
        })
        .expect(400);

      expect(res.body.error).toBe('Invalid periodSettings');
    });

    it.each(['2026-02-30', 'not-a-date', ''])('semesterStart=%p 时应返回 400 且不更新状态', async invalidSemesterStart => {
      const before = await request(app).get('/api/schedule').expect(200);

      const res = await request(app)
        .put('/api/schedule/settings')
        .send({
          password: 'test123',
          semesterStart: invalidSemesterStart
        })
        .expect(400);

      expect(res.body.error).toBe('Invalid semesterStart');
      const after = await request(app).get('/api/schedule').expect(200);
      expect(after.body.semesterStart).toBe(before.body.semesterStart);
    });
  });

  describe('GET /api/export', () => {
    it('应导出 JSON 文件，且 Content-Disposition 包含 RFC 5987 filename* 和 ASCII fallback', async () => {
      const res = await request(app)
        .get('/api/export')
        .expect(200)
        .expect('Content-Type', /json/);
      const cd = res.headers['content-disposition'];
      expect(cd).toContain('attachment');
      expect(cd).toContain('filename="schedule_export.json"');
      expect(cd).toContain('filename*=UTF-8');
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

    it('导入旧数据时应按 periodSettings 和课程节次修正 totalPeriods', async () => {
      const periodSettings = Array.from({ length: 13 }, (_, i) => ({
        startTime: `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:00`,
        duration: 40
      }));
      const payload = {
        password: 'test123',
        data: {
          name: '13节旧课表',
          totalPeriods: 12,
          courses: {
            monday: [{
              id: 'legacy-13',
              name: '晚间课程',
              period: '12-13',
              type: 'default',
              startWeek: 1,
              endWeek: 20,
              weekType: 'all'
            }],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: []
          },
          periodSettings
        }
      };

      await request(app)
        .post('/api/import')
        .send(payload)
        .expect(200);

      const res = await request(app).get('/api/schedule').expect(200);
      expect(res.body.totalPeriods).toBe(13);
      expect(res.body.periodSettings).toHaveLength(13);
      expect(res.body.courses.monday[0].period).toBe('12-13');
    });

    it('导入旧数据时应补齐短于课程节次的 periodSettings', async () => {
      const periodSettings = Array.from({ length: 12 }, (_, i) => ({
        startTime: `${String(8 + i).padStart(2, '0')}:00`,
        duration: 45
      }));
      const payload = {
        password: 'test123',
        data: {
          name: '短节次设置旧课表',
          totalPeriods: 12,
          courses: {
            monday: [{
              id: 'legacy-short-settings',
              name: '第十三节课程',
              period: '13',
              type: 'default',
              startWeek: 1,
              endWeek: 20,
              weekType: 'all'
            }],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: []
          },
          periodSettings
        }
      };

      await request(app)
        .post('/api/import')
        .send(payload)
        .expect(200);

      const res = await request(app).get('/api/schedule').expect(200);
      expect(res.body.totalPeriods).toBe(13);
      expect(res.body.periodSettings).toHaveLength(13);
      expect(res.body.periodSettings[12].startTime).toBe('19:55');
      expect(res.body.courses.monday[0].period).toBe('13');
    });

    it('导入旧数据自动补齐大节次时不应生成 24 点后的时间', async () => {
      const latePeriodSettings = Array.from({ length: 14 }, (_, i) => ({
        startTime: i === 13
          ? '23:35'
          : `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${String((i % 2) * 30).padStart(2, '0')}`,
        duration: 45
      }));

      await request(app)
        .put('/api/schedule/settings')
        .send({
          password: 'test123',
          totalPeriods: 14,
          periodSettings: latePeriodSettings
        })
        .expect(200);

      const payload = {
        password: 'test123',
        data: {
          name: '20节旧课表',
          totalPeriods: 20,
          courses: {
            monday: [{
              id: 'legacy-20',
              name: '跨午夜课程',
              period: '20',
              type: 'default',
              startWeek: 1,
              endWeek: 20,
              weekType: 'all'
            }],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: []
          }
        }
      };

      await request(app)
        .post('/api/import')
        .send(payload)
        .expect(200);

      const res = await request(app).get('/api/schedule').expect(200);
      expect(res.body.totalPeriods).toBe(20);
      expect(res.body.periodSettings).toHaveLength(20);
      expect(res.body.periodSettings[14].startTime).toBe('00:30');
      expect(res.body.periodSettings.every(p => /^([01]\d|2[0-3]):([0-5]\d)$/.test(p.startTime))).toBe(true);
    });

    it('导入超大节次范围时应返回 400 而不是展开范围', async () => {
      const payload = {
        password: 'test123',
        data: {
          name: '超大节次旧课表',
          totalPeriods: 12,
          courses: {
            monday: [{
              id: 'legacy-huge-range',
              name: '异常范围课程',
              period: '1-999999999999999999',
              type: 'default',
              startWeek: 1,
              endWeek: 20,
              weekType: 'all'
            }],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: []
          }
        }
      };

      const res = await request(app)
        .post('/api/import')
        .send(payload)
        .expect(400);

      expect(res.body.error).toBe('Invalid totalPeriods');
    });

    it.each([
      ['非整数 startWeek', { startWeek: 1.5 }],
      ['startWeek 大于 endWeek', { startWeek: 8, endWeek: 3 }],
      ['未知 weekType', { weekType: 'monthly' }],
      ['节次无法解析', { period: 'abc' }]
    ])('导入时应拒绝无效课程字段：%s', async (_name, overrides) => {
      const payload = {
        password: 'test123',
        data: {
          name: '异常周元数据课表',
          courses: {
            monday: [{
              id: 'import-invalid-week-meta',
              name: '异常周次课程',
              period: '1',
              type: 'default',
              startWeek: 1,
              endWeek: 16,
              weekType: 'all',
              ...overrides
            }],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: []
          }
        }
      };

      const res = await request(app)
        .post('/api/import')
        .send(payload)
        .expect(400);

      expect(res.body.error).toBe('Invalid courses structure');
    });

    it('导入应恢复 announcements 与 makeupDays 并原样回读', async () => {
      const payload = {
        password: 'test123',
        data: {
          name: '备份恢复班',
          courses: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [] },
          announcements: [{
            id: 'ann-fic-1', title: '虚构活动通知', content: '虚构内容：本周活动暂停一次',
            startDate: '2026-09-01', endDate: '2026-09-07', enabled: true
          }],
          makeupDays: [{
            id: 'mk-fic-1', date: '2026-09-20', name: '虚构调休日', status: 'confirmed', copyFrom: 'friday',
            courses: [{ id: 'c-fic-1', name: '虚构围棋入门', period: '1-2', teacher: '测试教师己', location: '虚拟楼C000' }]
          }]
        }
      };

      await request(app)
        .post('/api/import')
        .send(payload)
        .expect(200);

      const res = await request(app).get('/api/schedule').expect(200);
      expect(res.body.announcements).toHaveLength(1);
      expect(res.body.announcements[0].title).toBe('虚构活动通知');
      expect(res.body.makeupDays).toHaveLength(1);
      expect(res.body.makeupDays[0].date).toBe('2026-09-20');
      expect(res.body.makeupDays[0].courses[0].name).toBe('虚构围棋入门');
    });

    it.each([
      ['重复日期', [
        { id: 'mk-d1', date: '2026-09-20', name: '', status: 'pending', copyFrom: null, courses: [] },
        { id: 'mk-d2', date: '2026-09-20', name: '', status: 'pending', copyFrom: null, courses: [] }
      ]],
      ['课程节次无法解析', [{
        id: 'mk-d3', date: '2026-09-21', name: '', status: 'confirmed', copyFrom: null,
        courses: [{ name: '虚构手工课', period: 'abc' }]
      }]],
      ['status 枚举外', [{ id: 'mk-d4', date: '2026-09-22', name: '', status: 'maybe', copyFrom: null, courses: [] }]],
      ['非数组', 'not-an-array']
    ])('导入时应拒绝非法 makeupDays：%s', async (_name, makeupDays) => {
      const res = await request(app)
        .post('/api/import')
        .send({
          password: 'test123',
          data: {
            name: '异常补课日课表',
            courses: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [] },
            makeupDays
          }
        })
        .expect(400);

      expect(res.body.error).toBe('Invalid makeupDays');
    });
  });

  describe('GET /api/announcements', () => {
    it('未授权时不应返回管理用公告列表', async () => {
      await request(app).get('/api/announcements').expect(403);
    });

    it('带正确 header 密码时应返回公告列表', async () => {
      const res = await request(app)
        .get('/api/announcements')
        .set('x-password', 'test123')
        .expect(200);
      expect(Array.isArray(res.body.announcements)).toBe(true);
    });
  });

  describe('POST /api/announcements', () => {
    it.each([
      ['startDate', { startDate: '2026-02-30' }, 'Invalid startDate format'],
      ['endDate', { endDate: '2026-02-30' }, 'Invalid endDate format']
    ])('应拒绝无效日历日期：%s', async (_field, dateFields, expectedError) => {
      const res = await request(app)
        .post('/api/announcements')
        .send({
          password: 'test123',
          announcement: {
            title: '日期异常公告',
            content: '内容',
            ...dateFields
          }
        })
        .expect(400);

      expect(res.body.error).toBe(expectedError);
    });

    it('应拒绝开始日期晚于结束日期的公告', async () => {
      const res = await request(app)
        .post('/api/announcements')
        .send({
          password: 'test123',
          announcement: {
            title: '日期范围异常公告',
            content: '内容',
            startDate: '2026-06-20',
            endDate: '2026-06-01'
          }
        })
        .expect(400);

      expect(res.body.error).toBe('Invalid date range');
    });
  });

  describe('GET /healthz', () => {
    it('持久化目录可写时应返回健康状态', async () => {
      const res = await request(app).get('/healthz').expect(200);
      expect(res.body).toEqual({ ok: true, service: 'schedule-web' });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('应实际验证写入和原子重命名', async () => {
      await expect(checkStorageWritable(process.env.DATA_FILE)).resolves.toBeUndefined();
      const files = await fs.readdir(tmpDir);
      expect(files.some(file => file.startsWith('.healthz.'))).toBe(false);
    });

    it('持久化目录不存在时应报告不可写', async () => {
      const missingDataFile = path.join(tmpDir, 'missing', 'schedule.json');
      await expect(checkStorageWritable(missingDataFile)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  describe('EDIT_PASSWORD 配置', () => {
    it('未设置时应生成随机密码', () => {
      const result = resolveEditPassword({});
      expect(result.generated).toBe(true);
      expect(result.value).toMatch(/^\d{6}$/);
    });

    it('设置具体值时应使用固定密码', () => {
      expect(resolveEditPassword({ EDIT_PASSWORD: 'abc123' })).toEqual({
        value: 'abc123',
        generated: false
      });
    });

    it('显式空字符串应关闭密码保护', () => {
      expect(resolveEditPassword({ EDIT_PASSWORD: '' })).toEqual({
        value: '',
        generated: false
      });
    });

    it('Compose 自动生成标记应按未设置处理', () => {
      const result = resolveEditPassword({ EDIT_PASSWORD: '__AUTO_GENERATE__' });
      expect(result.generated).toBe(true);
      expect(result.value).toMatch(/^\d{6}$/);
    });
  });
});
