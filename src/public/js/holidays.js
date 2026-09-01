/**
 * 校历/节假日表（2026-2027 学年第一学期）
 * 硬编码内置；前端用于周视图「休/班」标注，服务端用于 ICS 导出时跳过假期课程。
 * 调休上班日只标注、不重排课表（仅工作日排课，调休日均为周末，本模型下无课可调）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ScheduleHolidays = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 放假区间（闭区间，YYYY-MM-DD）
  const HOLIDAYS = [
    { name: '中秋节', start: '2026-09-25', end: '2026-09-27' },
    { name: '国庆节', start: '2026-10-01', end: '2026-10-07' },
    { name: '元旦', start: '2027-01-01', end: '2027-01-01' }
  ];

  // 调休上班日
  const WORKDAYS = [
    { date: '2026-09-20', name: '中秋节调休' },
    { date: '2026-10-10', name: '国庆节调休' }
  ];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toDateStr(date) {
    if (typeof date === 'string') {
      return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    }
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  // 返回 { type: 'holiday'|'workday', name, start?, end? } 或 null
  function getHolidayInfo(date) {
    const dateStr = toDateStr(date);
    if (!dateStr) return null;
    for (const w of WORKDAYS) {
      if (w.date === dateStr) return { type: 'workday', name: w.name, date: w.date };
    }
    for (const h of HOLIDAYS) {
      if (dateStr >= h.start && dateStr <= h.end) {
        return { type: 'holiday', name: h.name, start: h.start, end: h.end };
      }
    }
    return null;
  }

  function listHolidays() {
    return HOLIDAYS.map(h => ({ ...h }));
  }

  function listWorkdays() {
    return WORKDAYS.map(w => ({ ...w }));
  }

  return { getHolidayInfo, listHolidays, listWorkdays, toDateStr };
}));
