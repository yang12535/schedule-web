const fs = require('fs');
const path = require('path');

describe('Front-end compatibility', () => {
  it('does not depend on the global Option constructor for week selects', () => {
    const script = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'public', 'js', 'schedule.js'),
      'utf8'
    );

    expect(script).not.toMatch(/\bnew\s+Option\s*\(/);
    expect(script).toContain("document.createElement('option')");
  });

  it('does not depend on Array.prototype.at for last period lookup', () => {
    const script = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'public', 'js', 'schedule.js'),
      'utf8'
    );

    expect(script).not.toMatch(/\.at\s*\(/);
    expect(script).toContain('ps[ps.length - 1]');
  });
});

describe('只读入口与设置保存的前端逻辑', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'js', 'schedule.js'),
    'utf8'
  );

  it('init() 等待 loadUiConfig() 完成，避免只读配置返回前的竞态', () => {
    expect(script).toContain('await loadUiConfig()');
  });

  it('toggleMode() 检查 /api/verify 响应状态，403 时提示只读并中止', () => {
    const toggleModeBody = script.match(/async function toggleMode\(\) \{[\s\S]*?\n    \}/);
    expect(toggleModeBody).not.toBeNull();
    expect(toggleModeBody[0]).toContain('res.ok');
    expect(toggleModeBody[0]).toContain('res.status === 403');
  });

  it('saveSettings() 保存成功后调用 updateDate() 刷新头部周数', () => {
    const saveSettingsBody = script.match(/async function saveSettings\(\) \{[\s\S]*?\n    \}/);
    expect(saveSettingsBody).not.toBeNull();
    expect(saveSettingsBody[0]).toContain('updateDate()');
  });
});

describe('备份导出与课程编辑器的前端逻辑', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'js', 'schedule.js'),
    'utf8'
  );
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'index.html'),
    'utf8'
  );

  it('exportData() 备份包含 announcements 与 makeupDays（导入端依赖这两字段恢复）', () => {
    const exportBody = script.match(/function exportData\(\) \{[\s\S]*?\n    \}/);
    expect(exportBody).not.toBeNull();
    expect(exportBody[0]).toContain('announcements');
    expect(exportBody[0]).toContain('makeupDays');
  });

  it('课程编辑器提供自定义上下课时间输入框', () => {
    expect(html).toContain('id="courseCustomStart"');
    expect(html).toContain('id="courseCustomEnd"');
  });

  it('saveCourse() 校验并写入 customStart/customEnd（成对填写、结束晚于开始）', () => {
    const saveBody = script.match(/async function saveCourse\(\) \{[\s\S]*?\n    \}/);
    expect(saveBody).not.toBeNull();
    expect(saveBody[0]).toContain("getElementById('courseCustomStart')");
    expect(saveBody[0]).toContain("getElementById('courseCustomEnd')");
    expect(saveBody[0]).toContain('course.customStart = customStart');
    expect(saveBody[0]).toContain('course.customEnd = customEnd');
  });

  it('editCourse() 回填已有 customStart/customEnd，编辑保存不丢值', () => {
    const editBody = script.match(/function editCourse\(id\) \{[\s\S]*?\n    \}/);
    expect(editBody).not.toBeNull();
    expect(editBody[0]).toContain('c.customStart');
    expect(editBody[0]).toContain('c.customEnd');
  });

  it('openModal() 新建课程时清空自定义时间输入框', () => {
    const openBody = script.match(/function openModal\(\) \{[\s\S]*?\n    \}/);
    expect(openBody).not.toBeNull();
    expect(openBody[0]).toContain("getElementById('courseCustomStart').value = ''");
    expect(openBody[0]).toContain("getElementById('courseCustomEnd').value = ''");
  });

  it('ICS 订阅说明与实际提醒一致：自适应提醒 + 时段汇总预告，不再写固定提前 15 分钟', () => {
    expect(html).not.toContain('提前 15 分钟');
    expect(html).toContain('提前 30 分钟');
    expect(html).toContain('60 分钟');
  });
});

describe('自定义上下课时间的前端消费（getCourseTimeRange 统一解析）', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'js', 'schedule.js'),
    'utf8'
  );

  it('存在统一的课程实际起止时间解析函数：合法 custom 优先，否则 periodSettings 推导', () => {
    const body = script.match(/function getCourseTimeRange\(c\) \{[\s\S]*?\n    \}/);
    expect(body).not.toBeNull();
    expect(body[0]).toContain('c.customStart');
    expect(body[0]).toContain('c.customEnd');
    expect(body[0]).toContain('ce > cs');
    expect(body[0]).toContain('periodSettings');
  });

  it('renderSchedule / isCurrentCourse / getCurrentCourse / findNextCourse 统一走解析函数', () => {
    for (const fn of ['isCurrentCourse', 'getCurrentCourse', 'findNextCourse', 'renderSchedule']) {
      const body = script.match(new RegExp(`function ${fn}\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}`));
      expect(body).not.toBeNull();
      expect(body[0]).toContain('getCourseTimeRange');
    }
  });

  it('时间文本按课程对象解析：课表条目与下一课卡片都认自定义时间', () => {
    const timeText = script.match(/function getTimeText\(c\) \{[\s\S]*?\n    \}/);
    expect(timeText).not.toBeNull();
    expect(timeText[0]).toContain('getCourseTimeRange(c)');
    const update = script.match(/function updateNextCourse\(\) \{[\s\S]*?\n    \}/);
    expect(update).not.toBeNull();
    expect(update[0]).toContain('getTimeText(next)');
    expect(update[0]).toContain('getTimeText(current)');
    expect(update[0]).not.toContain('getTimeText(next.period)');
  });
});

describe('补课日课程编辑的自定义时间与节次范围', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'js', 'schedule.js'),
    'utf8'
  );

  it('补课课程行提供自定义上下课时间输入框并回填已有值（编辑不再丢 custom 字段）', () => {
    const body = script.match(/function addMakeupCourseRow\(course\) \{[\s\S]*?\n    \}/);
    expect(body).not.toBeNull();
    expect(body[0]).toContain('makeup-row-custom-start');
    expect(body[0]).toContain('makeup-row-custom-end');
    expect(body[0]).toContain('c.customStart');
    expect(body[0]).toContain('c.customEnd');
  });

  it('saveMakeupCourses 校验并保留 customStart/customEnd，且校验节次范围', () => {
    const body = script.match(/async function saveMakeupCourses\(\) \{[\s\S]*?\n    \}/);
    expect(body).not.toBeNull();
    expect(body[0]).toContain('makeup-row-custom-start');
    expect(body[0]).toContain('makeup-row-custom-end');
    expect(body[0]).toContain('rowCourse.customStart = customStart');
    expect(body[0]).toContain('rowCourse.customEnd = customEnd');
    expect(body[0]).toContain('p > totalPeriods');
  });
});
