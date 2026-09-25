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
const { app, init, buildCalendarIcs, buildSlotSummaryTitle, parsePeriodNumbers, foldIcsLine, resolveCourseTimeRange, slotOfFirstPeriod, slotOfActualStartMinutes, ensureCourseIds } = require('../src/server/server');

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
      { name: '云计算运维开发', period: '1-2', teacher: '测试教师A', location: '弘德楼机房406' },
      { name: '形势与政策', period: '1', teacher: '孔令龙', location: '崇德楼308', startWeek: 12, endWeek: 15 },
      { name: '单周研讨', period: '2', weekType: 'odd' },
      { name: '临时停课', period: '1', skipWeek: 3 }
    ],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [
      { name: '劳动教育', period: '1', teacher: '测试教师B', location: '正德楼307' }
    ]
  },
  announcements: [],
  makeupDays: [
    {
      id: 'md-confirmed-1',
      date: '2026-10-10', // 周六，国庆调休上班日
      name: '国庆节调休',
      status: 'confirmed',
      copyFrom: 'friday',
      courses: [
        { name: '补课·分析化学', period: '1-2', teacher: '李四', location: 'D404' },
        { name: '补课班会', period: '1', customStart: '16:30', customEnd: '17:10' }
      ]
    },
    {
      id: 'md-pending-1',
      date: '2026-09-20', // 周日，国庆调休上班日，学校尚未通知补哪天的课
      name: '待通知',
      status: 'pending',
      copyFrom: null,
      courses: [
        { name: '待定补课不该出现', period: '1' }
      ]
    }
  ]
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
    expect(countOccurrences(res.text, 'SUMMARY:云计算运维开发')).toBe(15);
    expect(res.text).toContain('DTSTART;TZID=Asia/Shanghai:20260831T080000');
    expect(res.text).toContain('DTEND;TZID=Asia/Shanghai:20260831T094000');
    expect(res.text).not.toContain('20261005T080000'); // 国庆假期内的周一
    expect(res.text).toContain('LOCATION:弘德楼机房406');
    expect(res.text).toContain('TRIGGER:-PT30M'); // 9/1 起自适应提醒：时段首节课课前 30 分钟，短课间则前课下课即弹
    expect(res.text).toContain('TZID:Asia/Shanghai');
  });

  it('尊重周次范围与单双周设置', async () => {
    const res = await request(app).get('/api/calendar.ics').expect(200);
    expect(countOccurrences(res.text, 'SUMMARY:形势与政策')).toBe(4); // 仅 12-15 周
    expect(countOccurrences(res.text, 'SUMMARY:单周研讨')).toBe(8); // 16 周内的单周
  });

  it('skipWeek 当周不生成事件（再减去假期周一 2026-10-05）', async () => {
    const res = await request(app).get('/api/calendar.ics').expect(200);
    expect(countOccurrences(res.text, 'SUMMARY:临时停课')).toBe(14);
  });

  it('节假日当天不生成课程事件（中秋 2026-09-25、国庆 2026-10-02 均为周五）', async () => {
    const res = await request(app).get('/api/calendar.ics').expect(200);
    expect(countOccurrences(res.text, 'SUMMARY:劳动教育')).toBe(14); // 16 周 - 中秋 - 国庆
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

  it('confirmed 补课日按 date 直接生成事件，DESCRIPTION 标注补课来源', async () => {
    const res = await request(app).get('/api/calendar.ics').expect(200);
    expect(countOccurrences(res.text, 'SUMMARY:补课·分析化学')).toBe(1);
    expect(res.text).toContain('DTSTART;TZID=Asia/Shanghai:20261010T080000');
    expect(res.text).toContain('DTEND;TZID=Asia/Shanghai:20261010T094000');
    expect(res.text).toContain('LOCATION:D404');
    expect(res.text).toContain('补课·补周五'); // copyFrom=friday 进 DESCRIPTION
    expect(res.text).toContain('2026-10-10 第1-2节');
    expect(res.text).toMatch(/^UID:swm-[0-9a-f]{20}@schedule-web$/m); // 补课事件独立 UID 前缀
  });

  it('补课课程的 customStart/customEnd 优先于节次推导', async () => {
    const res = await request(app).get('/api/calendar.ics').expect(200);
    expect(countOccurrences(res.text, 'SUMMARY:补课班会')).toBe(1);
    expect(res.text).toContain('DTSTART;TZID=Asia/Shanghai:20261010T163000');
    expect(res.text).toContain('DTEND;TZID=Asia/Shanghai:20261010T171000');
  });

  it('pending（等待通知）补课日不生成任何事件', async () => {
    const res = await request(app).get('/api/calendar.ics').expect(200);
    expect(res.text).not.toContain('待定补课不该出现');
  });

  it('补课事件同样参与时段汇总（当天单独成组）', async () => {
    const res = await request(app).get('/api/calendar.ics').expect(200);
    expect(res.text).toContain('SUMMARY:📋 上午：补课·分析化学');
    expect(res.text).toContain('SUMMARY:📋 下午：补课班会'); // 16:30 按实际开始时间归下午时段
  });

  describe('进程内 60s 缓存（review r1 P2-2）', () => {
    it('TTL 内重复导出命中缓存（响应逐字节相同，含 DTSTAMP）', async () => {
      const first = await request(app).get('/api/calendar.ics').expect(200);
      const second = await request(app).get('/api/calendar.ics').expect(200);
      expect(second.text).toBe(first.text);
    });

    it('写操作保存成功后缓存立即失效，下次导出反映新数据', async () => {
      const before = await request(app).get('/api/calendar.ics').expect(200);
      expect(before.text).not.toContain('缓存失效验证课');
      await request(app)
        .put('/api/schedule/makeup-days')
        .send({
          password: 'test123',
          makeupDays: [{
            id: 'md-cache-invalidate',
            date: '2026-11-14',
            name: '',
            status: 'confirmed',
            copyFrom: null,
            courses: [{ name: '缓存失效验证课', period: '1' }]
          }]
        })
        .expect(200);
      const after = await request(app).get('/api/calendar.ics').expect(200);
      expect(after.text).toContain('SUMMARY:缓存失效验证课');
      expect(after.text).not.toBe(before.text);
    });
  });
});

describe('parsePeriodNumbers', () => {
  it('解析区间、列表与单节次', () => {
    expect(parsePeriodNumbers('1-2')).toEqual([1, 2]);
    expect(parsePeriodNumbers('第3-4节')).toEqual([3, 4]);
    expect(parsePeriodNumbers('1,3')).toEqual([1, 3]);
    expect(parsePeriodNumbers('5')).toEqual([5]);
  });

  it('非法输入返回空数组', () => {
    expect(parsePeriodNumbers('')).toEqual([]);
    expect(parsePeriodNumbers(null)).toEqual([]);
    expect(parsePeriodNumbers('3-1')).toEqual([]);
    expect(parsePeriodNumbers('abc')).toEqual([]);
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
});

describe('foldIcsLine（RFC 5545 §3.1 75 octet 折行）', () => {
  const unfold = folded => folded.split('\r\n').map((l, i) => (i === 0 ? l : l.slice(1))).join('');
  const physicalLines = folded => folded.split('\r\n');

  it('不超过 75 字节的行原样返回', () => {
    expect(foldIcsLine('SUMMARY:短标题')).toBe('SUMMARY:短标题');
    expect(foldIcsLine('A'.repeat(75))).toBe('A'.repeat(75));
  });

  it('超长 ASCII 行折叠后每个物理行不超过 75 字节，且可无损展开', () => {
    const line = `DESCRIPTION:${'x'.repeat(200)}`;
    const folded = foldIcsLine(line);
    for (const l of physicalLines(folded)) {
      expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(unfold(folded)).toBe(line);
  });

  it('多字节字符（中文）按字符边界折叠，不截断 UTF-8 序列', () => {
    const line = `SUMMARY:${'超'.repeat(40)}`; // 8 + 120 字节
    const folded = foldIcsLine(line);
    const lines = physicalLines(folded);
    expect(lines.length).toBeGreaterThan(1);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].startsWith(' ')).toBe(true); // 续行以单个空格开头
    }
    for (const l of lines) {
      expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(unfold(folded)).toBe(line);
  });
});

describe('buildSlotSummaryTitle（汇总标题 60 字截断）', () => {
  it('不超过 60 字时完整列出全部课名', () => {
    expect(buildSlotSummaryTitle('上午', ['高等数学', '体育理论'])).toBe('📋 上午：高等数学、体育理论');
  });

  it('恰好 60 字时不截断', () => {
    const names = ['A'.repeat(20), 'B'.repeat(20), 'C'.repeat(12)]; // 6 + 20+1+20+1+12 = 60
    expect(buildSlotSummaryTitle('上午', names)).toBe(`📋 上午：${names.join('、')}`);
  });

  it('超长时保留完整课名并以「等N节」收尾，总长不超 60 字', () => {
    const names = ['A'.repeat(20), 'B'.repeat(20), 'C'.repeat(12), 'D'.repeat(5)];
    const title = buildSlotSummaryTitle('上午', names);
    expect(title).toBe(`📋 上午：${'A'.repeat(20)}、${'B'.repeat(20)}等2节`);
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it('单个课名就超长时退化为「等N节」', () => {
    expect(buildSlotSummaryTitle('上午', ['X'.repeat(70)])).toBe('📋 上午：等1节');
  });
});

describe('resolveCourseTimeRange（与前端 getCourseTimeRange 同一约定）', () => {
  const settings = [
    { startTime: '08:00', duration: 45 },
    { startTime: '08:55', duration: 50 }
  ];

  it('customStart/customEnd 同时合法且 end>start 时优先', () => {
    const range = resolveCourseTimeRange({ period: '1', customStart: '16:30', customEnd: '17:10' }, [1], settings);
    expect(range).toEqual({ startMin: 990, endMin: 1030, custom: true });
  });

  it('按节次推导：开始=首节 startTime，结束=末节课 startTime + duration', () => {
    const range = resolveCourseTimeRange({ period: '1-2' }, [1, 2], settings);
    expect(range).toEqual({ startMin: 480, endMin: 535 + 50, custom: false });
  });

  it('duration 缺失时回退 45 分钟', () => {
    const range = resolveCourseTimeRange({ period: '1' }, [1], [{ startTime: '08:00' }]);
    expect(range).toEqual({ startMin: 480, endMin: 525, custom: false });
  });

  it('customEnd 不晚于 customStart 时回退节次推导', () => {
    const range = resolveCourseTimeRange({ period: '1', customStart: '10:00', customEnd: '09:00' }, [1], settings);
    expect(range).toEqual({ startMin: 480, endMin: 525, custom: false });
  });

  it('节次超出 periodSettings 范围时返回 null（课程跳过）', () => {
    expect(resolveCourseTimeRange({ period: '3' }, [3], settings)).toBeNull();
  });

  it('periodSettings 的 startTime 非法时返回 null，不产生 NaN 时间', () => {
    expect(resolveCourseTimeRange({ period: '1' }, [1], [{ startTime: 'bad-time', duration: 45 }])).toBeNull();
  });
});

describe('buildCalendarIcs 健壮性与 RFC 5545 合规', () => {
  const baseSchedule = {
    name: '合规班',
    semesterStart: '2026-08-31',
    totalPeriods: 1,
    totalWeeks: 1,
    periodSettings: [{ startTime: '08:00', duration: 45 }],
    courses: { monday: [{ name: '数学', period: '1' }], tuesday: [], wednesday: [], thursday: [], friday: [] }
  };

  it('DTSTAMP 为 UTC 时间戳，日历骨架属性齐全', () => {
    const ics = buildCalendarIcs(baseSchedule);
    expect(ics).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/m);
    expect(ics).toContain('PRODID:-//schedule-web//class-schedule//CN');
    expect(ics).toContain('CALSCALE:GREGORIAN');
    expect(ics).toContain('TZID:Asia/Shanghai');
  });

  it('全文仅使用 CRLF 换行，且每个物理行不超过 75 字节', () => {
    const ics = buildCalendarIcs({
      ...baseSchedule,
      courses: { monday: [{ name: '超'.repeat(40), period: '1', location: '弘德楼机房406' }], tuesday: [], wednesday: [], thursday: [], friday: [] }
    });
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/); // 无裸 LF/CR
    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
    // 折叠后的 SUMMARY 展开仍还原完整课名
    const summary = ics.split('\r\n').filter(l => l.startsWith('SUMMARY:超') || l.startsWith(' ')).join('');
    expect(summary).toContain('SUMMARY:超');
  });

  it('periodSettings 的 startTime 非法（手工改坏的数据文件）时跳过课程，不输出 NaN 时间', () => {
    const ics = buildCalendarIcs({
      ...baseSchedule,
      periodSettings: [{ startTime: 'bad-time', duration: 45 }]
    });
    expect(ics).not.toContain('NaN');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('课名中的 C0 控制字符被剥离（换行仍转义为 \\n）', () => {
    const ics = buildCalendarIcs({
      ...baseSchedule,
      courses: { monday: [{ name: '微\x07积分\x0B\x7F', period: '1' }], tuesday: [], wednesday: [], thursday: [], friday: [] }
    });
    expect(ics).toContain('SUMMARY:微积分');
    expect(ics).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
  });

  it('课名中的裸 CR（\\r）同样剥离，不会原样进入 content line（r1 P2-1）', () => {
    const ics = buildCalendarIcs({
      ...baseSchedule,
      courses: { monday: [{ name: 'A\rB', period: '1' }], tuesday: [], wednesday: [], thursday: [], friday: [] }
    });
    expect(ics).toContain('SUMMARY:AB');
    expect(ics.replace(/\r\n/g, '')).not.toContain('\r'); // 除 CRLF 行尾外无裸 CR
  });
});

// 取出包含某个 SUMMARY 的 VEVENT 文本块（汇总事件标题含「📋」前缀，不会误匹配）
function eventBlockOf(ics, summaryLine) {
  const block = ics.split('BEGIN:VEVENT').find(b => b.includes(summaryLine));
  if (!block) throw new Error(`VEVENT not found: ${summaryLine}`);
  return block;
}

describe('ICS 字段级细节（M27 测试盲区）', () => {
  const makeSchedule = courses => ({
    name: '字段班',
    semesterStart: '2026-08-31',
    totalPeriods: 4,
    totalWeeks: 1,
    periodSettings: [
      { startTime: '08:00', duration: 45 },
      { startTime: '08:55', duration: 45 },
      { startTime: '10:00', duration: 45 },
      { startTime: '20:00', duration: 45 }
    ],
    courses: { monday: courses, tuesday: [], wednesday: [], thursday: [], friday: [] }
  });

  it('同一导出内 UID 撞车时追加稳定 -2 后缀，互不覆盖', () => {
    const dup = { name: '撞车课', period: '1', teacher: '同人', location: 'A101' };
    const ics = buildCalendarIcs(makeSchedule([dup, { ...dup }]));
    const uids = ics.split('\r\n').filter(l => l.startsWith('UID:sw-') && !l.startsWith('UID:sw-daily-'));
    expect(uids).toHaveLength(2);
    expect(uids[0]).toMatch(/^UID:sw-[0-9a-f]{20}@schedule-web$/);
    expect(uids[1]).toMatch(/^UID:sw-[0-9a-f]{20}-2@schedule-web$/);
    expect(uids[0].replace('@schedule-web', '')).toBe(uids[1].replace('-2@schedule-web', ''));
  });

  it('VALARM 按课间隙自适应：短课间前课下课即弹，长间隙课前 30 分钟', () => {
    const ics = buildCalendarIcs(makeSchedule([
      { name: '甲课', period: '1' }, // 08:00-08:45，当天首节 → 课前 30 分钟
      { name: '乙课', period: '2' }, // 08:55 开始，间隙 10 分钟 → 前课下课即弹
      { name: '丙课', period: '4' }  // 20:00 开始，长间隙 → 课前 30 分钟
    ]));
    expect(eventBlockOf(ics, 'SUMMARY:甲课')).toContain('TRIGGER:-PT30M');
    expect(eventBlockOf(ics, 'SUMMARY:甲课')).toContain('甲课 30 分钟后开始');
    expect(eventBlockOf(ics, 'SUMMARY:乙课')).toContain('TRIGGER:-PT10M');
    expect(eventBlockOf(ics, 'SUMMARY:乙课')).toContain('上一节已下课，接下来：乙课');
    expect(eventBlockOf(ics, 'SUMMARY:丙课')).toContain('TRIGGER:-PT30M');
  });

  it('汇总闹钟开关开启时：时段汇总事件有独立 sw-daily UID 与 PT0M 闹钟', () => {
    process.env.ICS_SLOT_SUMMARY_ALARM = 'true';
    try {
      const ics = buildCalendarIcs(makeSchedule([{ name: '甲课', period: '1' }]));
      expect(ics).toMatch(/^UID:sw-daily-[0-9a-f]{20}@schedule-web$/m);
      expect(eventBlockOf(ics, 'SUMMARY:📋 上午：甲课')).toContain('TRIGGER:PT0M');
    } finally {
      delete process.env.ICS_SLOT_SUMMARY_ALARM;
    }
  });

  it('首课凌晨开始时汇总事件钳制在当天 00:00，不落到前一天（P2#23）', () => {
    const ics = buildCalendarIcs({
      ...makeSchedule([{ name: '凌晨课', period: '1', customStart: '00:20', customEnd: '00:50' }])
    });
    const block = eventBlockOf(ics, 'SUMMARY:📋 上午：凌晨课');
    expect(block).toContain('DTSTART;TZID=Asia/Shanghai:20260831T000000');
    expect(block).toContain('DTEND;TZID=Asia/Shanghai:20260831T000500');
    expect(ics).not.toContain('20260830'); // 不跨到前一天
  });

  it('totalWeeks 超出 30 时按 30 周展开（手改文件 DoS 防护，P2#9）', () => {
    const ics = buildCalendarIcs({ ...makeSchedule([{ name: '数学', period: '1' }]), totalWeeks: 100000 });
    expect(countOccurrences(ics, 'SUMMARY:数学')).toBe(29); // 30 周减去国庆假期内的周一 2026-10-05
  });
});

// M31：ICS_SLOT_SUMMARY_ALARM 控制 📋 时段汇总事件是否输出 VALARM（默认 false 剥离，
// 治 HyperOS 超级岛重复刷屏）；单节课/补课事件的自适应 VALARM 与全部事件 UID 两态不变。
describe('ICS_SLOT_SUMMARY_ALARM（📋 汇总事件闹钟开关）', () => {
  const alarmSchedule = () => ({
    name: '开关班',
    semesterStart: '2026-08-31',
    totalPeriods: 4,
    totalWeeks: 1,
    periodSettings: [
      { startTime: '08:00', duration: 45 },
      { startTime: '08:55', duration: 45 },
      { startTime: '10:00', duration: 45 },
      { startTime: '20:00', duration: 45 }
    ],
    courses: {
      monday: [
        { name: '甲课', period: '1' }, // 08:00，当天首节 → -PT30M
        { name: '乙课', period: '2' }  // 08:55，间隙 10 分钟 → -PT10M
      ],
      tuesday: [], wednesday: [], thursday: [], friday: []
    },
    makeupDays: [{
      id: 'md-alarm-1',
      date: '2026-10-10',
      name: '调休',
      status: 'confirmed',
      copyFrom: 'monday',
      courses: [{ name: '补课丙', period: '1' }]
    }]
  });

  // 临时设置/清除开关 env 并在结束后还原（jest --runInBand 单进程，安全）
  const withAlarmSwitch = (value, fn) => {
    const prev = process.env.ICS_SLOT_SUMMARY_ALARM;
    if (value === undefined) delete process.env.ICS_SLOT_SUMMARY_ALARM;
    else process.env.ICS_SLOT_SUMMARY_ALARM = value;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env.ICS_SLOT_SUMMARY_ALARM;
      else process.env.ICS_SLOT_SUMMARY_ALARM = prev;
    }
  };

  const uidsOf = text => text.split('\r\n').filter(l => l.startsWith('UID:')).sort();

  // 归一化：剥掉 DTSTAMP 与 📋 汇总事件内的 VALARM 块，用于两态输出逐字节对比
  //（本组用例课名短，SUMMARY/VALARM DESCRIPTION 均不触发 75 字节折行）
  const normalize = text => {
    const out = [];
    let inSummary = false;
    let inValarm = false;
    for (const line of text.split('\r\n')) {
      if (line === 'BEGIN:VEVENT') inSummary = false;
      if (line.startsWith('SUMMARY:📋')) inSummary = true;
      if (line.startsWith('DTSTAMP:')) continue;
      if (inSummary && line === 'BEGIN:VALARM') { inValarm = true; continue; }
      if (inValarm) {
        if (line === 'END:VALARM') inValarm = false;
        continue;
      }
      out.push(line);
    }
    return out.join('\r\n');
  };

  it('默认（未设置）剥离汇总事件 VALARM：汇总事件无闹钟，单节课与补课事件的自适应 VALARM 完整保留', () => {
    const ics = withAlarmSwitch(undefined, () => buildCalendarIcs(alarmSchedule()));
    expect(ics).not.toContain('TRIGGER:PT0M');
    for (const summary of ['SUMMARY:📋 上午：甲课、乙课', 'SUMMARY:📋 上午：补课丙']) {
      expect(eventBlockOf(ics, summary)).not.toContain('BEGIN:VALARM');
    }
    // 余下的 VALARM 恰好等于课程/补课事件数（2 节周课 + 1 节补课），汇总事件不占闹钟
    expect(countOccurrences(ics, 'BEGIN:VALARM')).toBe(3);
    expect(eventBlockOf(ics, 'SUMMARY:甲课')).toContain('TRIGGER:-PT30M');
    expect(eventBlockOf(ics, 'SUMMARY:乙课')).toContain('TRIGGER:-PT10M');
    expect(eventBlockOf(ics, 'SUMMARY:补课丙')).toContain('TRIGGER:-PT30M');
    // 显式 false 与未设置行为一致（仅 'true' 开启）
    expect(normalize(withAlarmSwitch('false', () => buildCalendarIcs(alarmSchedule())))).toBe(normalize(ics));
  });

  it('开关两态下全部事件 UID 集合全等（VALARM 不参与 UID 哈希，汇总事件本身仍生成）', () => {
    const off = withAlarmSwitch(undefined, () => buildCalendarIcs(alarmSchedule()));
    const on = withAlarmSwitch('true', () => buildCalendarIcs(alarmSchedule()));
    expect(uidsOf(on)).toEqual(uidsOf(off));
    expect(uidsOf(off)).toHaveLength(5); // 2 周课 + 1 补课 + 2 个 📋 汇总
    expect(uidsOf(off).filter(u => u.startsWith('UID:sw-daily-'))).toHaveLength(2);
  });

  it('开关 true 时与默认态输出的唯一差异是汇总事件的 VALARM 块（DTSTAMP 除外逐字节一致）', () => {
    const off = withAlarmSwitch(undefined, () => buildCalendarIcs(alarmSchedule()));
    const on = withAlarmSwitch('true', () => buildCalendarIcs(alarmSchedule()));
    // 剥离「汇总事件 VALARM + DTSTAMP」后两态逐字节相同 → 开关不触碰其余任何输出
    expect(normalize(on)).toBe(normalize(off));
    // 开启后汇总事件恢复旧版完整 PT0M 闹钟（与现状逐字节一致的行为钉死）
    expect(countOccurrences(on, 'BEGIN:VALARM')).toBe(5); // 3 课程事件 + 2 汇总事件
    const block = eventBlockOf(on, 'SUMMARY:📋 上午：甲课、乙课');
    for (const line of ['BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', 'DESCRIPTION:📋 上午：甲课、乙课', 'END:VALARM']) {
      expect(block).toContain(line);
    }
  });
});

describe('时段归属边界（slotOfFirstPeriod / slotOfActualStartMinutes）', () => {
  it('按节次归属：上午 1-5、下午 6-9、晚上 10 及以后', () => {
    expect(slotOfFirstPeriod(1)).toBe('morning');
    expect(slotOfFirstPeriod(5)).toBe('morning');
    expect(slotOfFirstPeriod(6)).toBe('afternoon');
    expect(slotOfFirstPeriod(9)).toBe('afternoon');
    expect(slotOfFirstPeriod(10)).toBe('evening');
    expect(slotOfFirstPeriod(14)).toBe('evening');
  });

  it('自定义时间按实际开始时间归属，边界取 periodSettings 第 6/10 节开始时间', () => {
    const settings = Array.from({ length: 12 }, (_, i) => ({
      startTime: `${String(7 + i).padStart(2, '0')}:00`, // 第6节 12:00、第10节 16:00
      duration: 45
    }));
    expect(slotOfActualStartMinutes(11 * 60 + 59, settings)).toBe('morning');
    expect(slotOfActualStartMinutes(12 * 60, settings)).toBe('afternoon');
    expect(slotOfActualStartMinutes(15 * 60 + 59, settings)).toBe('afternoon');
    expect(slotOfActualStartMinutes(16 * 60, settings)).toBe('evening');
  });

  it('periodSettings 缺失时段边界时回退固定钟点（12:00 / 18:00）', () => {
    const short = [{ startTime: '08:00', duration: 45 }];
    expect(slotOfActualStartMinutes(11 * 60, short)).toBe('morning');
    expect(slotOfActualStartMinutes(13 * 60, short)).toBe('afternoon');
    expect(slotOfActualStartMinutes(19 * 60, short)).toBe('evening');
  });
});


describe('课程 id 回填（M30）', () => {
  // seedData 本就是旧数据形态（所有课程无 id），深拷贝后显式剥掉 id 兜底
  const legacySchedule = () => {
    const schedule = JSON.parse(JSON.stringify(seedData));
    for (const list of Object.values(schedule.courses)) {
      for (const course of list) delete course.id;
    }
    for (const day of schedule.makeupDays) {
      for (const course of day.courses) delete course.id;
    }
    return schedule;
  };
  const collectIds = schedule => [
    ...Object.values(schedule.courses).flatMap(list => list.map(c => c.id)),
    ...schedule.makeupDays.flatMap(day => day.courses.map(c => c.id))
  ];

  it('id 回填前后 ICS 输出逐字节一致（DTSTAMP 除外），UID 集合不变', () => {
    // UID 稳定性核查结论：sw-/swm-/sw-daily- UID 全部由课程内容哈希派生，不含 course.id，
    // 这里用逐字节对比钉死——回填绝不允许改变既有日历订阅的事件 UID
    const schedule = legacySchedule();
    const before = buildCalendarIcs(schedule);
    expect(ensureCourseIds(schedule)).toBe(true);
    const after = buildCalendarIcs(schedule);
    const stripDtstamp = text => text.split('\r\n').filter(line => !line.startsWith('DTSTAMP:')).join('\r\n');
    expect(stripDtstamp(after)).toBe(stripDtstamp(before));
    const uids = text => text.split('\r\n').filter(line => line.startsWith('UID:'));
    expect(uids(after)).toEqual(uids(before));
  });

  it('回填幂等：二次回填无改动，id 集合不变', () => {
    const schedule = legacySchedule();
    expect(ensureCourseIds(schedule)).toBe(true);
    const firstPass = collectIds(schedule);
    expect(firstPass.length).toBeGreaterThan(0);
    expect(firstPass.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(ensureCourseIds(schedule)).toBe(false);
    expect(collectIds(schedule)).toEqual(firstPass);
  });

  it('makeupDays 内课程一并回填，全部 id 全局唯一', () => {
    const schedule = legacySchedule();
    ensureCourseIds(schedule);
    const ids = collectIds(schedule);
    expect(new Set(ids).size).toBe(ids.length);
    for (const day of schedule.makeupDays) {
      expect(day.courses.every(c => typeof c.id === 'string' && c.id.length > 0)).toBe(true);
    }
  });

  it('字段全同的课程得到互不相同的确定性 id', () => {
    const makeDup = () => ({ name: '撞车课', period: '1', teacher: '同人', location: 'A101' });
    const schedule = legacySchedule();
    schedule.courses.monday.push(makeDup(), makeDup());
    ensureCourseIds(schedule);
    const [a, b] = schedule.courses.monday.slice(-2);
    expect(a.id).not.toBe(b.id);
    // 同一份数据从头再回填一遍，结果逐字节一致（确定性，跨进程/跨重启稳定）
    const again = legacySchedule();
    again.courses.monday.push(makeDup(), makeDup());
    ensureCourseIds(again);
    expect(collectIds(again)).toEqual(collectIds(schedule));
  });

  it('已有字符串 id 原样保留，数字 id 归一化为字符串', () => {
    const schedule = legacySchedule();
    schedule.courses.monday[0].id = 'keep-me';
    schedule.courses.monday[1].id = 42;
    ensureCourseIds(schedule);
    expect(schedule.courses.monday[0].id).toBe('keep-me');
    expect(schedule.courses.monday[1].id).toBe('42');
  });
});
