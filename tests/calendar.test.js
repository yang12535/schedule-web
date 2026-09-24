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
const { app, init, buildCalendarIcs, parsePeriodNumbers } = require('../src/server/server');

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
