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
