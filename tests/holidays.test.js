const {
  getHolidayInfo,
  listHolidays,
  listWorkdays,
  toDateStr
} = require('../src/public/js/holidays');

describe('校历/节假日表', () => {
  it('假期区间内的日期返回 holiday', () => {
    expect(getHolidayInfo('2026-09-25')).toMatchObject({ type: 'holiday', name: '中秋节' });
    expect(getHolidayInfo('2026-09-26')).toMatchObject({ type: 'holiday', name: '中秋节' });
    expect(getHolidayInfo('2026-10-01')).toMatchObject({ type: 'holiday', name: '国庆节' });
    expect(getHolidayInfo('2026-10-07')).toMatchObject({ type: 'holiday', name: '国庆节' });
    expect(getHolidayInfo('2027-01-01')).toMatchObject({ type: 'holiday', name: '元旦' });
  });

  it('调休上班日返回 workday', () => {
    expect(getHolidayInfo('2026-09-20')).toMatchObject({ type: 'workday', name: '中秋节调休' });
    expect(getHolidayInfo('2026-10-10')).toMatchObject({ type: 'workday', name: '国庆节调休' });
  });

  it('普通日期返回 null', () => {
    expect(getHolidayInfo('2026-09-24')).toBeNull();
    expect(getHolidayInfo('2026-09-28')).toBeNull();
    expect(getHolidayInfo('2026-08-31')).toBeNull();
  });

  it('接受 Date 对象并按本地日期判断', () => {
    expect(getHolidayInfo(new Date(2026, 8, 25))).toMatchObject({ type: 'holiday', name: '中秋节' });
    expect(getHolidayInfo(new Date(2026, 8, 24))).toBeNull();
  });

  it('非法输入返回 null', () => {
    expect(getHolidayInfo('2026/09/25')).toBeNull();
    expect(getHolidayInfo('not-a-date')).toBeNull();
    expect(getHolidayInfo(null)).toBeNull();
    expect(getHolidayInfo(undefined)).toBeNull();
  });

  it('清单接口返回拷贝，外部修改不影响内置表', () => {
    const holidays = listHolidays();
    const workdays = listWorkdays();
    expect(holidays.length).toBe(3);
    expect(workdays.length).toBe(2);
    holidays[0].start = '1900-01-01';
    expect(getHolidayInfo('2026-09-25')).toMatchObject({ type: 'holiday' });
  });

  it('toDateStr 按本地时区格式化', () => {
    expect(toDateStr(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(toDateStr('2026-10-10')).toBe('2026-10-10');
    expect(toDateStr(new Date('invalid'))).toBeNull();
  });
});
