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
