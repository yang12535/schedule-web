const {
  WEEKDAYS,
  copyCoursesForMakeupDay,
  createMakeupDay,
  classifyMakeupDays,
  diffMakeupDays,
  MAKEUP_SOON_DAYS
} = require('../src/public/js/makeup-days');

const TODAY = '2026-09-25'; // 周五

function mkDay(date, status = 'pending', extra = {}) {
  return { id: `${date}-${status}`, date, name: '', status, copyFrom: null, courses: [], ...extra };
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

describe('diffMakeupDays', () => {
  it('同一天为 0，明天为 1，昨天为 -1', () => {
    expect(diffMakeupDays(TODAY, TODAY)).toBe(0);
    expect(diffMakeupDays('2026-09-26', TODAY)).toBe(1);
    expect(diffMakeupDays('2026-09-24', TODAY)).toBe(-1);
  });

  it('跨月/跨年按真实日历计算', () => {
    expect(diffMakeupDays('2026-10-01', TODAY)).toBe(6);
    expect(diffMakeupDays('2027-01-01', '2026-12-31')).toBe(1);
  });

  it('任一日期非法返回 null（格式错/假日期/非字符串）', () => {
    expect(diffMakeupDays('2026/09/26', TODAY)).toBeNull();
    expect(diffMakeupDays('2026-02-30', TODAY)).toBeNull();
    expect(diffMakeupDays(null, TODAY)).toBeNull();
    expect(diffMakeupDays('2026-09-26', 'not-a-date')).toBeNull();
  });
});

describe('classifyMakeupDays 有效期队列分组', () => {
  it('空数组与非数组输入返回全空分组', () => {
    const empty = { today: [], soon: [], future: [], expiredPending: [], expiredConfirmed: [], invalid: [] };
    expect(classifyMakeupDays([], TODAY)).toEqual(empty);
    expect(classifyMakeupDays(null, TODAY)).toEqual(empty);
    expect(classifyMakeupDays(undefined, TODAY)).toEqual(empty);
    expect(classifyMakeupDays('oops', TODAY)).toEqual(empty);
  });

  it('今天边界：date === todayStr 归入 today（pending/confirmed 双态都进）', () => {
    const g = classifyMakeupDays([mkDay(TODAY, 'pending'), mkDay(TODAY, 'confirmed')], TODAY);
    expect(g.today.map(d => d.status)).toEqual(['pending', 'confirmed']);
    expect(g.soon).toHaveLength(0);
    expect(g.expiredPending).toHaveLength(0);
    expect(g.expiredConfirmed).toHaveLength(0);
  });

  it('阈值边界：1 天与 MAKEUP_SOON_DAYS 天归 soon，SOON+1 天归 future', () => {
    const g = classifyMakeupDays([
      mkDay(addDays(TODAY, 1)),
      mkDay(addDays(TODAY, MAKEUP_SOON_DAYS)),
      mkDay(addDays(TODAY, MAKEUP_SOON_DAYS + 1))
    ], TODAY);
    expect(g.soon.map(d => d.date)).toEqual([addDays(TODAY, 1), addDays(TODAY, MAKEUP_SOON_DAYS)]);
    expect(g.future.map(d => d.date)).toEqual([addDays(TODAY, MAKEUP_SOON_DAYS + 1)]);
  });

  it('过期按状态分流：pending 与 confirmed 分属两组', () => {
    const g = classifyMakeupDays([
      mkDay('2026-09-20', 'confirmed'),
      mkDay('2026-09-22', 'pending')
    ], TODAY);
    expect(g.expiredConfirmed.map(d => d.date)).toEqual(['2026-09-20']);
    expect(g.expiredPending.map(d => d.date)).toEqual(['2026-09-22']);
    expect(g.today).toHaveLength(0);
    expect(g.soon).toHaveLength(0);
    expect(g.future).toHaveLength(0);
  });

  it('status 非 confirmed 的过期条目按 pending 处理（防御异常状态值）', () => {
    const g = classifyMakeupDays([mkDay('2026-09-24', 'whatever'), mkDay('2026-09-23', '')], TODAY);
    expect(g.expiredPending).toHaveLength(2);
    expect(g.expiredConfirmed).toHaveLength(0);
  });

  it('无效日期归 invalid：格式错 / 假日期 / null / 缺 date 字段 / 非对象条目', () => {
    const g = classifyMakeupDays([
      mkDay('2026/09/26'),
      mkDay('2026-02-30'),
      mkDay(null),
      { id: 'no-date', status: 'pending' },
      null
    ], TODAY);
    expect(g.invalid).toHaveLength(5);
    expect(g.future).toHaveLength(0);
  });

  it('todayStr 非法时所有条目（含日期合法的）都归 invalid', () => {
    const g = classifyMakeupDays([mkDay(TODAY), mkDay('2026-09-26')], 'bad');
    expect(g.invalid).toHaveLength(2);
    expect(g.today).toHaveLength(0);
  });

  it('组内排序：today/soon/future 升序，过期组降序（离今天最近在前）', () => {
    const g = classifyMakeupDays([
      mkDay('2026-10-10', 'confirmed'),
      mkDay('2026-09-26'),
      mkDay('2026-09-28', 'confirmed'),
      mkDay('2026-09-18', 'confirmed'),
      mkDay('2026-09-20', 'confirmed'),
      mkDay('2026-09-19'),
      mkDay('2026-09-23')
    ], TODAY);
    expect(g.soon.map(d => d.date)).toEqual(['2026-09-26', '2026-09-28']);
    expect(g.future.map(d => d.date)).toEqual(['2026-10-10']);
    expect(g.expiredConfirmed.map(d => d.date)).toEqual(['2026-09-20', '2026-09-18']);
    expect(g.expiredPending.map(d => d.date)).toEqual(['2026-09-23', '2026-09-19']);
  });

  it('纯函数：不修改入参，分组引用原对象', () => {
    const day = mkDay(TODAY);
    const input = [day];
    const snapshot = JSON.stringify(input);
    const g = classifyMakeupDays(input, TODAY);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(g.today[0]).toBe(day);
  });
});

describe('createMakeupDay / copyCoursesForMakeupDay 既有行为', () => {
  it('createMakeupDay 默认 pending、空课程、带 id', () => {
    const d = createMakeupDay('2026-10-10', '国庆调休');
    expect(d).toMatchObject({ date: '2026-10-10', name: '国庆调休', status: 'pending', copyFrom: null, courses: [] });
    expect(d.id).toBeTruthy();
  });

  it('copyCoursesForMakeupDay 深拷贝并重新生成 id，保留 customStart/customEnd', () => {
    const src = {
      monday: [{ id: 'a', name: '数学', period: '1-2', teacher: '张', location: 'A301', type: 'math', customStart: '08:00', customEnd: '09:25', startWeek: 1, endWeek: 8 }]
    };
    const copied = copyCoursesForMakeupDay(src, 'monday');
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatchObject({ name: '数学', period: '1-2', customStart: '08:00', customEnd: '09:25' });
    expect(copied[0].id).not.toBe('a');
    expect(copied[0].startWeek).toBeUndefined();
    expect(copyCoursesForMakeupDay(src, 'sunday')).toEqual([]);
    expect(copyCoursesForMakeupDay(null, 'monday')).toEqual([]);
  });

  it('WEEKDAYS 只含周一到周五', () => {
    expect(WEEKDAYS).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  });
});
