/**
 * 课程自定义上课时间（customStart / customEnd）测试
 * - ICS 常规周次展开与调休补课日：两字段同时存在且合法（HH:MM、end > start）时
 *   直接用作事件起止时间，不再查 periodSettings
 * - 非法值（格式错 / 时分超界 / end<=start / 仅单边）在 ICS 导出中回退 periodSettings 推导
 * - 服务端校验 isValidCourse / isValidMakeupDays：非法值拒绝，合法值通过
 * - UID 哈希不含自定义时间：加/去 customStart/customEnd 后同一事件 UID 稳定
 * 注意：本文件 fixture 全部为虚构数据（假课名/假人名/假教室）
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;

process.env.NODE_ENV = 'test';

const tmpDir = path.join(os.tmpdir(), `schedule-custom-time-test-${Date.now()}`);
process.env.DATA_FILE = path.join(tmpDir, 'schedule.json');
process.env.LOG_DIR = path.join(tmpDir, 'logs');
process.env.EDIT_PASSWORD = 'test123';
process.env.CLASS_NAME = 'CustomTimeTestClass';
process.env.SEMESTER_START = '2026-08-31';
process.env.PUBLIC_PATH = path.join(__dirname, '..', 'src', 'public');

const request = require('supertest');
const { app, init, buildCalendarIcs, isValidMakeupDays } = require('../src/server/server');

// 虚构课表：周一第 1-2 节（08:00-09:40），共 2 周
const baseSchedule = {
  name: '自定义时间测试班',
  semesterStart: '2026-08-31',
  totalPeriods: 2,
  totalWeeks: 2,
  periodSettings: [
    { startTime: '08:00', duration: 45 },
    { startTime: '08:55', duration: 45 }
  ],
  courses: {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: []
  },
  announcements: []
};

function scheduleWithCourse(course) {
  return {
    ...baseSchedule,
    courses: { ...baseSchedule.courses, monday: [course] }
  };
}

// 只比较课程事件 UID：sw-daily 时段汇总事件的 UID 含时段归属，
// 自定义时间改变实际开始时间会改变时段归属（见 slotOfActualStartMinutes），
// 汇总事件随之更新属预期行为，不属于「同一事件 UID 稳定」的考察范围
function swUids(ics) {
  return ics.split('\r\n')
    .filter(l => l.startsWith('UID:sw-') && !l.startsWith('UID:sw-daily-') && !l.startsWith('UID:swm-'))
    .sort();
}

describe('customStart/customEnd：ICS 常规周次展开', () => {
  it('两字段合法时直接用作事件起止时间，不查 periodSettings', () => {
    const ics = buildCalendarIcs(scheduleWithCourse({
      name: '虚构烹饪理论', period: '1-2', teacher: '测试教师甲', location: '虚拟楼A000',
      customStart: '14:30', customEnd: '16:10'
    }));
    expect(ics).toContain('DTSTART;TZID=Asia/Shanghai:20260831T143000');
    expect(ics).toContain('DTEND;TZID=Asia/Shanghai:20260831T161000');
    expect(ics).not.toContain('DTSTART;TZID=Asia/Shanghai:20260831T080000');
    expect(ics).toContain('LOCATION:虚拟楼A000');
  });

  it('支持单位数小时写法（如 8:05）', () => {
    const ics = buildCalendarIcs(scheduleWithCourse({
      name: '虚构园艺实践', period: '1', customStart: '8:05', customEnd: '9:50'
    }));
    expect(ics).toContain('DTSTART;TZID=Asia/Shanghai:20260831T080500');
    expect(ics).toContain('DTEND;TZID=Asia/Shanghai:20260831T095000');
  });

  it('不带自定义字段时维持 periodSettings 推导', () => {
    const ics = buildCalendarIcs(scheduleWithCourse({
      name: '虚构天文导论', period: '1-2', teacher: '测试教师乙'
    }));
    expect(ics).toContain('DTSTART;TZID=Asia/Shanghai:20260831T080000');
    expect(ics).toContain('DTEND;TZID=Asia/Shanghai:20260831T094000');
  });

  it('非法值回退 periodSettings：格式错、时分超界、end<=start、仅单边', () => {
    const cases = [
      { customStart: '下午两点半', customEnd: '16:10' },   // 格式错
      { customStart: '25:00', customEnd: '16:10' },       // 小时超界
      { customStart: '14:60', customEnd: '16:10' },       // 分钟超界
      { customStart: '16:10', customEnd: '14:30' },       // end < start
      { customStart: '14:30', customEnd: '14:30' },       // end == start
      { customStart: '14:30' },                           // 仅单边
      { customEnd: '16:10' }                              // 仅单边
    ];
    for (const extra of cases) {
      const ics = buildCalendarIcs(scheduleWithCourse({
        name: '虚构陶艺基础', period: '1-2', ...extra
      }));
      expect(ics).toContain('DTSTART;TZID=Asia/Shanghai:20260831T080000');
      expect(ics).toContain('DTEND;TZID=Asia/Shanghai:20260831T094000');
    }
  });

  it('UID 稳定：同一课程加/去自定义时间后 UID 集合不变（哈希输入不含 custom 字段）', () => {
    const withCustom = buildCalendarIcs(scheduleWithCourse({
      name: '虚构木工实训', period: '1-2', teacher: '测试教师丙', location: '虚拟楼B000',
      customStart: '14:30', customEnd: '16:10'
    }));
    const withoutCustom = buildCalendarIcs(scheduleWithCourse({
      name: '虚构木工实训', period: '1-2', teacher: '测试教师丙', location: '虚拟楼B000'
    }));
    expect(swUids(withCustom)).toEqual(swUids(withoutCustom));
    expect(swUids(withCustom).length).toBeGreaterThan(0);
  });
});

describe('customStart/customEnd：调休补课日', () => {
  const makeupSchedule = course => ({
    ...baseSchedule,
    makeupDays: [{
      id: 'mk-custom-1', date: '2026-09-20', name: '虚构调休日', status: 'confirmed', copyFrom: 'monday',
      courses: [course]
    }]
  });

  it('confirmed 补课日课程带合法自定义时间时按自定义时间生成事件', () => {
    const ics = buildCalendarIcs(makeupSchedule({
      name: '虚构围棋入门', period: '1-2', teacher: '测试教师丁',
      customStart: '19:00', customEnd: '20:40'
    }));
    expect(ics).toContain('DTSTART;TZID=Asia/Shanghai:20260920T190000');
    expect(ics).toContain('DTEND;TZID=Asia/Shanghai:20260920T204000');
    expect(ics).not.toContain('DTSTART;TZID=Asia/Shanghai:20260920T080000');
  });

  it('补课日课程自定义时间非法时回退 periodSettings 推导', () => {
    const ics = buildCalendarIcs(makeupSchedule({
      name: '虚构茶艺鉴赏', period: '1-2',
      customStart: '20:40', customEnd: '19:00'
    }));
    expect(ics).toContain('DTSTART;TZID=Asia/Shanghai:20260920T080000');
    expect(ics).toContain('DTEND;TZID=Asia/Shanghai:20260920T094000');
  });
});

describe('customStart/customEnd：服务端数据校验', () => {
  const makeupDayWithCourse = course => [{
    id: 'mk-val-1', date: '2026-09-20', name: null, status: 'confirmed', copyFrom: null,
    courses: [course]
  }];

  it('isValidMakeupDays 接受合法自定义时间（含仅单边，ICS 中回退）', () => {
    expect(isValidMakeupDays(makeupDayWithCourse({
      name: '虚构合唱排练', period: '1', customStart: '18:00', customEnd: '19:30'
    }))).toBe(true);
    expect(isValidMakeupDays(makeupDayWithCourse({
      name: '虚构合唱排练', period: '1', customStart: '18:00'
    }))).toBe(true);
  });

  it('isValidMakeupDays 拒绝非法自定义时间：格式错、超界、end<=start', () => {
    const base = { name: '虚构书法练习', period: '1' };
    expect(isValidMakeupDays(makeupDayWithCourse({ ...base, customStart: '18点' }))).toBe(false);
    expect(isValidMakeupDays(makeupDayWithCourse({ ...base, customStart: '18:00', customEnd: '24:00' }))).toBe(false);
    expect(isValidMakeupDays(makeupDayWithCourse({ ...base, customStart: '19:30', customEnd: '18:00' }))).toBe(false);
    expect(isValidMakeupDays(makeupDayWithCourse({ ...base, customStart: 1800 }))).toBe(false);
  });

  describe('POST /api/import', () => {
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

    it('合法自定义时间的课程可导入并原样回读', async () => {
      await request(app)
        .post('/api/import')
        .send({
          password: 'test123',
          data: scheduleWithCourse({
            name: '虚构舞蹈形体', period: '1-2', teacher: '测试教师戊',
            customStart: '15:00', customEnd: '16:40'
          })
        })
        .expect(200);
      const res = await request(app).get('/api/schedule').expect(200);
      expect(res.body.courses.monday[0].customStart).toBe('15:00');
      expect(res.body.courses.monday[0].customEnd).toBe('16:40');
    });

    it('非法自定义时间（end<=start）的课程导入被拒绝', async () => {
      await request(app)
        .post('/api/import')
        .send({
          password: 'test123',
          data: scheduleWithCourse({
            name: '虚构瑜伽塑形', period: '1', customStart: '16:40', customEnd: '15:00'
          })
        })
        .expect(400);
    });
  });
});
