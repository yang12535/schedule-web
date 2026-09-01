(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ScheduleDateUtils = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DAY_MS = 86400000;
  const WEEK_MS = 7 * DAY_MS;

  function parseLocalDate(value) {
    if (value instanceof Date) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (
      date.getFullYear() !== Number(match[1]) ||
      date.getMonth() !== Number(match[2]) - 1 ||
      date.getDate() !== Number(match[3])
    ) {
      return null;
    }
    return date;
  }

  function getSemesterWeekStart(semesterStart) {
    const date = parseLocalDate(semesterStart);
    if (!date) return null;
    const daysSinceMonday = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - daysSinceMonday);
    return date;
  }

  function getAcademicWeek(semesterStart, date = new Date()) {
    const weekStart = getSemesterWeekStart(semesterStart);
    const current = parseLocalDate(date);
    if (!weekStart || !current) return 1;
    const startUtc = Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
    const currentUtc = Date.UTC(current.getFullYear(), current.getMonth(), current.getDate());
    return Math.max(1, Math.floor((currentUtc - startUtc) / WEEK_MS) + 1);
  }

  function getAcademicDate(semesterStart, week, dayIndex, hour = 0, minute = 0) {
    const date = getSemesterWeekStart(semesterStart);
    if (!date || !Number.isInteger(week) || week < 1 || !Number.isInteger(dayIndex)) {
      return null;
    }
    date.setDate(date.getDate() + (week - 1) * 7 + dayIndex);
    date.setHours(hour, minute, 0, 0);
    return date;
  }

  return { parseLocalDate, getSemesterWeekStart, getAcademicWeek, getAcademicDate };
}));
