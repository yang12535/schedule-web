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

  describe('PUT /api/schedule/makeup-days', () => {
    const validMakeupDays = [
      {
        id: 'md-1',
        date: '2026-10-10',
        name: '国庆节调休',
        status: 'confirmed',
        copyFrom: 'friday',
        courses: [{ name: '补课·分析化学', period: '1-2', teacher: '李四', location: 'D404' }]
      }
    ];

    it('应能整体替换补课日并回读一致', async () => {
      await request(app)
        .put('/api/schedule/makeup-days')
        .send({ password: 'test123', makeupDays: validMakeupDays })
        .expect(200);

      const res = await request(app).get('/api/schedule').expect(200);
      expect(res.body.makeupDays).toHaveLength(1);
      expect(res.body.makeupDays[0]).toMatchObject({ id: 'md-1', date: '2026-10-10', status: 'confirmed' });
    });

    it('未授权应返回 403', async () => {
      await request(app)
        .put('/api/schedule/makeup-days')
        .send({ password: 'wrong', makeupDays: validMakeupDays })
        .expect(403);
    });

    it.each([
      ['日期重复', [
        { id: 'a', date: '2026-10-10', status: 'confirmed', courses: [] },
        { id: 'b', date: '2026-10-10', status: 'pending', courses: [] }
      ]],
      ['id 重复', [
        { id: 'a', date: '2026-10-10', status: 'confirmed', courses: [] },
        { id: 'a', date: '2026-10-11', status: 'pending', courses: [] }
      ]],
      ['非法 status', [
        { id: 'a', date: '2026-10-10', status: 'maybe', courses: [] }
      ]],
      ['非法日历日期', [
        { id: 'a', date: '2026-02-30', status: 'confirmed', courses: [] }
      ]],
      ['课程节次不可解析', [
        { id: 'a', date: '2026-10-10', status: 'confirmed', courses: [{ name: '坏课', period: 'abc' }] }
      ]]
    ])('应拒绝非法补课日数据：%s', async (_name, makeupDays) => {
      const res = await request(app)
        .put('/api/schedule/makeup-days')
        .send({ password: 'test123', makeupDays })
        .expect(400);
      expect(res.body.error).toBe('Invalid makeupDays data');
    });

    it('补课课程节次超过 totalPeriods 时应返回 400（避免 ICS 导出时静默跳过）', async () => {
      // 当前数据文件 totalPeriods=12（前一个 settings 用例写入）
      const res = await request(app)
        .put('/api/schedule/makeup-days')
        .send({
          password: 'test123',
          makeupDays: [{ id: 'a', date: '2026-10-10', status: 'confirmed', courses: [{ name: '超节次补课', period: '13-14' }] }]
        })
        .expect(400);
      expect(res.body.error).toBe('Course period exceeds totalPeriods');
    });
  });

  describe('课程节次与 totalPeriods 一致性防护（M27 审计 P1#1/#2/#3）', () => {
    it('PUT /api/schedule/courses 应拒绝节次超出 totalPeriods 的课程（否则 ICS 静默丢课）', async () => {
      const res = await request(app)
        .put('/api/schedule/courses')
        .send({
          password: 'test123',
          courses: {
            monday: [{ id: 'over-1', name: '超节次课', period: '13' }],
            tuesday: [], wednesday: [], thursday: [], friday: []
          }
        })
        .expect(400);
      expect(res.body.error).toBe('Course period exceeds totalPeriods');

      // 数据未被写入
      const after = await request(app).get('/api/schedule').expect(200);
      expect(after.body.courses.monday.some(c => c.name === '超节次课')).toBe(false);
    });

    it('settings 缩小 totalPeriods 产生孤儿课程时应返回 400', async () => {
      // 先写入 period=12 的课程（当前 totalPeriods=12）
      await request(app)
        .put('/api/schedule/courses')
        .send({
          password: 'test123',
          courses: {
            monday: [{ id: 'p12', name: '第十二节课', period: '12' }],
            tuesday: [], wednesday: [], thursday: [], friday: []
          }
        })
        .expect(200);

      const res = await request(app)
        .put('/api/schedule/settings')
        .send({ password: 'test123', totalPeriods: 8 })
        .expect(400);
      expect(res.body.error).toBe('Course period exceeds totalPeriods');

      // 缩小被拒后 totalPeriods 维持 12，name 等非节次更新不受影响
      const after = await request(app).get('/api/schedule').expect(200);
      expect(after.body.totalPeriods).toBe(12);
      await request(app)
        .put('/api/schedule/settings')
        .send({ password: 'test123', name: 'TestClass' })
        .expect(200);
    });

    it('import 应按补课日课程节次一并扩充 totalPeriods（P1#3）', async () => {
      const payload = {
        password: 'test123',
        data: {
          name: '含超节次补课课表',
          totalPeriods: 12,
          courses: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [] },
          periodSettings: Array.from({ length: 12 }, (_, i) => ({
            startTime: `${String(8 + i).padStart(2, '0')}:00`,
            duration: 45
          })),
          makeupDays: [{
            id: 'md-over',
            date: '2026-10-10',
            status: 'confirmed',
            copyFrom: 'friday',
            courses: [{ name: '第十三节补课', period: '13' }]
          }]
        }
      };

      await request(app).post('/api/import').send(payload).expect(200);

      const res = await request(app).get('/api/schedule').expect(200);
      expect(res.body.totalPeriods).toBe(13);
      expect(res.body.periodSettings).toHaveLength(13);
      expect(res.body.makeupDays[0].courses[0].period).toBe('13');
    });
  });

  describe('请求体解析（M27 审计 P2#8）', () => {
    it('malformed JSON 请求体应返回 400 而非 500', async () => {
      const res = await request(app)
        .post('/api/verify')
        .set('Content-Type', 'application/json')
        .send('{"password": broken')
        .expect(400);
      expect(res.body.error).toMatch(/Malformed JSON/i);
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

      expect(res.body.error).toBe('Invalid courses structure'); // 9/1 起结构校验前置，异常 period 范围在结构阶段即拒绝（仍是 400，不展开）
    });

    it.each([
      ['非整数 startWeek', { startWeek: 1.5 }],
      ['startWeek 大于 endWeek', { startWeek: 8, endWeek: 3 }],
      ['未知 weekType', { weekType: 'monthly' }]
    ])('导入时应拒绝无效周元数据：%s', async (_name, overrides) => {
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

  describe('历史数据课程 id 回填（M30）', () => {
    // 旧格式数据：课程对象只有 name/period/location/teacher，没有 id（线上数据实证形态，
    // 见 finding 20260925-reviewer-front-bug-id）
    const legacyData = {
      name: '旧数据班',
      semesterStart: '2024-03-01',
      totalPeriods: 2,
      totalWeeks: 16,
      periodSettings: [
        { startTime: '08:00', duration: 45 },
        { startTime: '08:55', duration: 45 }
      ],
      courses: {
        monday: [{ name: '高数', period: '1-2', location: 'A101', teacher: '张老师' }],
        tuesday: [{ name: '英语', period: '1' }],
        wednesday: [],
        thursday: [],
        friday: []
      },
      announcements: [],
      makeupDays: [
        {
          id: 'md-legacy-1',
          date: '2024-04-07',
          name: '清明调休',
          status: 'confirmed',
          copyFrom: 'monday',
          courses: [{ name: '补·高数', period: '1-2' }]
        }
      ]
    };
    const idsOf = body => [
      ...Object.values(body.courses).flatMap(list => list.map(c => c.id)),
      ...body.makeupDays.flatMap(day => day.courses.map(c => c.id))
    ];
    const expectAllHaveIds = body => {
      const ids = idsOf(body);
      expect(ids).toHaveLength(3); // 2 门周课 + 1 门补课日课程
      expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
      return ids;
    };

    it('加载旧格式数据时回填缺 id 课程（含 makeupDays）并持久化，二次加载幂等不再变', async () => {
      await fs.writeFile(process.env.DATA_FILE, JSON.stringify(legacyData, null, 2));

      const first = await request(app).get('/api/schedule').expect(200);
      const firstIds = expectAllHaveIds(first.body);

      // 回填结果已落盘持久化
      const persistedRaw = await fs.readFile(process.env.DATA_FILE, 'utf8');
      expect(idsOf(JSON.parse(persistedRaw))).toEqual(firstIds);

      // 绕过 mtime 缓存强制二次加载：id 不变，且文件不再被改写（幂等）
      const stat = await fs.stat(process.env.DATA_FILE);
      await fs.utimes(process.env.DATA_FILE, stat.atime, new Date(stat.mtimeMs + 2000));
      const second = await request(app).get('/api/schedule').expect(200);
      expect(idsOf(second.body)).toEqual(firstIds);
      expect(await fs.readFile(process.env.DATA_FILE, 'utf8')).toBe(persistedRaw);
    });

    it('GET /api/schedule 输出的课程必有 id（前端 data-id 依赖的接口契约）', async () => {
      const res = await request(app).get('/api/schedule').expect(200);
      expectAllHaveIds(res.body);
    });

    it('导入无 id 的旧数据后 GET 输出即有 id（写入口统一回填）', async () => {
      const res = await request(app)
        .post('/api/import')
        .send({ password: 'test123', data: legacyData })
        .expect(200);
      expect(res.body.success).toBe(true);
      expectAllHaveIds(res.body.schedule);
    });
  });
});
