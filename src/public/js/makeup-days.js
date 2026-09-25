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

  // ===== 有效期队列分组（纯展示层推导，不改动数据、不影响 ICS） =====
  // 临期阈值：距今天 ≤3 天算「临近」；过期 = 日期早于今天。
  const MAKEUP_SOON_DAYS = 3;

  // 严格解析 'YYYY-MM-DD'（排除 2026-02-30 之类的假日期），非法返回 null
  function parseMakeupDate(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof dateStr === 'string' ? dateStr : '');
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return { y, mo, d };
  }

  // dateStr 相对 todayStr 的天数差（0=今天，>0 未来，<0 已过期）；任一非法返回 null
  function diffMakeupDays(dateStr, todayStr) {
    const a = parseMakeupDate(dateStr), b = parseMakeupDate(todayStr);
    if (!a || !b) return null;
    return Math.round((Date.UTC(a.y, a.mo - 1, a.d) - Date.UTC(b.y, b.mo - 1, b.d)) / 86400000);
  }

  // 分组：today（今天）/ soon（临近 ≤MAKEUP_SOON_DAYS 天）/ future（更远）/
  // expiredPending / expiredConfirmed / invalid（日期非法，兜底防渲染丢数据）。
  // 过期 pending 不归档：它意味着学校没通知/管理员忘排课，是需要处理的信号；
  // 过期 confirmed 仅供归档折叠。todayStr 非法时所有条目落入 invalid。
  // 组内排序：today/soon/future 按日期升序，两个过期组按日期降序（离今天最近的在前）。
  // 纯函数：不修改入参，分组内引用原对象。
  function classifyMakeupDays(days, todayStr) {
    const groups = { today: [], soon: [], future: [], expiredPending: [], expiredConfirmed: [], invalid: [] };
    if (!Array.isArray(days)) return groups;
    days.forEach(day => {
      const diff = day && typeof day === 'object' ? diffMakeupDays(day.date, todayStr) : null;
      if (diff === null) { groups.invalid.push(day); return; }
      if (diff === 0) { groups.today.push(day); return; }
      if (diff > 0) {
        (diff <= MAKEUP_SOON_DAYS ? groups.soon : groups.future).push(day);
        return;
      }
      (day.status === 'confirmed' ? groups.expiredConfirmed : groups.expiredPending).push(day);
    });
    const byDateAsc = (a, b) => String(a.date).localeCompare(String(b.date));
    const byDateDesc = (a, b) => String(b.date).localeCompare(String(a.date));
    groups.today.sort(byDateAsc);
    groups.soon.sort(byDateAsc);
    groups.future.sort(byDateAsc);
    groups.expiredPending.sort(byDateDesc);
    groups.expiredConfirmed.sort(byDateDesc);
    return groups;
  }

  return { WEEKDAYS, WEEKDAY_NAMES, copyCoursesForMakeupDay, createMakeupDay, MAKEUP_SOON_DAYS, diffMakeupDays, classifyMakeupDays };
}));
