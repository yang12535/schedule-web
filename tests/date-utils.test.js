const {
  parseLocalDate,
  getSemesterWeekStart,
  getAcademicWeek,
  getAcademicDate
} = require('../src/public/js/date-utils');

describe('Schedule date utilities', () => {
  it('parses YYYY-MM-DD as a local calendar date', () => {
    const date = parseLocalDate('2026-03-01');
    expect([date.getFullYear(), date.getMonth() + 1, date.getDate()]).toEqual([2026, 3, 1]);
    expect(parseLocalDate('2026-02-30')).toBeNull();
  });

  it('normalizes the semester date to the Monday of its ISO week', () => {
    const start = getSemesterWeekStart('2026-03-01');
    expect([start.getFullYear(), start.getMonth() + 1, start.getDate(), start.getDay()])
      .toEqual([2026, 2, 23, 1]);
  });

  it('keeps Sunday 2026-06-07 in academic week 15', () => {
    const week = getAcademicWeek('2026-03-01', new Date(2026, 5, 7, 9, 0));
    expect(week).toBe(15);
  });

  it('maps the next academic Monday to 2026-06-08 instead of 2026-06-14', () => {
    const nextMonday = getAcademicDate('2026-03-01', 16, 0, 8, 0);
    expect([
      nextMonday.getFullYear(),
      nextMonday.getMonth() + 1,
      nextMonday.getDate(),
      nextMonday.getDay(),
      nextMonday.getHours()
    ]).toEqual([2026, 6, 8, 1, 8]);
  });
});
