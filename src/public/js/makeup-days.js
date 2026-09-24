/**
 * 调休补课日（「班」日）工具模块（UMD）
 * 前端 schedule.js 用于「复制周X的课程」与新建补课日；测试直接 require 验证复制逻辑。
 *
 * 数据模型（schedule.json 顶层 makeupDays 数组）：
 *   { id, date: 'YYYY-MM-DD', name: string 可空,
 *     status: 'pending'|'confirmed',
 *     copyFrom: 'monday'|...|'friday'|null,   // 仅作展示：补周几的课
 *     courses: [...] }                        // 字段同常规课程：name/period/teacher/location，可选 customStart/customEnd
 * status=pending：还没通知补哪天的课，ICS 不生成事件；
 * status=confirmed：courses 为当天课程，ICS 按 date 直接生成事件。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ScheduleMakeupDays = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const WEEKDAY_NAMES = { monday: '周一', tuesday: '周二', wednesday: '周三', thursday: '周四', friday: '周五' };

  function newId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 5);
  }

  // 复制某 weekday 的课程到补课日：深拷贝，仅保留当天课程所需字段并重新生成 id，
  // 周次元数据（startWeek/endWeek/weekType/skipWeek）对单日补课无意义，不复制；
  // customStart/customEnd（自定义上下课时间）属于当天课程属性，需保留。
  function copyCoursesForMakeupDay(courses, weekday) {
    if (!courses || typeof courses !== 'object' || !WEEKDAYS.includes(weekday)) return [];
    const list = Array.isArray(courses[weekday]) ? courses[weekday] : [];
    return list.map(c => {
      const copy = {
        id: newId(),
        name: String(c.name || ''),
        period: String(c.period || ''),
        teacher: c.teacher || '',
        location: c.location || '',
        type: c.type || ''
      };
      if (typeof c.customStart === 'string' && c.customStart) copy.customStart = c.customStart;
      if (typeof c.customEnd === 'string' && c.customEnd) copy.customEnd = c.customEnd;
      return copy;
    });
  }

  // 新建补课日：默认 pending（待添加·等待通知）
  function createMakeupDay(date, name) {
    return {
      id: newId(),
      date: date,
      name: name || '',
      status: 'pending',
      copyFrom: null,
      courses: []
    };
  }

  return { WEEKDAYS, WEEKDAY_NAMES, copyCoursesForMakeupDay, createMakeupDay };
}));
