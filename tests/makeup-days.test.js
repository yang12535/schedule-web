/**
 * 调休补课日（「班」日）测试
 * - PUT /api/schedule/makeup-days：整体替换、密码校验、数据校验
 * - ICS：confirmed 按日期生成事件、pending 跳过、UID 稳定、DESCRIPTION 标注补课
 * - 复制逻辑：makeup-days.js 的 copyCoursesForMakeupDay 深拷贝
 * - 前端字符串断言：徽章文案、只读隐藏编辑入口
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;

// 显式设置测试环境，确保限流/定时器等行为一致
process.env.NODE_ENV = 'test';

const tmpDir = path.join(os.tmpdir(), `schedule-makeup-test-${Date.now()}`);
process.env.DATA_FILE = path.join(tmpDir, 'schedule.json');
process.env.LOG_DIR = path.join(tmpDir, 'logs');
process.env.EDIT_PASSWORD = 'test123';
process.env.CLASS_NAME = 'MakeupTestClass';
process.env.SEMESTER_START = '2026-08-31';
process.env.PUBLIC_PATH = path.join(__dirname, '..', 'src', 'public');

const request = require('supertest');
const { app, init, buildCalendarIcs, createDefaultSchedule, isValidMakeupDays, createReadonlyApp } = require('../src/server/server');
const MakeupDays = require('../src/public/js/makeup-days');

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

const baseSchedule = {
  name: '补课测试班',
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

describe('调休补课日', () => {
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

  describe('数据模型与校验', () => {
    it('createDefaultSchedule 的 makeupDays 默认为 []', () => {
      expect(createDefaultSchedule().makeupDays).toEqual([]);
    });

    it('isValidMakeupDays 校验日期格式、状态枚举与 courses 结构', () => {
      const valid = [{
        id: 'mk-1', date: '2026-09-20', name: '中秋节调休',
        status: 'confirmed', copyFrom: 'friday',
        courses: [{ name: '体育理论', period: '1', teacher: '李老师', location: '教学楼C303' }]
      }];
      expect(isValidMakeupDays(valid)).toBe(true);
      // name 可空、copyFrom 可为 null、pending 可空 courses
      expect(isValidMakeupDays([{ id: 'mk-2', date: '2026-10-10', name: null, status: 'pending', copyFrom: null, courses: [] }])).toBe(true);
      expect(isValidMakeupDays([{ id: 'mk-3', date: '2026-02-30', status: 'pending', courses: [] }])).toBe(false); // 非法日期
      expect(isValidMakeupDays([{ id: 'mk-3', date: 'not-a-date', status: 'pending', courses: [] }])).toBe(false);
      expect(isValidMakeupDays([{ id: 'mk-3', date: '2026-09-20', status: 'unknown', courses: [] }])).toBe(false); // 状态枚举
      expect(isValidMakeupDays([{ id: 'mk-3', date: '2026-09-20', status: 'confirmed', copyFrom: 'sunday', courses: [] }])).toBe(false); // copyFrom 枚举
      expect(isValidMakeupDays([{ id: 'mk-3', date: '2026-09-20', status: 'confirmed', courses: [{ name: '', period: '1' }] }])).toBe(false); // 课名为空
      expect(isValidMakeupDays([{ id: 'mk-3', date: '2026-09-20', status: 'confirmed', courses: [{ name: '数学', period: '' }] }])).toBe(false); // 节次为空
      expect(isValidMakeupDays([{ id: '', date: '2026-09-20', status: 'pending', courses: [] }])).toBe(false); // id 为空
      expect(isValidMakeupDays('not-an-array')).toBe(false);
    });
  });

  describe('PUT /api/schedule/makeup-days', () => {
    it('应能整体替换 makeupDays 并通过 GET /api/schedule 回读', async () => {
      const makeupDays = [
        { id: 'mk-1', date: '2026-09-20', name: '中秋节调休', status: 'pending', copyFrom: null, courses: [] },
        {
          id: 'mk-2', date: '2026-10-10', name: '国庆节调休', status: 'confirmed', copyFrom: 'friday',
          courses: [{ id: 'c-1', name: '体育理论', period: '1', teacher: '李老师', location: '教学楼C303' }]
        }
      ];

      await request(app)
        .put('/api/schedule/makeup-days')
        .send({ password: 'test123', makeupDays })
        .expect(200);

      const res = await request(app).get('/api/schedule').expect(200);
      expect(res.body.makeupDays).toHaveLength(2);
      expect(res.body.makeupDays[1].copyFrom).toBe('friday');
      expect(res.body.makeupDays[1].courses[0].name).toBe('体育理论');
    });

    it('未授权应返回 403', async () => {
      await request(app)
        .put('/api/schedule/makeup-days')
        .send({ password: 'wrong', makeupDays: [] })
        .expect(403);
    });

    it('无效数据应返回 400', async () => {
      await request(app)
        .put('/api/schedule/makeup-days')
        .send({ password: 'test123', makeupDays: [{ id: 'x', date: '2026-13-01', status: 'pending', courses: [] }] })
        .expect(400);
      await request(app)
        .put('/api/schedule/makeup-days')
        .send({ password: 'test123', makeupDays: 'not-an-array' })
        .expect(400);
    });

    it('只读入口写接口一律 403', async () => {
      const readonlyApp = createReadonlyApp();
      await request(readonlyApp)
        .put('/api/schedule/makeup-days')
        .send({ password: 'test123', makeupDays: [] })
        .expect(403);
    });
  });

  describe('ICS 中的补课日', () => {
    const scheduleWithMakeup = {
      ...baseSchedule,
      makeupDays: [
        {
          id: 'mk-1', date: '2026-09-20', name: '中秋节调休', status: 'confirmed', copyFrom: 'friday',
          courses: [{ name: '体育理论', period: '1-2', teacher: '李老师', location: '教学楼C303' }]
        },
        {
          id: 'mk-2', date: '2026-10-10', name: '国庆节调休', status: 'pending', copyFrom: null,
          courses: [{ name: '不应出现的课', period: '1' }]
        }
      ]
    };

    it('confirmed 补课日按 date 直接生成事件（不走周次展开，仅 1 个）', () => {
      const ics = buildCalendarIcs(scheduleWithMakeup);
      expect(countOccurrences(ics, 'SUMMARY:体育理论')).toBe(1);
      expect(ics).toContain('DTSTART;TZID=Asia/Shanghai:20260920T080000');
      expect(ics).toContain('DTEND;TZID=Asia/Shanghai:20260920T094000');
      expect(ics).toContain('LOCATION:教学楼C303');
    });

    it('pending 补课日不生成事件', () => {
      const ics = buildCalendarIcs(scheduleWithMakeup);
      expect(ics).not.toContain('不应出现的课');
      expect(ics).not.toContain('20261010T');
    });

    it('DESCRIPTION 标注「补课」及 copyFrom（补课·补周五）', () => {
      // 先展开折叠行再断言，避免长行被 foldIcsLine 截断
      const ics = buildCalendarIcs(scheduleWithMakeup).replace(/\r\n /g, '');
      expect(ics).toContain('补课·补周五');
      expect(ics).toContain('2026-09-20 第1-2节');
    });

    it('无 copyFrom 的 confirmed 补课日 DESCRIPTION 仅标注「补课」', () => {
      const ics = buildCalendarIcs({
        ...baseSchedule,
        makeupDays: [{
          id: 'mk-3', date: '2026-09-20', name: null, status: 'confirmed', copyFrom: null,
          courses: [{ name: '自建补课', period: '1' }]
        }]
      }).replace(/\r\n /g, '');
      expect(ics).toContain('SUMMARY:自建补课');
      expect(ics).toMatch(/DESCRIPTION:补课\\n/);
      expect(ics).not.toContain('补课·补周');
    });

    it('补课事件 UID 稳定（date+课程信息哈希）', () => {
      const first = buildCalendarIcs(scheduleWithMakeup);
      const second = buildCalendarIcs(scheduleWithMakeup);
      const uids = t => t.split('\r\n').filter(l => l.startsWith('UID:swm-')).sort();
      expect(uids(first)).toEqual(uids(second));
      expect(uids(first).length).toBeGreaterThan(0);
      for (const uid of uids(first)) {
        expect(uid).toMatch(/^UID:swm-[0-9a-f]{20}@schedule-web$/);
      }
    });

    it('导出的 ICS 所有物理行仍不超过 75 octet', () => {
      const ics = buildCalendarIcs(scheduleWithMakeup);
      for (const line of ics.split('\r\n')) {
        expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
      }
    });
  });

  describe('复制逻辑（makeup-days.js）', () => {
    it('复制 weekday 课程为深拷贝：不改源数据、重新生成 id、剥离周次元数据', () => {
      const courses = {
        monday: [],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [
          { id: 'src-1', name: '体育理论', period: '1', teacher: '李老师', location: '教学楼C303', type: 'default', startWeek: 1, endWeek: 16, weekType: 'odd', skipWeek: 3 },
          { id: 'src-2', name: '大学英语', period: '3-4' }
        ]
      };
      const copied = MakeupDays.copyCoursesForMakeupDay(courses, 'friday');
      expect(copied).toHaveLength(2);
      expect(copied[0].name).toBe('体育理论');
      expect(copied[0].teacher).toBe('李老师');
      // 重新生成 id，不与源课程相同
      expect(copied[0].id).not.toBe('src-1');
      // 剥离周次元数据
      expect(copied[0].startWeek).toBeUndefined();
      expect(copied[0].weekType).toBeUndefined();
      expect(copied[0].skipWeek).toBeUndefined();
      // 深拷贝：修改副本不影响源数据
      copied[0].name = '改名';
      expect(courses.friday[0].name).toBe('体育理论');
      // 缺省字段补空字符串
      expect(copied[1].teacher).toBe('');
      expect(copied[1].location).toBe('');
    });

    it('非法 weekday 或空课程返回 []', () => {
      expect(MakeupDays.copyCoursesForMakeupDay({ friday: [] }, 'sunday')).toEqual([]);
      expect(MakeupDays.copyCoursesForMakeupDay(null, 'monday')).toEqual([]);
      expect(MakeupDays.copyCoursesForMakeupDay({ monday: [] }, 'monday')).toEqual([]);
    });

    it('createMakeupDay 默认 pending、copyFrom 为 null、courses 为空', () => {
      const day = MakeupDays.createMakeupDay('2026-09-20', '中秋节调休');
      expect(day.status).toBe('pending');
      expect(day.copyFrom).toBeNull();
      expect(day.courses).toEqual([]);
      expect(day.date).toBe('2026-09-20');
      expect(day.id).toBeTruthy();
    });
  });

  describe('前端字符串断言', () => {
    const fsSync = require('fs');
    const script = fsSync.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'schedule.js'), 'utf8');
    const html = fsSync.readFileSync(path.join(__dirname, '..', 'src', 'public', 'index.html'), 'utf8');

    it('徽章文案：confirmed 显示「班」，pending 显示「待添加·等待通知」', () => {
      expect(script).toContain('<span class="makeup-day-badge confirmed">班</span>');
      expect(script).toContain('<span class="makeup-day-badge pending">待添加·等待通知</span>');
    });

    it('保存走 PUT /api/schedule/makeup-days', () => {
      expect(script).toContain("'/api/schedule/makeup-days'");
      expect(script).toContain("method:'PUT'");
    });

    it('只读入口隐藏编辑入口（renderMakeupDays 遵循 isReadonlyPublic）', () => {
      const renderBody = script.match(/function renderMakeupDays\(\) \{[\s\S]*?\n    \}/);
      expect(renderBody).not.toBeNull();
      expect(renderBody[0]).toContain('isReadonlyPublic');
      expect(renderBody[0]).toContain('isEditMode');
    });

    it('复制 weekday 课程走 ScheduleMakeupDays.copyCoursesForMakeupDay', () => {
      expect(script).toContain('copyCoursesForMakeupDay(schedule.courses, copyFrom)');
    });

    it('index.html 含补课区块与弹窗，且引入 makeup-days.js', () => {
      expect(html).toContain('id="makeupDaysSection"');
      expect(html).toContain('id="makeupDayModal"');
      expect(html).toContain('id="makeupCoursesModal"');
      expect(html).toContain('id="makeupCopyFrom"');
      expect(html).toContain('js/makeup-days.js');
    });
  });
});
