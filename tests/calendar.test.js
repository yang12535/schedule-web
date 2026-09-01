/**
 * ICS 日历订阅导出测试
 * GET /api/calendar.ics：按学期周次展开课程事件，跳过节假日，无需密码
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;

process.env.NODE_ENV = 'test';

const tmpDir = path.join(os.tmpdir(), `schedule-ics-test-${Date.now()}`);
process.env.DATA_FILE = path.join(tmpDir, 'schedule.json');
process.env.LOG_DIR = path.join(tmpDir, 'logs');
process.env.EDIT_PASSWORD = 'test123';
process.env.CLASS_NAME = 'ICS测试班';
process.env.SEMESTER_START = '2026-08-31';
process.env.PUBLIC_PATH = path.join(__dirname, '..', 'src', 'public');

const request = require('supertest');
const crypto = require('crypto');
const { app, init, buildCalendarIcs, buildSlotSummaryTitle, parsePeriodNumbers, foldIcsLine, slotOfFirstPeriod, slotOfActualStartMinutes } = require('../src/server/server');

const seedData = {
  name: 'ICS测试班',
  description: '2026-2027学年第一学期',
  semesterStart: '2026-08-31',
  totalPeriods: 2,
  totalWeeks: 16,
  periodSettings: [
    { startTime: '08:00', duration: 45 },
    { startTime: '08:55', duration: 45 }
  ],
  courses: {
    monday: [
      { name: '高等数学', period: '1-2', teacher: '张老师', location: '教学楼A101' },
      { name: '大学英语', period: '1', teacher: '王老师', location: '教学楼B202', startWeek: 12, endWeek: 15 },
      { name: '单周研讨', period: '2', weekType: 'odd' },
      { name: '临时停课', period: '1', skipWeek: 3 }
    ],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [
      { name: '体育理论', period: '1', teacher: '李老师', location: '教学楼C303' }
    ]
  },
  announcements: []
};

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

describe('GET /api/calendar.ics', () => {
  beforeAll(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await init();
    await request(app)
      .post('/api/import')
      .send({ password: 'test123', data: seedData })
      .expect(200);
  });

  afterAll(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  it('无需密码即可导出，Content-Type 为 text/calendar', async () => {
    const res = await request(app).get('/api/calendar.ics').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/calendar/);
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('END:VCALENDAR');
    expect(res.text).toContain('VERSION:2.0');
  });

  it('按周次展开课程：每周课 16 周减去假期周一（国庆 2026-10-05）共 15 个事件，含正确的起止时间与 VALARM', async () => {
    const res = await request(app).get('/api/calendar.ics').expect(200);
    expect(countOccurrences(res.text, 'SUMMARY:高等数学')).toBe(15);
    expect(res.text).toContain('DTSTART;TZID=Asia/Shanghai:20260831T080000');
    expect(res.text).toContain('DTEND;TZID=Asia/Shanghai:20260831T094000');
    expect(res.text).not.toContain('20261005T080000'); // 国庆假期内的周一
    expect(res.text).toContain('LOCATION:教学楼A101');
    expect(res.text).toContain('TRIGGER:-PT30M'); // 当天首节课（或间隙 ≥30 分钟）课前 30 分钟提醒
    expect(res.text).toContain('TZID:Asia/Shanghai');
  });

  it('尊重周次范围与单双周设置', async () => {
    const res = await request(app).get('/api/calendar.ics').expect(200);
    expect(countOccurrences(res.text, 'SUMMARY:大学英语')).toBe(4); // 仅 12-15 周
    expect(countOccurrences(res.text, 'SUMMARY:单周研讨')).toBe(8); // 16 周内的单周
  });

  it('skipWeek 当周不生成事件（再减去假期周一 2026-10-05）', async () => {
    const res = await request(app).get('/api/calendar.ics').expect(200);
    expect(countOccurrences(res.text, 'SUMMARY:临时停课')).toBe(14);
  });

  it('节假日当天不生成课程事件（中秋 2026-09-25、国庆 2026-10-02 均为周五）', async () => {
    const res = await request(app).get('/api/calendar.ics').expect(200);
    expect(countOccurrences(res.text, 'SUMMARY:体育理论')).toBe(14); // 16 周 - 中秋 - 国庆
    expect(res.text).not.toContain('20260925T080000');
    expect(res.text).not.toContain('20261002T080000');
  });

  it('UID 稳定：两次导出 UID 集合一致', async () => {
    const first = await request(app).get('/api/calendar.ics').expect(200);
    const second = await request(app).get('/api/calendar.ics').expect(200);
    const uids = t => t.split('\r\n').filter(l => l.startsWith('UID:')).sort();
    expect(uids(first.text)).toEqual(uids(second.text));
    expect(uids(first.text)[0]).toMatch(/^UID:sw-[0-9a-f]{20}@schedule-web$/);
  });
});

describe('parsePeriodNumbers', () => {
  it('解析区间、列表与单节次', () => {
    expect(parsePeriodNumbers('1-2')).toEqual([1, 2]);
    expect(parsePeriodNumbers('第3-4节')).toEqual([3, 4]);
    expect(parsePeriodNumbers('1,3')).toEqual([1, 3]);
    expect(parsePeriodNumbers('5')).toEqual([5]);
  });

  it('倒序/乱序的列表输入解析为升序，避免 DTSTART/DTEND 颠倒', () => {
    expect(parsePeriodNumbers('3,1')).toEqual([1, 3]);
    expect(parsePeriodNumbers('第3节,1,2')).toEqual([1, 2, 3]);
  });

  it('非法输入返回空数组', () => {
    expect(parsePeriodNumbers('')).toEqual([]);
    expect(parsePeriodNumbers(null)).toEqual([]);
    expect(parsePeriodNumbers('3-1')).toEqual([]);
    expect(parsePeriodNumbers('abc')).toEqual([]);
  });

  it('严格解析：逗号列表任一 token 非正整数或空段则整体拒绝', () => {
    expect(parsePeriodNumbers('1,,2')).toEqual([]); // 空段
    expect(parsePeriodNumbers('1,abc')).toEqual([]); // 非数字 token
    expect(parsePeriodNumbers('1,0')).toEqual([]); // 非正整数
    expect(parsePeriodNumbers('1,2.5')).toEqual([]); // 非整数
    expect(parsePeriodNumbers(',1')).toEqual([]); // 前导空段
  });

  it('严格解析：超过 20 节上限整体拒绝，且不展开超大范围', () => {
    expect(parsePeriodNumbers('21')).toEqual([]);
    expect(parsePeriodNumbers('1-21')).toEqual([]);
    expect(parsePeriodNumbers('18,21')).toEqual([]);
    // 不得抛 RangeError（Array.from 超大 length），调用方不会因此 500
    expect(() => parsePeriodNumbers('1-999999999999999999')).not.toThrow();
    expect(parsePeriodNumbers('1-999999999999999999')).toEqual([]);
  });
});

describe('课程事件 UID 冲突去重', () => {
  // 只取课程事件 UID（排除 sw-daily 汇总事件与 swm 补课事件）
  const swUids = ics => ics.split('\r\n')
    .filter(l => l.startsWith('UID:sw-') && !l.startsWith('UID:sw-daily-') && !l.startsWith('UID:swm-'));

  const collisionSchedule = courses => ({
    name: 'UID冲突测试班',
    semesterStart: '2026-08-31',
    totalPeriods: 2,
    totalWeeks: 1,
    periodSettings: [
      { startTime: '08:00', duration: 45 },
      { startTime: '08:55', duration: 45 }
    ],
    courses: { monday: courses, tuesday: [], wednesday: [], thursday: [], friday: [] },
    announcements: []
  });

  // 旧算法 UID：名称|day|period|week|location|teacher 的 sha1 前 20 位
  const legacyUid = (course, day, week) => `UID:sw-${crypto.createHash('sha1').update([
    course.name, day, course.period, week, course.location || '', course.teacher || ''
  ].join('|')).digest('hex').slice(0, 20)}@schedule-web`;

  it('两条字段全同的课程得到不同 UID，且重复导出稳定', () => {
    const a = { id: '虚构-id-1', name: '虚构插花艺术', period: '1-2', teacher: '测试教师子', location: '虚拟馆X001' };
    const b = { ...a, id: '虚构-id-2' };
    const ics = buildCalendarIcs(collisionSchedule([a, b]));
    const uids = swUids(ics);
    expect(uids).toHaveLength(2);
    expect(new Set(uids).size).toBe(2);
    // 第一条保持旧算法 UID，第二条追加稳定序号
    expect(uids[0]).toBe(legacyUid(a, 'monday', 1));
    expect(uids[1]).toBe(legacyUid(a, 'monday', 1).replace('@schedule-web', '-2@schedule-web'));
    // 重复导出 UID 集合不变
    expect(swUids(buildCalendarIcs(collisionSchedule([a, b])))).toEqual(uids);
  });

  it('无冲突时单课程 UID 与旧算法完全一致（存量订阅不受影响）', () => {
    const course = { id: '虚构-id-3', name: '虚构木工基础', period: '1-2', teacher: '测试教师丑', location: '虚拟馆X002' };
    const ics = buildCalendarIcs(collisionSchedule([course]));
    expect(swUids(ics)).toEqual([legacyUid(course, 'monday', 1)]);
  });
});

describe('buildCalendarIcs', () => {
  it('空课表也产出合法日历骨架', () => {
    const ics = buildCalendarIcs({
      name: '空班',
      semesterStart: '2026-08-31',
      totalWeeks: 16,
      periodSettings: [{ startTime: '08:00', duration: 45 }],
      courses: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [] }
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('X-WR-CALNAME:空班');
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('转义 ICS 文本特殊字符', () => {
    const ics = buildCalendarIcs({
      name: '特殊,字符;班',
      semesterStart: '2026-08-31',
      totalWeeks: 1,
      periodSettings: [{ startTime: '08:00', duration: 45 }],
      courses: {
        monday: [{ name: '课程,带逗号;分号', period: '1', location: 'A\\B' }],
        tuesday: [], wednesday: [], thursday: [], friday: []
      }
    });
    expect(ics).toContain('SUMMARY:课程\\,带逗号\\;分号');
    expect(ics).toContain('LOCATION:A\\\\B');
  });

  it('倒序节次（"3,1"）生成 DTSTART 早于 DTEND 的合法事件', () => {
    const ics = buildCalendarIcs({
      name: '倒序班',
      semesterStart: '2026-08-31',
      totalWeeks: 1,
      periodSettings: [
        { startTime: '08:00', duration: 45 },
        { startTime: '08:55', duration: 45 },
        { startTime: '09:50', duration: 45 }
      ],
      courses: {
        monday: [{ name: '倒序课', period: '3,1' }],
        tuesday: [], wednesday: [], thursday: [], friday: []
      }
    });
    expect(ics).toContain('DTSTART;TZID=Asia/Shanghai:20260831T080000'); // 第1节开始
    expect(ics).toContain('DTEND;TZID=Asia/Shanghai:20260831T103500'); // 第3节 09:50 + 45 分钟
  });
});

describe('buildCalendarIcs 时段汇总提醒（独立汇总事件）', () => {
  // 13 节次：上午 1-5（08:00 起）、下午 6-9（14:00 起）、晚上 10-13（18:00 起）
  const slotPeriodSettings = [
    { startTime: '08:00', duration: 45 }, { startTime: '08:55', duration: 45 },
    { startTime: '09:50', duration: 45 }, { startTime: '10:45', duration: 45 },
    { startTime: '11:40', duration: 45 }, { startTime: '14:00', duration: 45 },
    { startTime: '14:55', duration: 45 }, { startTime: '15:50', duration: 45 },
    { startTime: '16:45', duration: 45 }, { startTime: '18:00', duration: 45 },
    { startTime: '18:55', duration: 45 }, { startTime: '19:50', duration: 45 },
    { startTime: '20:45', duration: 45 }
  ];
  const slotSchedule = {
    name: '时段班',
    semesterStart: '2026-08-31', // 周一
    totalWeeks: 1,
    periodSettings: slotPeriodSettings,
    courses: {
      monday: [
        { name: '数据库原理', period: '1-2', location: '教学楼D404' },
        { name: '体育', period: '3-4', location: '操场' },
        { name: '晚自习辅导', period: '10-11' }
      ],
      tuesday: [{ name: '周二下午课', period: '6-7', location: '教学楼B201' }],
      wednesday: [{ name: '周三下午课', period: '6' }],
      thursday: [],
      friday: []
    }
  };

  // 展开折叠行后按 VEVENT 切块
  function parseEvents(ics) {
    const unfolded = ics.replace(/\r\n /g, '');
    return unfolded.split('BEGIN:VEVENT').slice(1).map(block => block.split('END:VEVENT')[0]);
  }

  it('每个有课的「天 × 时段」生成一个独立的汇总事件', () => {
    const ics = buildCalendarIcs(slotSchedule);
    const events = parseEvents(ics);
    // 5 个课程事件 + 4 个汇总事件（周一上午、周一晚上、周二下午、周三下午）
    expect(events).toHaveLength(9);
    const summaries = events.filter(e => e.includes('📋'));
    expect(summaries).toHaveLength(4);
    // SUMMARY 直接列出该时段全部课名（按上课时间排序、顿号分隔）
    expect(countOccurrences(ics, 'SUMMARY:📋 上午：数据库原理、体育')).toBe(1);
    expect(countOccurrences(ics, 'SUMMARY:📋 下午：周二下午课')).toBe(1);
    expect(countOccurrences(ics, 'SUMMARY:📋 下午：周三下午课')).toBe(1);
    expect(countOccurrences(ics, 'SUMMARY:📋 晚上：晚自习辅导')).toBe(1);
    // 周一无下午课，故没有「周一 + 下午」的汇总事件
    const mondaySummaries = summaries.filter(e => e.includes('DTSTART;TZID=Asia/Shanghai:20260831'));
    expect(mondaySummaries).toHaveLength(2);
    for (const e of mondaySummaries) expect(e).not.toContain('📋 下午：');
  });

  it('汇总事件时间 = 该时段当天最早课的上课时间 -60 分钟，时长 5 分钟', () => {
    const events = parseEvents(buildCalendarIcs(slotSchedule));
    // 周一上午首课 08:00 → 汇总事件 07:00-07:05
    const morning = events.find(e => e.includes('SUMMARY:📋 上午：数据库原理、体育') && e.includes('DTSTART;TZID=Asia/Shanghai:20260831'));
    expect(morning).toContain('DTSTART;TZID=Asia/Shanghai:20260831T070000');
    expect(morning).toContain('DTEND;TZID=Asia/Shanghai:20260831T070500');
    // 周一晚上首课 18:00 → 汇总事件 17:00-17:05
    const evening = events.find(e => e.includes('SUMMARY:📋 晚上：晚自习辅导'));
    expect(evening).toContain('DTSTART;TZID=Asia/Shanghai:20260831T170000');
    expect(evening).toContain('DTEND;TZID=Asia/Shanghai:20260831T170500');
  });

  it('汇总 DESCRIPTION 逐行列出该时段全部课程（含起止时间与地点）', () => {
    const events = parseEvents(buildCalendarIcs(slotSchedule));
    const morning = events.find(e => e.includes('SUMMARY:📋 上午：数据库原理、体育') && e.includes('20260831'));
    expect(morning).toContain('DESCRIPTION:数据库原理 08:00-09:40 @教学楼D404\\n体育 09:50-11:30 @操场');
  });

  it('汇总事件带一条 PT0M 闹钟，VALARM 的 DESCRIPTION 与 SUMMARY 相同（含课名）', () => {
    const ics = buildCalendarIcs(slotSchedule);
    expect(countOccurrences(ics, 'TRIGGER:PT0M')).toBe(4);
    const events = parseEvents(ics);
    const morning = events.find(e => e.includes('SUMMARY:📋 上午：数据库原理、体育') && e.includes('20260831'));
    expect(countOccurrences(morning, 'BEGIN:VALARM')).toBe(1);
    expect(morning).toContain('TRIGGER:PT0M');
    expect(morning).toContain('DESCRIPTION:📋 上午：数据库原理、体育');
    const evening = events.find(e => e.includes('SUMMARY:📋 晚上：晚自习辅导'));
    expect(evening).toContain('DESCRIPTION:📋 晚上：晚自习辅导');
  });

  it('课程事件只有一条自适应 VALARM：首节/长间隙 -PT30M，短课间前课下课时触发，不再出现 -PT15M', () => {
    const ics = buildCalendarIcs(slotSchedule);
    expect(ics).not.toContain('PT15M');
    expect(ics).not.toContain('PT60M');
    const events = parseEvents(ics);
    const courseEvents = events.filter(e => !e.includes('📋'));
    expect(courseEvents).toHaveLength(5);
    for (const e of courseEvents) {
      expect(countOccurrences(e, 'BEGIN:VALARM')).toBe(1);
    }
    // 周一数据库原理 08:00-09:40 为当天首节 → -PT30M，文案「30 分钟后开始」
    const db = courseEvents.find(e => e.includes('SUMMARY:数据库原理'));
    expect(db).toContain('TRIGGER:-PT30M');
    expect(db).toContain('DESCRIPTION:数据库原理 30 分钟后开始');
    // 周一体育 09:50 上课，前课 09:40 下课，间隙 10 分钟 → -PT10M，文案为下课触发
    const pe = courseEvents.find(e => e.includes('SUMMARY:体育'));
    expect(pe).toContain('TRIGGER:-PT10M');
    expect(pe).toContain('DESCRIPTION:上一节已下课，接下来：体育');
    // 周一晚自习 18:00，距前课 11:30 下课远超 30 分钟 → -PT30M
    const evening = courseEvents.find(e => e.includes('SUMMARY:晚自习辅导'));
    expect(evening).toContain('TRIGGER:-PT30M');
    // 跨天互不影响：周二/周三下午各自只有一节课，均为当天首节 → -PT30M
    const tue = courseEvents.find(e => e.includes('SUMMARY:周二下午课'));
    expect(tue).toContain('TRIGGER:-PT30M');
    const wed = courseEvents.find(e => e.includes('SUMMARY:周三下午课'));
    expect(wed).toContain('TRIGGER:-PT30M');
  });

  it('汇总事件 UID 稳定（重复导出不变）且不与课程事件冲突', () => {
    const dailyUids = ics => ics.split('\r\n')
      .filter(l => l.startsWith('UID:sw-daily-')).sort();
    const first = dailyUids(buildCalendarIcs(slotSchedule));
    const second = dailyUids(buildCalendarIcs(slotSchedule));
    expect(first).toHaveLength(4);
    expect(first).toEqual(second);
    for (const uid of first) expect(uid).toMatch(/^UID:sw-daily-[0-9a-f]{20}@schedule-web$/);
  });

  it('跨天互不影响：周二下午的汇总只含周二的课；无地点课程条目不带 @地点', () => {
    const events = parseEvents(buildCalendarIcs(slotSchedule));
    const tuesday = events.find(e => e.includes('SUMMARY:📋 下午：周二下午课') && e.includes('DTSTART;TZID=Asia/Shanghai:20260901'));
    expect(tuesday).toContain('DTSTART;TZID=Asia/Shanghai:20260901T130000');
    expect(tuesday).toContain('DESCRIPTION:周二下午课 14:00-15:40 @教学楼B201');
    expect(tuesday).not.toContain('周三下午课');
    const wednesday = events.find(e => e.includes('SUMMARY:📋 下午：周三下午课') && e.includes('DTSTART;TZID=Asia/Shanghai:20260902'));
    expect(wednesday).toContain('DESCRIPTION:周三下午课 14:00-14:45');
    expect(wednesday).not.toContain(' @');
  });

  it('补课日（confirmed）同样生成汇总事件', () => {
    const ics = buildCalendarIcs({
      ...slotSchedule,
      makeupDays: [{
        id: 'mk-1', date: '2026-09-20', name: '中秋调休', status: 'confirmed', copyFrom: 'monday',
        courses: [
          { name: '补课A', period: '1-2', location: '教学楼D404' },
          { name: '补课B', period: '3', location: '教学楼D405' }
        ]
      }]
    });
    const events = parseEvents(ics);
    // 汇总事件总数 = 4（周次展开）+ 1（补课日上午）
    expect(events.filter(e => e.includes('📋'))).toHaveLength(5);
    // 补课日的汇总事件标题同样直接列课名
    const makeupSummary = events.find(e => e.includes('SUMMARY:📋 上午：补课A、补课B') && e.includes('DTSTART;TZID=Asia/Shanghai:20260920'));
    expect(makeupSummary).toContain('DTSTART;TZID=Asia/Shanghai:20260920T070000');
    expect(makeupSummary).toContain('DTEND;TZID=Asia/Shanghai:20260920T070500');
    expect(makeupSummary).toContain('DESCRIPTION:补课A 08:00-09:40 @教学楼D404\\n补课B 09:50-10:35 @教学楼D405');
    expect(makeupSummary).toContain('TRIGGER:PT0M');
    expect(makeupSummary).toContain('DESCRIPTION:📋 上午：补课A、补课B');
    // 补课课程事件同样按课间隙自适应：补课A 为当天首节 → -PT30M；
    // 补课B 09:50 上课，前课 09:40 下课，间隙 10 分钟 → -PT10M 下课即提醒
    const makeupA = events.find(e => e.includes('SUMMARY:补课A'));
    expect(countOccurrences(makeupA, 'BEGIN:VALARM')).toBe(1);
    expect(makeupA).toContain('TRIGGER:-PT30M');
    const makeupB = events.find(e => e.includes('SUMMARY:补课B'));
    expect(countOccurrences(makeupB, 'BEGIN:VALARM')).toBe(1);
    expect(makeupB).toContain('TRIGGER:-PT10M');
    expect(makeupB).toContain('DESCRIPTION:上一节已下课，接下来：补课B');
  });

  it('同名课程同一时段出现多次时 SUMMARY 只列一次', () => {
    const ics = buildCalendarIcs({
      ...slotSchedule,
      courses: {
        monday: [
          { name: '高等数学', period: '1-2', location: '教学楼A101' },
          { name: '高等数学', period: '3-4', location: '教学楼A102' },
          { name: '体育', period: '5', location: '操场' }
        ],
        tuesday: [], wednesday: [], thursday: [], friday: []
      }
    });
    const events = parseEvents(ics);
    const morning = events.find(e => e.includes('SUMMARY:📋 上午') && e.includes('20260831'));
    expect(morning).toContain('SUMMARY:📋 上午：高等数学、体育');
    // DESCRIPTION 仍逐行列出每一次上课（不去重）
    expect(morning).toContain('DESCRIPTION:高等数学 08:00-09:40 @教学楼A101\\n高等数学 09:50-11:30 @教学楼A102\\n体育 11:40-12:25 @操场');
  });

  it('SUMMARY 超过 60 字符时保留完整课名并以「等N节」截断，截断后仍按 foldIcsLine 折叠（≤75 octet）', () => {
    const names = ['课程名称甲', '课程名称乙', '课程名称丙', '课程名称丁', '课程名称戊',
      '课程名称己', '课程名称庚', '课程名称辛', '课程名称壬', '课程名称癸'];
    const ics = buildCalendarIcs({
      ...slotSchedule,
      courses: {
        monday: names.map((name, i) => ({ name, period: String((i >> 1) + 1) })),
        tuesday: [], wednesday: [], thursday: [], friday: []
      }
    });
    const truncated = `📋 上午：${names.slice(0, 8).join('、')}等2节`;
    expect(truncated.length).toBeLessThanOrEqual(60);
    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
    const unfolded = ics.replace(/\r\n /g, '');
    const events = parseEvents(unfolded);
    const morning = events.find(e => e.includes('SUMMARY:📋 上午') && e.includes('20260831'));
    expect(morning).toContain(`SUMMARY:${truncated}\r\n`);
    // 被截掉的课名不出现在标题里，但 DESCRIPTION 逐行列表仍然完整
    expect(morning).toContain('课程名称壬 11:40-12:25');
    expect(morning).toContain('课程名称癸 11:40-12:25');
    // VALARM 的 DESCRIPTION 与截断后的 SUMMARY 同步
    expect(morning).toContain(`DESCRIPTION:${truncated}`);
  });

  it('汇总 DESCRIPTION 同样经过 foldIcsLine 折叠（所有物理行 ≤75 octet）', () => {
    const ics = buildCalendarIcs({
      ...slotSchedule,
      courses: {
        monday: [
          { name: '超长的中文课程名称'.repeat(8), period: '1-2', location: '教学楼机房'.repeat(6) },
          { name: '另一门超长课程名字'.repeat(8), period: '3-4', location: '教学楼'.repeat(6) }
        ],
        tuesday: [], wednesday: [], thursday: [], friday: []
      }
    });
    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`DESCRIPTION:${'超长的中文课程名称'.repeat(8)} 08:00-09:40 @${'教学楼机房'.repeat(6)}\\n${'另一门超长课程名字'.repeat(8)} 09:50-11:30 @${'教学楼'.repeat(6)}`);
    expect(countOccurrences(unfolded, 'TRIGGER:PT0M')).toBe(1);
  });
});

describe('时段归属：大节次与自定义时间', () => {
  it('slotOfFirstPeriod：节次 ≥10 一律归晚上（14-20 不再返回 null）', () => {
    expect(slotOfFirstPeriod(1)).toBe('morning');
    expect(slotOfFirstPeriod(5)).toBe('morning');
    expect(slotOfFirstPeriod(6)).toBe('afternoon');
    expect(slotOfFirstPeriod(9)).toBe('afternoon');
    expect(slotOfFirstPeriod(10)).toBe('evening');
    expect(slotOfFirstPeriod(13)).toBe('evening');
    expect(slotOfFirstPeriod(14)).toBe('evening');
    expect(slotOfFirstPeriod(20)).toBe('evening');
  });

  it('第 14 节的课程也生成晚上时段汇总事件（此前 slot 为 null 被跳过）', () => {
    const settings14 = [
      { startTime: '08:00', duration: 45 }, { startTime: '08:55', duration: 45 },
      { startTime: '09:50', duration: 45 }, { startTime: '10:45', duration: 45 },
      { startTime: '11:40', duration: 45 }, { startTime: '14:00', duration: 45 },
      { startTime: '14:55', duration: 45 }, { startTime: '15:50', duration: 45 },
      { startTime: '16:45', duration: 45 }, { startTime: '18:00', duration: 45 },
      { startTime: '18:55', duration: 45 }, { startTime: '19:50', duration: 45 },
      { startTime: '20:45', duration: 45 }, { startTime: '21:40', duration: 45 }
    ];
    const ics = buildCalendarIcs({
      name: '大节次班', semesterStart: '2026-08-31', totalWeeks: 1,
      periodSettings: settings14,
      courses: {
        monday: [{ name: '虚构夜间实验', period: '14' }],
        tuesday: [], wednesday: [], thursday: [], friday: []
      }
    });
    expect(ics).toContain('SUMMARY:📋 晚上：虚构夜间实验');
    // 汇总事件时间 = 21:40 - 60 分钟
    expect(ics).toContain('DTSTART;TZID=Asia/Shanghai:20260831T204000');
  });

  it('slotOfActualStartMinutes：按 periodSettings 边界节次开始时间划分，缺失时回退 12:00/18:00', () => {
    const settings = [
      { startTime: '08:00', duration: 45 }, { startTime: '08:55', duration: 45 },
      { startTime: '09:50', duration: 45 }, { startTime: '10:45', duration: 45 },
      { startTime: '11:40', duration: 45 }, { startTime: '14:00', duration: 45 },
      { startTime: '14:55', duration: 45 }, { startTime: '15:50', duration: 45 },
      { startTime: '16:45', duration: 45 }, { startTime: '18:00', duration: 45 }
    ];
    expect(slotOfActualStartMinutes(8 * 60 + 30, settings)).toBe('morning');
    expect(slotOfActualStartMinutes(14 * 60 + 30, settings)).toBe('afternoon');
    expect(slotOfActualStartMinutes(19 * 60, settings)).toBe('evening');
    // periodSettings 缺失时回退固定钟点
    expect(slotOfActualStartMinutes(11 * 60, [])).toBe('morning');
    expect(slotOfActualStartMinutes(13 * 60, [])).toBe('afternoon');
    expect(slotOfActualStartMinutes(18 * 60, undefined)).toBe('evening');
  });

  it('自定义时间生效时按实际开始时间归时段：period 为 1 但 14:30 上课的课计入下午汇总', () => {
    const ics = buildCalendarIcs({
      name: '自定义时段班', semesterStart: '2026-08-31', totalWeeks: 1,
      periodSettings: [
        { startTime: '08:00', duration: 45 }, { startTime: '08:55', duration: 45 },
        { startTime: '09:50', duration: 45 }, { startTime: '10:45', duration: 45 },
        { startTime: '11:40', duration: 45 }, { startTime: '14:00', duration: 45 },
        { startTime: '14:55', duration: 45 }, { startTime: '15:50', duration: 45 },
        { startTime: '16:45', duration: 45 }, { startTime: '18:00', duration: 45 }
      ],
      courses: {
        monday: [
          { name: '虚构晨练打卡', period: '1' },
          { name: '虚构午后工坊', period: '1', customStart: '14:30', customEnd: '16:10' }
        ],
        tuesday: [], wednesday: [], thursday: [], friday: []
      }
    });
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('SUMMARY:📋 上午：虚构晨练打卡');
    expect(unfolded).toContain('SUMMARY:📋 下午：虚构午后工坊');
    // 自定义时间的课不出现在上午汇总里
    expect(unfolded).not.toContain('SUMMARY:📋 上午：虚构晨练打卡、虚构午后工坊');
  });
});

describe('buildCalendarIcs 单课提醒按课间隙自适应', () => {
  // 复刻用户实例：1 节 09:00-09:25、2 节 09:45-10:30（间隙 20）、
  // 3 节 19:00-19:25、4 节 19:35-20:20（间隙 10）、5 节 21:00-21:45（距前课 40 分钟）
  const gapPeriodSettings = [
    { startTime: '09:00', duration: 25 },
    { startTime: '09:45', duration: 45 },
    { startTime: '19:00', duration: 25 },
    { startTime: '19:35', duration: 45 },
    { startTime: '21:00', duration: 45 }
  ];
  const gapSchedule = {
    name: '间隙班',
    semesterStart: '2026-08-31', // 周一
    totalWeeks: 1,
    periodSettings: gapPeriodSettings,
    courses: {
      monday: [
        { name: '早课', period: '1' },
        { name: '间隙20课', period: '2' },
        { name: '晚课甲', period: '3' },
        { name: '间隙10课', period: '4' },
        { name: '长间隙课', period: '5' }
      ],
      tuesday: [{ name: '周二独课', period: '1' }],
      wednesday: [], thursday: [], friday: []
    }
  };

  function parseEvents(ics) {
    const unfolded = ics.replace(/\r\n /g, '');
    return unfolded.split('BEGIN:VEVENT').slice(1).map(block => block.split('END:VEVENT')[0]);
  }

  it('间隙 <30 分钟时在前课下课时刻提醒（TRIGGER = 负的间隙分钟数）', () => {
    const events = parseEvents(buildCalendarIcs(gapSchedule));
    // 09:25 下课 09:45 上课，间隙 20 → -PT20M
    const gap20 = events.find(e => e.includes('SUMMARY:间隙20课'));
    expect(gap20).toContain('TRIGGER:-PT20M');
    expect(gap20).toContain('DESCRIPTION:上一节已下课，接下来：间隙20课');
    // 19:25 下课 19:35 上课，间隙 10 → -PT10M
    const gap10 = events.find(e => e.includes('SUMMARY:间隙10课'));
    expect(gap10).toContain('TRIGGER:-PT10M');
    expect(gap10).toContain('DESCRIPTION:上一节已下课，接下来：间隙10课');
  });

  it('间隙 ≥30 分钟或当天首节时课前 30 分钟提醒（-PT30M）', () => {
    const events = parseEvents(buildCalendarIcs(gapSchedule));
    // 早课 09:00 为周一首节 → -PT30M
    const first = events.find(e => e.includes('SUMMARY:早课'));
    expect(first).toContain('TRIGGER:-PT30M');
    expect(first).toContain('DESCRIPTION:早课 30 分钟后开始');
    // 晚课甲 19:00，距前课 10:30 下课远超 30 分钟 → -PT30M
    const evening = events.find(e => e.includes('SUMMARY:晚课甲'));
    expect(evening).toContain('TRIGGER:-PT30M');
    expect(evening).toContain('DESCRIPTION:晚课甲 30 分钟后开始');
    // 长间隙课 21:00，前课 20:20 下课，间隙 40 ≥ 30 → -PT30M
    const long = events.find(e => e.includes('SUMMARY:长间隙课'));
    expect(long).toContain('TRIGGER:-PT30M');
    expect(long).toContain('DESCRIPTION:长间隙课 30 分钟后开始');
  });

  it('跨天不影响：他日课程不参与间隙计算，周二独课为当天首节 → -PT30M', () => {
    const events = parseEvents(buildCalendarIcs(gapSchedule));
    const tue = events.find(e => e.includes('SUMMARY:周二独课'));
    expect(tue).toContain('DTSTART;TZID=Asia/Shanghai:20260901T090000');
    expect(tue).toContain('TRIGGER:-PT30M');
    expect(tue).toContain('DESCRIPTION:周二独课 30 分钟后开始');
  });

  it('叠课（gap≤0）兜底为 -PT0M', () => {
    const events = parseEvents(buildCalendarIcs({
      ...gapSchedule,
      courses: {
        monday: [{ name: '叠课甲', period: '1' }, { name: '叠课乙', period: '1' }],
        tuesday: [], wednesday: [], thursday: [], friday: []
      }
    }));
    const overlapped = events.find(e => e.includes('SUMMARY:叠课乙'));
    expect(overlapped).toContain('TRIGGER:-PT0M');
    expect(overlapped).toContain('DESCRIPTION:上一节已下课，接下来：叠课乙');
  });

  it('补课日（confirmed）单日事件同样按课间隙自适应', () => {
    const events = parseEvents(buildCalendarIcs({
      ...gapSchedule,
      courses: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [] },
      makeupDays: [{
        id: 'mk-gap', date: '2026-09-20', name: '中秋调休', status: 'confirmed', copyFrom: 'monday',
        courses: [
          { name: '补课首节', period: '1' },
          { name: '补课短课间', period: '2' }
        ]
      }]
    }));
    const first = events.find(e => e.includes('SUMMARY:补课首节'));
    expect(first).toContain('TRIGGER:-PT30M');
    const short = events.find(e => e.includes('SUMMARY:补课短课间'));
    expect(short).toContain('TRIGGER:-PT20M'); // 09:25 下课 09:45 上课
    expect(short).toContain('DESCRIPTION:上一节已下课，接下来：补课短课间');
  });
});

describe('buildSlotSummaryTitle（汇总事件标题）', () => {
  it('时段名 + 顿号分隔的课名列表', () => {
    expect(buildSlotSummaryTitle('上午', ['高等数学', '体育理论'])).toBe('📋 上午：高等数学、体育理论');
    expect(buildSlotSummaryTitle('晚上', ['晚自习辅导'])).toBe('📋 晚上：晚自习辅导');
  });

  it('不超过 60 字符时原样返回', () => {
    const names = ['课程名称甲', '课程名称乙', '课程名称丙'];
    const title = buildSlotSummaryTitle('下午', names);
    expect(title).toBe(`📋 下午：${names.join('、')}`);
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it('超过 60 字符时保留前若干门完整课名，尾部加「等N节」', () => {
    const names = ['课程名称甲', '课程名称乙', '课程名称丙', '课程名称丁', '课程名称戊',
      '课程名称己', '课程名称庚', '课程名称辛', '课程名称壬', '课程名称癸'];
    const title = buildSlotSummaryTitle('上午', names);
    expect(title).toBe(`📋 上午：${names.slice(0, 8).join('、')}等2节`);
    expect(title.length).toBeLessThanOrEqual(60);
    // 保留的均为完整课名，不出现半截课名
    expect(title).not.toContain('壬');
  });

  it('课名本身超长时允许一门都列不下，只留「等N节」', () => {
    const title = buildSlotSummaryTitle('上午', ['超长的中文课程名称'.repeat(8)]);
    expect(title).toBe('📋 上午：等1节');
    expect(title.length).toBeLessThanOrEqual(60);
  });
});

describe('foldIcsLine（RFC 5545 长行折叠）', () => {
  it('不超过 75 octet 的行原样返回', () => {
    expect(foldIcsLine('SUMMARY:高等数学')).toBe('SUMMARY:高等数学');
  });

  it('超长行按 UTF-8 字节数折叠为 CRLF+空格续行', () => {
    const longText = 'SUMMARY:' + '高等数学与线性代数综合实验班课程'.repeat(10);
    const folded = foldIcsLine(longText);
    const physicalLines = folded.split('\r\n');
    expect(physicalLines.length).toBeGreaterThan(1);
    for (const [i, l] of physicalLines.entries()) {
      expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
      if (i > 0) expect(l.startsWith(' ')).toBe(true);
    }
    // 展开（去掉 CRLF+空格）后内容不变
    expect(folded.replace(/\r\n /g, '')).toBe(longText);
  });

  it('导出的 ICS 所有物理行均不超过 75 octet（中文长课名）', () => {
    const ics = buildCalendarIcs({
      name: '长名班',
      semesterStart: '2026-08-31',
      totalWeeks: 1,
      periodSettings: [{ startTime: '08:00', duration: 45 }],
      courses: {
        monday: [{ name: '超长的中文课程名称'.repeat(10), period: '1', location: '教学楼机房'.repeat(8) }],
        tuesday: [], wednesday: [], thursday: [], friday: []
      }
    });
    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
    // 折叠后展开仍能还原完整课名
    expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${'超长的中文课程名称'.repeat(10)}`);
  });
});
