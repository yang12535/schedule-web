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

describe('Layout contract', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'js', 'schedule.js'),
    'utf8'
  );
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'index.html'),
    'utf8'
  );

  it('renders makeup-day courses in the two-column row layout', () => {
    expect(script).toContain('makeup-course-info');
    expect(script).toContain('mc-period');
    expect(html).toContain('.makeup-course-info');
    expect(html).toContain('.makeup-day-empty');
  });

  it('ships dark-mode variables and the unified in-progress badge', () => {
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('.live-badge');
    expect(script).toContain('live-badge');
  });
});

describe('Makeup validity queue UI (M35)', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'js', 'schedule.js'),
    'utf8'
  );
  const makeupJs = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'js', 'makeup-days.js'),
    'utf8'
  );
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'index.html'),
    'utf8'
  );

  it('classifyMakeupDays lives in makeup-days.js (UMD) with an exported soon-days constant', () => {
    expect(makeupJs).toContain('function classifyMakeupDays(days, todayStr)');
    expect(makeupJs).toContain('MAKEUP_SOON_DAYS = 3');
    expect(makeupJs).toContain('classifyMakeupDays');
    expect(script).toContain('classifyMakeupDays');
  });

  it('renders grouped queue with countdown chips and the expired-confirmed fold', () => {
    expect(script).toContain('makeup-day-chip');
    expect(script).toContain('makeup-expired-group');
    expect(script).toContain('expired-pending');
    expect(html).toContain('.makeup-day-chip');
    expect(html).toContain('.makeup-expired-group');
    expect(html).toContain('.makeup-day-badge.expired-pending');
  });

  it('has a persistent top banner container between day-tabs and scheduleContent', () => {
    expect(html).toContain('id="makeupBanner"');
    expect(html).toContain('.holiday-notice.makeup');
    expect(script).toContain('function renderMakeupBanner()');
    expect(script).toContain('scrollToMakeupSection');
    // 容器位置契约：day-tabs 之下、scheduleContent 之外（之前）
    const tabsIdx = html.indexOf('id="dayTabs"');
    const bannerIdx = html.indexOf('id="makeupBanner"');
    const contentIdx = html.indexOf('id="scheduleContent"');
    expect(tabsIdx).toBeGreaterThanOrEqual(0);
    expect(bannerIdx).toBeGreaterThan(tabsIdx);
    expect(contentIdx).toBeGreaterThan(bannerIdx);
  });

  it('marks expired announcements in the manage list', () => {
    expect(script).toContain('announcement-badge">已过期');
    expect(script).toContain('isAnnExpired');
  });
});

describe('Course id fallback guards (M30)', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'js', 'schedule.js'),
    'utf8'
  );

  it('edit/delete with empty id show explicit errors instead of silent failure', () => {
    // 旧数据课程缺 id → data-id=""：editCourse('') 曾静默 return，deleteCourse('')
    // 曾是静默空操作却仍 toast「已自动保存」。兜底路径必须给明确错误提示
    expect(script).toContain("if (!id) { showToast('该课程缺少 id，无法编辑");
    expect(script).toContain("if (!id) { showToast('该课程缺少 id，无法删除");
  });

  it('deleteCourse refuses the fake-success save when nothing matched the id', () => {
    // 删除前后长度不变 = 没有匹配到课程：报错返回，不走 autoSave
    expect(script).toContain('length === before');
    expect(script).toContain("showToast('未找到该课程，可能已被删除，请刷新后重试', 'error')");
  });
});
