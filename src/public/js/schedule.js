    // State
    let schedule = null, isEditMode = false, currentDay = 'monday', currentWeekOffset = 0, editingCourseId = null;
    let annListCache = [];
    let totalPeriods = 12, totalWeeks = 16;
    let updateInterval = null; // 修复：用于清理定时器
    const dayNames = { monday: '周一', tuesday: '周二', wednesday: '周三', thursday: '周四', friday: '周五' };
    const { getAcademicWeek, getAcademicDate } = window.ScheduleDateUtils;
    const { getHolidayInfo } = window.ScheduleHolidays || {};
    const { copyCoursesForMakeupDay, createMakeupDay } = window.ScheduleMakeupDays || {};
    const defaultPeriods = [{startTime:'08:00',duration:45},{startTime:'08:55',duration:45},{startTime:'10:00',duration:45},{startTime:'10:55',duration:45},{startTime:'14:00',duration:45},{startTime:'14:55',duration:45},{startTime:'16:00',duration:45},{startTime:'16:55',duration:45},{startTime:'19:00',duration:45},{startTime:'19:55',duration:45},{startTime:'20:50',duration:45},{startTime:'21:45',duration:45}];
    let periodSettings = [...defaultPeriods];
    let settingsPeriodDraft = null;

    // XSS 防护：转义 HTML 特殊字符
    function escapeHtml(text) {
      if (text === null || text === undefined) return '';
      const div = document.createElement('div');
      div.textContent = String(text);
      return div.innerHTML;
    }

    function escapeAttr(text) {
      if (text === null || text === undefined) return '';
      return String(text).replace(/&/g, '&amp;')
                         .replace(/"/g, '&quot;')
                         .replace(/'/g, '&#39;')
                         .replace(/</g, '&lt;')
                         .replace(/>/g, '&gt;');
    }

    function formatClockTime(minutes) {
      const minutesInDay = 24 * 60;
      const normalized = ((minutes % minutesInDay) + minutesInDay) % minutesInDay;
      return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
    }

    function clonePeriodSettings(settings) {
      return Array.isArray(settings) ? settings.map(p => ({ ...p })) : [];
    }

    function resizePeriodSettingsForCount(settings, count) {
      const resized = clonePeriodSettings(settings).slice(0, count);
      while (resized.length < count) {
        const preset = defaultPeriods[resized.length];
        if (preset) {
          resized.push({ ...preset });
          continue;
        }
        const last = resized[resized.length - 1] || defaultPeriods[defaultPeriods.length - 1];
        const [h, m] = (last.startTime || '08:00').split(':');
        const duration = Number(last.duration) || 45;
        const totalMin = +h * 60 + +m + duration + 10;
        resized.push({ startTime: formatClockTime(totalMin), duration });
      }
      return resized;
    }

    function syncSettingsDraftFromDom() {
      if (!settingsPeriodDraft) return;
      for (let i = 0; i < settingsPeriodDraft.length; i++) {
        const timeInput = document.getElementById(`periodTime${i}`);
        const durationInput = document.getElementById(`periodDuration${i}`);
        if (timeInput && durationInput) {
          settingsPeriodDraft[i] = {
            startTime: timeInput.value || settingsPeriodDraft[i].startTime,
            duration: +durationInput.value || settingsPeriodDraft[i].duration || 45
          };
        }
      }
    }

    function renderPeriodSettingsForm(settings, count) {
      const container = document.getElementById('periodSettingsContainer');
      if (!container) return;
      container.innerHTML = settings.slice(0, count).map((p, i) => `
        <div class="period-setting">
          <label>第${i+1}节</label>
          <input type="time" id="periodTime${i}" value="${escapeAttr(p.startTime)}">
          <input type="number" id="periodDuration${i}" value="${p.duration}" min="1" max="180" style="width:60px;">
          <span style="font-size:12px;color:var(--gray-400);">分钟</span>
        </div>
      `).join('');
    }

    function createSelectOption(label, value) {
      const option = document.createElement('option');
      option.textContent = label;
      option.value = String(value);
      return option;
    }

    // ===== 站点 UI 配置（只读公网入口 / ICP 页脚） =====
    let isReadonlyPublic = false;

    async function loadUiConfig() {
      try {
        const res = await fetch('/api/ui-config');
        if (!res.ok) return;
        const cfg = await res.json();
        if (cfg.readonly) {
          isReadonlyPublic = true;
          const modeBtn = document.getElementById('modeBtn');
          if (modeBtn) modeBtn.style.display = 'none';
        }
        if (cfg.icpNumber) {
          const link = document.getElementById('icpNumberLink');
          const footer = document.getElementById('icpFooter');
          if (link) link.textContent = cfg.icpNumber;
          if (footer) footer.style.display = 'block';
        }
      } catch (err) {
        console.error('加载 UI 配置失败:', err);
      }
    }

    async function init() {
      try {
        await loadSchedule();
        // 等待只读配置返回后再开放交互，避免用户抢先点到「查看/编辑」按钮
        await loadUiConfig();
        initWeekOptions();
        initPeriodSettings();
        updateDate();
        setCurrentDayByDate();
        setupListeners();
        updateNextCourse();
        // 加载公告（非阻塞）
        loadAnnouncements();
        // 修复：保存定时器引用以便清理
        updateInterval = setInterval(() => { renderSchedule(); updateNextCourse(); }, 60000);
      } catch (err) {
        console.error('初始化失败:', err);
        document.getElementById('scheduleContent').innerHTML = '<div class="empty-state">初始化失败，请刷新页面重试</div>';
      }
    }

    async function loadSchedule() {
      try {
        const res = await fetch('/api/schedule');
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        schedule = await res.json();
        if (!schedule || typeof schedule !== 'object') {
          throw new Error('Invalid schedule data');
        }
        if (schedule.periodSettings?.length) periodSettings = schedule.periodSettings;
        if (schedule.totalPeriods) totalPeriods = schedule.totalPeriods;
        if (schedule.totalWeeks) totalWeeks = schedule.totalWeeks;
        document.getElementById('className').textContent = schedule.name || '班级课表';
        document.getElementById('classDesc').textContent = schedule.description || '点击右上角切换编辑模式';
        document.title = schedule.name || '班级课表';
        updateWeekDisplay();
        renderSchedule();
      } catch (err) {
        console.error('加载课表失败:', err);
        document.getElementById('scheduleContent').innerHTML = '<div class="empty-state">加载失败，请检查网络连接后刷新页面</div>';
        throw err;
      }
    }

    function initWeekOptions() {
      const start = document.getElementById('courseStartWeek'), end = document.getElementById('courseEndWeek');
      if (!start || !end) return;
      start.innerHTML = end.innerHTML = '';
      for (let i = 1; i <= totalWeeks; i++) {
        start.appendChild(createSelectOption(`第${i}周起`, i));
        end.appendChild(createSelectOption(`到第${i}周`, i));
      }
      start.value = 1; end.value = totalWeeks;
    }

    function initPeriodSettings(countOverride) {
      const override = Number(countOverride);
      const baseCount = settingsPeriodDraft ? settingsPeriodDraft.length : totalPeriods;
      const count = Number.isInteger(override) && override >= 1 && override <= 20 ? override : baseCount;
      syncSettingsDraftFromDom();
      settingsPeriodDraft = resizePeriodSettingsForCount(settingsPeriodDraft || periodSettings, count);
      renderPeriodSettingsForm(settingsPeriodDraft, count);
    }

    function setCurrentDayByDate() {
      const dayMap = {1:'monday',2:'tuesday',3:'wednesday',4:'thursday',5:'friday'};
      const today = dayMap[new Date().getDay()];
      if (today) {
        currentDay = today;
        document.querySelectorAll('.day-tab').forEach(t => t.classList.toggle('active', t.dataset.day === currentDay));
        renderSchedule();
      }
    }

    function updateDate() { 
      const d = new Date(), w = ['日','一','二','三','四','五','六'];
      const week = schedule && schedule.semesterStart ? getAcademicWeek(schedule.semesterStart, d) : 1;
      document.getElementById('currentDate').textContent = `${d.getMonth()+1}月${d.getDate()}日 周${w[d.getDay()]} · 第${week}周`; 
    }

    function getCurrentWeek() {
      if (!schedule || !schedule.semesterStart) return 1;
      return getAcademicWeek(schedule.semesterStart, new Date());
    }

    function updateWeekDisplay() {
      if (!schedule) return;
      const week = getCurrentWeek() + currentWeekOffset;
      document.getElementById('weekDisplay').textContent = `第${week}周`;
      ['monday','tuesday','wednesday','thursday','friday'].forEach((day, i) => {
        const date = getAcademicDate(schedule.semesterStart, week, i);
        const tab = document.querySelector(`[data-day="${day}"]`);
        const dayNumberEl = tab ? tab.querySelector('.day-number') : null;
        if (dayNumberEl && date) {
          dayNumberEl.textContent = `${date.getMonth()+1}/${date.getDate()}`;
        }
        // 节假日「休/班」标注
        if (tab) {
          tab.querySelectorAll('.holiday-badge,.workday-badge').forEach(el => el.remove());
          const info = date && typeof getHolidayInfo === 'function' ? getHolidayInfo(date) : null;
          if (info) {
            const badge = document.createElement('span');
            badge.className = info.type === 'holiday' ? 'holiday-badge' : 'workday-badge';
            badge.textContent = info.type === 'holiday' ? '休' : '班';
            badge.title = info.name;
            tab.appendChild(badge);
          }
        }
      });
    }

    function changeWeek(delta) {
      if (!schedule) return;
      const currentWeek = getCurrentWeek();
      const targetWeek = currentWeek + currentWeekOffset + delta;
      if (targetWeek < 1 || targetWeek > totalWeeks) return;
      currentWeekOffset += delta;
      updateWeekDisplay();
      renderSchedule();
      updateNextCourse();
    }

    function parsePeriods(p) {
      // 修复：处理空值
      if (!p || typeof p !== 'string') return [];
      p = p.replace(/[第节]/g, '').trim();
      if (p.includes('-')) { 
        const parts = p.split('-').map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] <= parts[1]) {
          return Array.from({length:parts[1]-parts[0]+1},(_,i)=>parts[0]+i);
        }
      }
      if (p.includes(',')) return p.split(',').map(Number).filter(n => !isNaN(n) && n > 0);
      const n = +p; 
      return !isNaN(n) && n > 0 ? [n] : [];
    }

    function formatPeriod(p) {
      const ps = parsePeriods(p);
      if (ps.length === 0) return '';
      return ps.length > 1 ? `第${ps[0]}-${ps[ps.length - 1]}节` : `第${ps[0]}节`;
    }

    function getTimeText(p) {
      const ps = parsePeriods(p);
      if (!ps.length) return '';
      const first = periodSettings[ps[0]-1], last = periodSettings[ps[ps.length - 1]-1];
      if (!first || !last) return '';
      const end = (([h,m]) => formatClockTime(+h*60 + +m + last.duration))(last.startTime.split(':'));
      return `${first.startTime}-${end}`;
    }

    function isCurrentCourse(c) {
      if (currentWeekOffset !== 0) return false;
      if (isSkippedInWeek(c, getCurrentWeek())) return false;
      // 修复：周末时不标记任何课程为当前课程
      const today = new Date().getDay();
      if (today === 0 || today === 6) return false;
      const now = new Date().getHours() * 60 + new Date().getMinutes();
      const ps = parsePeriods(c.period);
      if (ps.length === 0) return false;
      const first = periodSettings[ps[0]-1], last = periodSettings[ps[ps.length - 1]-1];
      if (!first || !last) return false;
      return now >= (+first.startTime.split(':')[0]*60 + +first.startTime.split(':')[1]) && 
             now < (+last.startTime.split(':')[0]*60 + +last.startTime.split(':')[1] + last.duration);
    }

    // 获取当前正在上的课程
    function getCurrentCourse() {
      if (currentWeekOffset !== 0) return null;
      // 周末无课
      const today = new Date().getDay();
      if (today === 0 || today === 6) return null;
      const dayMap = {1:'monday',2:'tuesday',3:'wednesday',4:'thursday',5:'friday'};
      const todayKey = dayMap[today];
      if (!todayKey || !schedule) return null;
      const week = getCurrentWeek();
      const courses = schedule.courses[todayKey] || [];
      const now = new Date().getHours() * 60 + new Date().getMinutes();
      for (const c of courses) {
        if (!isActiveInWeek(c, week)) continue;
        if (isSkippedInWeek(c, week)) continue;
        const ps = parsePeriods(c.period);
        if (ps.length === 0) continue;
        const first = periodSettings[ps[0]-1], last = periodSettings[ps[ps.length - 1]-1];
        if (!first || !last) continue;
        const startMin = +first.startTime.split(':')[0]*60 + +first.startTime.split(':')[1];
        const endMin = +last.startTime.split(':')[0]*60 + +last.startTime.split(':')[1] + last.duration;
        if (now >= startMin && now < endMin) {
          return {...c, dayName: dayNames[todayKey], startMin, endMin, remaining: endMin - now};
        }
      }
      return null;
    }

    function isActiveInWeek(c, week) {
      if (!c || typeof c !== 'object') return false;
      const s = c.startWeek || 1, e = c.endWeek || totalWeeks, t = c.weekType || 'all';
      if (week < s || week > e) return false;
      if (t === 'odd') return week % 2 === 1;
      if (t === 'even') return week % 2 === 0;
      return true;
    }

    function isSkippedInWeek(c, week) {
      if (!c || typeof c !== 'object') return false;
      const skipWeek = Number(c.skipWeek);
      return Number.isInteger(skipWeek) && skipWeek === getCurrentWeek() && skipWeek === week;
    }

    function formatWeekRange(c) {
      if (!c) return '';
      let t = `第${c.startWeek||1}-${c.endWeek||totalWeeks}周`;
      if (c.weekType === 'odd') t += '（单周）';
      else if (c.weekType === 'even') t += '（双周）';
      return t;
    }

    function renderSchedule() {
      const container = document.getElementById('scheduleContent');
      if (!schedule || !container) return;
      const courses = schedule.courses[currentDay] || [];
      let html = isEditMode ? `<button class="add-btn" data-action="add-course">+ 添加${escapeHtml(dayNames[currentDay])}课程</button>` : '';
      // 节假日/调休标注横幅（只标注，不重排课表）
      const viewedWeek = getCurrentWeek() + currentWeekOffset;
      const viewedDayIndex = ['monday','tuesday','wednesday','thursday','friday'].indexOf(currentDay);
      const viewedDate = viewedDayIndex >= 0 ? getAcademicDate(schedule.semesterStart, viewedWeek, viewedDayIndex) : null;
      const viewedHoliday = viewedDate && typeof getHolidayInfo === 'function' ? getHolidayInfo(viewedDate) : null;
      if (viewedHoliday && viewedHoliday.type === 'holiday') {
        html += `<div class="holiday-notice">🎉 ${escapeHtml(viewedHoliday.name)}假期（${escapeHtml(viewedHoliday.start)} ~ ${escapeHtml(viewedHoliday.end)}），上课安排以学校通知为准</div>`;
      } else if (viewedHoliday && viewedHoliday.type === 'workday') {
        html += `<div class="holiday-notice workday">🛠️ ${escapeHtml(viewedHoliday.name)}（调休上班），课程安排以学校通知为准</div>`;
      }
      if (!courses.length) {
        html += `<div class="empty-state"><div class="empty-state-icon">📚</div><p>${isEditMode ? '暂无课程' : '今日无课'}</p></div>`;
      } else {
        const week = getCurrentWeek() + currentWeekOffset;
        [...courses].sort((a,b) => (parsePeriods(a.period)[0]||0) - (parsePeriods(b.period)[0]||0)).forEach(c => {
          const isActive = isActiveInWeek(c, week);
          if (!isActive) return;
          const isSkipWeek = isSkippedInWeek(c, week);
          const isCurrent = !isSkipWeek && isCurrentCourse(c);
          const courseClass = `course-item${isCurrent?' current':''}${isSkipWeek?' skip-week':''}${isEditMode?' has-actions':''}`;
          // 修复：使用 escapeHtml 防止 XSS
          html += `
            <div class="${courseClass}">
              <div class="course-time"><span class="period">${escapeHtml(formatPeriod(c.period))}</span><span class="time">${escapeHtml(getTimeText(c.period))}</span></div>
              <div class="course-info" data-type="${escapeAttr(c.type||'')}">
                <div class="course-name">${escapeHtml(c.name)}${c.isMakeup?'<span class="makeup-badge">补课</span>':''}${isCurrent?' <span style="color:#FF6B6B;font-size:12px;">· 进行中</span>':''}</div>
                <div class="course-meta">${c.location?escapeHtml(`📍${c.location}`):''}${c.teacher?escapeHtml(` | 👤${c.teacher}`):''}</div>
                ${c.startWeek||c.endWeek?`<div class="course-weeks">${escapeHtml(formatWeekRange(c))}</div>`:''}
                ${isEditMode?`<div class="course-actions"><button data-action="edit" data-id="${escapeAttr(c.id)}">✏️</button><button data-action="delete" data-id="${escapeAttr(c.id)}">🗑️</button></div>`:''}
              </div>
              ${isSkipWeek?'<div class="skip-week-stamp">本周<br>不上</div>':''}
            </div>`;
        });
      }
      container.innerHTML = html;
      renderMakeupDays();
    }

    function findNextCourse() {
      if (!schedule) return null;
      const now = new Date(), week = getCurrentWeek() + currentWeekOffset, dayOrder = ['monday','tuesday','wednesday','thursday','friday'];
      const courses = [];
      dayOrder.forEach((day, i) => {
        (schedule.courses[day] || []).forEach(c => {
          const ps = parsePeriods(c.period);
          if (ps.length === 0) return;
          const setting = periodSettings[ps[0]-1];
          if (!setting) return;
          const [h, m] = setting.startTime.split(':');
          for (let courseWeek = Math.max(1, week); courseWeek <= totalWeeks; courseWeek++) {
            if (!isActiveInWeek(c, courseWeek)) continue;
            if (isSkippedInWeek(c, courseWeek)) continue;
            const candidateTime = getAcademicDate(schedule.semesterStart, courseWeek, i, +h, +m);
            if (candidateTime && candidateTime > now) {
              courses.push({...c, dayName: dayNames[day], time: candidateTime, week: courseWeek});
              break;
            }
          }
        });
      });
      return courses.sort((a,b) => a.time - b.time)[0] || null;
    }

    function isSameDate(a, b) {
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    function formatRemaining(minutes) {
      if (minutes < 0) minutes = 0;
      const hours = Math.floor(minutes / 60);
      const mins = Math.floor(minutes % 60);
      if (hours > 0) return `${hours}小时${mins}分钟`;
      return `${mins}分钟`;
    }

    function updateNextCourse() {
      const el = document.getElementById('nextCourse'), content = document.getElementById('nextCourseContent');
      if (!el || !content || !schedule) return;
      
      const current = getCurrentCourse();
      const next = findNextCourse();
      
      // 清除状态类
      el.classList.remove('no-class', 'in-class', 'ending-soon', 'next-week');
      
      // 情况1：周末或无课
      if (!current && !next) {
        el.classList.add('no-class');
        content.innerHTML = '<div class="next-course-name">今日无课</div><div class="next-course-info">好好休息吧 🎉</div>';
        return;
      }
      
      // 情况2：正在上课
      if (current) {
        el.classList.add('in-class');
        const isEndingSoon = current.remaining <= 10; // 10分钟内下课
        
        if (isEndingSoon && next) {
          // 下课前 ≤10 分钟：主从切换！大字显示下一节课，小字显示当前即将结束
          el.classList.add('ending-soon');
          const diff = next.time - new Date();
          const diffMins = Math.floor(diff / 60000);
          
          let html = `<div class="next-course-title">⏰ 下一节课</div>`;
          html += `<div class="next-course-name">${escapeHtml(next.name)}</div>`;
          html += `<div class="next-course-info">${isSameDate(next.time, new Date()) ? '今天' : escapeHtml(next.dayName)} ${escapeHtml(getTimeText(next.period))} | 📍${escapeHtml(next.location||'暂无地点')}</div>`;
          html += `<div class="next-course-countdown" style="color:#FF6B6B;">${diffMins > 0 ? `还有${formatRemaining(diffMins)}` : '即将开始'}</div>`;
          // 小字显示当前课即将结束
          html += `<div class="next-course-secondary">${escapeHtml(current.name)} · 剩余${formatRemaining(current.remaining)}下课</div>`;
          content.innerHTML = html;
        } else {
          // 正常上课中：大字显示当前课程，小字显示下一节课
          const titleText = '当前课程';
          let html = `<div class="next-course-title">📚 ${titleText}</div>`;
          html += `<div class="next-course-name">${escapeHtml(current.name)} · 剩余${formatRemaining(current.remaining)}</div>`;
          html += `<div class="next-course-info">📍${escapeHtml(current.location||'暂无地点')} ${escapeHtml(getTimeText(current.period))}</div>`;
          
          if (next) {
            const diff = next.time - new Date();
            const diffMins = Math.floor(diff / 60000);
            html += `<div class="next-course-secondary">下一节课：${escapeHtml(next.name)}（${isSameDate(next.time, new Date()) ? '今天' : escapeHtml(next.dayName)}，还有${formatRemaining(diffMins)}）</div>`;
          }
          content.innerHTML = html;
        }
        return;
      }
      
      // 情况3：课间休息/无课中，但有下一节课
      if (!current && next) {
        el.classList.remove('in-class', 'no-class');
        const diff = next.time - new Date();
        const diffMins = Math.floor(diff / 60000);
        const isToday = isSameDate(next.time, new Date());
        const viewedWeek = getCurrentWeek() + currentWeekOffset;
        const isNextWeek = next.week === viewedWeek + 1;
        if (isNextWeek) el.classList.add('next-week');
        
        let html = `<div class="next-course-title">${isNextWeek ? '📅 下一周课程' : '⏰ 下一节课'}</div>`;
        html += `<div class="next-course-name">${escapeHtml(next.name)}</div>`;
        html += `<div class="next-course-info">${isNextWeek ? `第${next.week}周 · ` : ''}${isToday ? '今天' : escapeHtml(next.dayName)} ${escapeHtml(getTimeText(next.period))} | 📍${escapeHtml(next.location||'暂无地点')}</div>`;
        html += `<div class="next-course-countdown">${diffMins > 0 ? `还有${formatRemaining(diffMins)}` : '即将开始'}</div>`;
        content.innerHTML = html;
        return;
      }
    }

    function setupListeners() {
      document.querySelectorAll('.day-tab').forEach(t => t.onclick = () => { currentDay = t.dataset.day; document.querySelectorAll('.day-tab').forEach(x => x.classList.remove('active')); t.classList.add('active'); renderSchedule(); });
      document.querySelectorAll('.color-option').forEach(o => o.onclick = () => { document.querySelectorAll('.color-option').forEach(x => x.classList.remove('selected')); o.classList.add('selected'); });
      const makeupCb = document.getElementById('courseMakeup');
      if (makeupCb) makeupCb.addEventListener('change', toggleMakeupMode);
      const skipCb = document.getElementById('courseSkipThisWeek');
      if (skipCb) {
        skipCb.addEventListener('change', () => {
          if (skipCb.checked && makeupCb) {
            makeupCb.checked = false;
            toggleMakeupMode();
          }
        });
      }
      const totalPeriodsInput = document.getElementById('settingTotalPeriods');
      if (totalPeriodsInput) {
        const updatePeriodSettings = () => initPeriodSettings(+totalPeriodsInput.value);
        totalPeriodsInput.addEventListener('input', updatePeriodSettings);
        totalPeriodsInput.addEventListener('change', updatePeriodSettings);
      }
      ['courseModal','settingsModal','passwordModal','annManageModal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.onclick = e => {
            if(e.target.id === id) {
              if (id === 'courseModal') { closeModal(); return; }
              const closeFn = window['close'+id.replace('Modal','').replace('settings','Settings').replace('password','Password').replace('annManage','AnnManage')+'Modal'];
              if (typeof closeFn === 'function') closeFn();
            }
          };
        }
      });
      // ICS 订阅弹窗：点遮罩关闭
      const icsModalEl = document.getElementById('icsModal');
      if (icsModalEl) {
        icsModalEl.onclick = e => { if (e.target.id === 'icsModal') closeIcsModal(); };
      }
      // 调休补课弹窗：点遮罩关闭
      const makeupDayModalEl = document.getElementById('makeupDayModal');
      if (makeupDayModalEl) {
        makeupDayModalEl.onclick = e => { if (e.target.id === 'makeupDayModal') closeMakeupDayModal(); };
      }
      const makeupCoursesModalEl = document.getElementById('makeupCoursesModal');
      if (makeupCoursesModalEl) {
        makeupCoursesModalEl.onclick = e => { if (e.target.id === 'makeupCoursesModal') closeMakeupCoursesModal(); };
      }
      // 补课课程来源切换（复制周X / 自建课程）
      const makeupModeSel = document.getElementById('makeupCoursesMode');
      if (makeupModeSel) {
        makeupModeSel.addEventListener('change', toggleMakeupCoursesMode);
      }
      // 自建课程行动态增删，用事件委托避免 innerHTML 替换后事件丢失
      const makeupRowsContainer = document.getElementById('makeupCourseRows');
      if (makeupRowsContainer) {
        makeupRowsContainer.addEventListener('click', e => {
          const btn = e.target.closest('[data-action="makeup-remove-row"]');
          if (btn) btn.closest('.makeup-course-form-row').remove();
        });
      }
      // 调休补课区块事件委托
      const makeupSection = document.getElementById('makeupDaysSection');
      if (makeupSection) {
        makeupSection.addEventListener('click', e => {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.dataset.action;
          const id = btn.dataset.id;
          if (action === 'add-makeup-day') openMakeupDayModal();
          else if (action === 'makeup-add-courses' || action === 'makeup-edit-courses') openMakeupCoursesModal(id);
          else if (action === 'makeup-revert') revertMakeupDay(id);
          else if (action === 'makeup-delete') deleteMakeupDay(id);
        });
      }
      const pwdInput = document.getElementById('passwordInput');
      if (pwdInput) {
        pwdInput.addEventListener('keypress', e => { if(e.key === 'Enter') verifyPassword(); });
      }
      // Toolbar 事件委托（避免内联 onclick，保持选择器稳定）
      const toolbar = document.querySelector('.toolbar');
      if (toolbar) {
        toolbar.addEventListener('click', e => {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.dataset.action;
          if (action === 'save') { e.preventDefault(); saveChanges(); }
        });
      }

      // 公告列表事件委托（避免 innerHTML 替换后事件丢失）
      const annListContainer = document.getElementById('annListContainer');
      if (annListContainer) {
        annListContainer.addEventListener('click', e => {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const id = btn.dataset.id;
          const action = btn.dataset.action;
          if (action === 'edit') editAnnouncement(id);
          else if (action === 'delete') deleteAnnouncement(id);
        });
      }
      // 课程列表事件委托（避免内联 onclick XSS）
      const scheduleContent = document.getElementById('scheduleContent');
      if (scheduleContent) {
        scheduleContent.addEventListener('click', e => {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.dataset.action;
          const id = btn.dataset.id;
          if (action === 'add-course') openModal();
          else if (action === 'edit') editCourse(id);
          else if (action === 'delete') deleteCourse(id);
        });
      }
    }

    async function toggleMode() {
      if (isReadonlyPublic) return; // 公网只读入口无编辑模式
      if (isEditMode) { 
        isEditMode = false; 
        updateModeUI(); 
        renderSchedule(); 
      } else {
        try {
          const res = await fetch('/api/verify', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:''})});
          // 只读入口的写接口返回 403 JSON，不能据此进入编辑模式
          if (!res.ok) {
            if (res.status === 403) {
              showToast('当前为只读入口，无法进入编辑模式', 'error');
              return;
            }
            throw new Error(`HTTP error! status: ${res.status}`);
          }
          const data = await res.json();
          if (data.requirePassword) {
            document.getElementById('passwordModal').classList.add('active');
            // 隐藏下一节课卡片
            const nextCourse = document.getElementById('nextCourse');
            if (nextCourse) nextCourse.style.display = 'none';
          } else {
            enableEditMode();
          }
        } catch (err) {
          console.error('验证失败:', err);
          showToast('验证失败，请检查网络连接', 'error');
        }
      }
    }

    function enableEditMode() { isEditMode = true; updateModeUI(); renderSchedule(); showToast('已进入编辑模式', 'success'); }

    function updateModeUI() {
      const btn = document.getElementById('modeBtn'), toolbar = document.getElementById('toolbar');
      if (btn) {
        btn.className = 'mode-badge ' + (isEditMode ? 'edit' : '');
        btn.innerHTML = isEditMode ? '✏️ 编辑' : '👀 查看';
      }
      if (toolbar) toolbar.style.display = isEditMode ? 'flex' : 'none';
    }

    function closePasswordModal() { 
      document.getElementById('passwordModal').classList.remove('active'); 
      document.getElementById('passwordInput').value = ''; 
      // 恢复密码框为隐藏状态
      const pwdInput = document.getElementById('passwordInput');
      const toggleBtn = document.getElementById('togglePasswordBtn');
      if (pwdInput) pwdInput.type = 'password';
      if (toggleBtn) toggleBtn.textContent = '显示';
      // 恢复下一节课卡片显示
      const nextCourse = document.getElementById('nextCourse');
      if (nextCourse) nextCourse.style.display = 'block';
    }

    function togglePasswordVisibility() {
      const pwdInput = document.getElementById('passwordInput');
      const btn = document.getElementById('togglePasswordBtn');
      if (!pwdInput || !btn) return;
      if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        btn.textContent = '隐藏';
      } else {
        pwdInput.type = 'password';
        btn.textContent = '显示';
      }
    }

    async function verifyPassword() {
      const passwordInput = document.getElementById('passwordInput');
      const password = passwordInput ? passwordInput.value : '';
      try {
        const res = await fetch('/api/verify', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
        const data = await res.json();
        if (data.valid) { 
          sessionStorage.setItem('scheduleEditPwd', password);
          closePasswordModal(); 
          enableEditMode(); 
        } else {
          showToast('密码错误', 'error');
        }
      } catch (err) {
        console.error('验证密码失败:', err);
        showToast('网络错误，请重试', 'error');
      }
    }

    function openSettingsModal() {
      if (!schedule) return;
      document.getElementById('settingClassName').value = schedule.name || '';
      document.getElementById('settingClassDesc').value = schedule.description || '';
      document.getElementById('settingSemesterStart').value = schedule.semesterStart || '';
      document.getElementById('settingTotalPeriods').value = totalPeriods;
      document.getElementById('settingTotalWeeks').value = totalWeeks;
      settingsPeriodDraft = resizePeriodSettingsForCount(periodSettings, totalPeriods);
      renderPeriodSettingsForm(settingsPeriodDraft, totalPeriods);
      document.getElementById('settingsModal').classList.add('active');
      // 隐藏下一节课卡片
      const nextCourse = document.getElementById('nextCourse');
      if (nextCourse) nextCourse.style.display = 'none';
    }

    function closeSettingsModal() { 
      document.getElementById('settingsModal').classList.remove('active'); 
      settingsPeriodDraft = null;
      // 恢复下一节课卡片显示
      const nextCourse = document.getElementById('nextCourse');
      if (nextCourse) nextCourse.style.display = 'block';
    }

    async function saveSettings() {
      const name = document.getElementById('settingClassName').value.trim();
      const description = document.getElementById('settingClassDesc').value.trim();
      const semesterStart = document.getElementById('settingSemesterStart').value;
      const newTotalPeriods = Number(document.getElementById('settingTotalPeriods').value);
      const newTotalWeeks = +document.getElementById('settingTotalWeeks').value || 16;
      if (!Number.isInteger(newTotalPeriods) || newTotalPeriods < 1 || newTotalPeriods > 20) {
        return showToast('总节数应在 1-20 范围内', 'error');
      }
      syncSettingsDraftFromDom();
      const newPeriodSettings = resizePeriodSettingsForCount(settingsPeriodDraft || periodSettings, newTotalPeriods);
      try {
        const res = await fetch('/api/schedule/settings', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:sessionStorage.getItem('scheduleEditPwd')||'',name,description,semesterStart,totalPeriods:newTotalPeriods,totalWeeks:newTotalWeeks,periodSettings:newPeriodSettings})});
        const data = await res.json();
        if (data.success) {
          schedule.name = name; schedule.description = description; schedule.semesterStart = semesterStart;
          schedule.totalPeriods = newTotalPeriods; schedule.totalWeeks = newTotalWeeks; schedule.periodSettings = newPeriodSettings;
          totalPeriods = newTotalPeriods; totalWeeks = newTotalWeeks; periodSettings = newPeriodSettings;
          initWeekOptions();
          document.getElementById('className').textContent = name;
          document.getElementById('classDesc').textContent = description || '点击右上角切换编辑模式';
          document.title = name;
          closeSettingsModal(); updateWeekDisplay(); renderSchedule();
          // 学期起始日可能已变，刷新头部「第N周」
          updateDate();
          showToast('设置已保存', 'success');
        } else showToast(data.error || '保存失败', 'error');
      } catch (err) {
        console.error('保存设置失败:', err);
        showToast('网络错误', 'error'); 
      }
    }

    function openModal() {
      editingCourseId = null;
      document.getElementById('modalTitle').textContent = '添加课程';
      document.getElementById('courseName').value = '';
      document.getElementById('coursePeriod').value = '';
      document.getElementById('courseLocation').value = '';
      document.getElementById('courseTeacher').value = '';
      document.getElementById('courseDay').value = currentDay;
      document.getElementById('courseStartWeek').value = '1';
      document.getElementById('courseEndWeek').value = totalWeeks;
      document.getElementById('courseWeekType').value = 'all';
      document.getElementById('courseCustomStart').value = '';
      document.getElementById('courseCustomEnd').value = '';
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      // 重置补课模式
      const makeupCb = document.getElementById('courseMakeup');
      if (makeupCb) { makeupCb.checked = false; toggleMakeupMode(); }
      const skipCb = document.getElementById('courseSkipThisWeek');
      if (skipCb) { skipCb.checked = false; skipCb.disabled = false; }
      document.getElementById('courseModal').classList.add('active');
      // 隐藏下一节课卡片，避免遮挡弹窗底部
      const nextCourse = document.getElementById('nextCourse');
      if (nextCourse) nextCourse.style.display = 'none';
    }

    function closeModal() { 
      document.getElementById('courseModal').classList.remove('active'); 
      editingCourseId = null; 
      // 恢复下一节课卡片显示
      const nextCourse = document.getElementById('nextCourse');
      if (nextCourse) nextCourse.style.display = 'block';
    }

    async function saveCourse() {
      const name = document.getElementById('courseName').value.trim();
      const period = document.getElementById('coursePeriod').value.trim();
      const day = document.getElementById('courseDay').value;
      if (!name) return showToast('请输入课程名称', 'error');
      if (!period) return showToast('请输入节次', 'error');
      
      // 验证节次格式
      const parsedPeriods = parsePeriods(period);
      if (parsedPeriods.length === 0) {
        return showToast('节次格式不正确，例如：1-2 或 3', 'error');
      }
      if (parsedPeriods.some(p => p < 1 || p > totalPeriods)) {
        return showToast(`节次应在 1-${totalPeriods} 范围内`, 'error');
      }
      
      const type = document.querySelector('.color-option.selected')?.dataset.type || '';
      const isMakeup = document.getElementById('courseMakeup')?.checked || false;
      const skipThisWeek = !isMakeup && (document.getElementById('courseSkipThisWeek')?.checked || false);
      const startWeek = +document.getElementById('courseStartWeek').value;
      const endWeek = +document.getElementById('courseEndWeek').value;
      if (startWeek > endWeek) {
        return showToast('起始周次不能大于结束周次', 'error');
      }
      // 自定义上下课时间（可选）：两个都填才生效，且结束必须晚于开始
      const customStart = document.getElementById('courseCustomStart').value;
      const customEnd = document.getElementById('courseCustomEnd').value;
      if ((customStart && !customEnd) || (!customStart && customEnd)) {
        return showToast('自定义上下课时间需同时填写或同时留空', 'error');
      }
      if (customStart && customEnd && customEnd <= customStart) {
        return showToast('自定义下课时间必须晚于上课时间', 'error');
      }
      const course = {
        id: editingCourseId || Date.now().toString() + Math.random().toString(36).substr(2, 5),
        name, period, day,
        location: document.getElementById('courseLocation').value.trim(),
        teacher: document.getElementById('courseTeacher').value.trim(),
        type,
        startWeek,
        endWeek,
        weekType: document.getElementById('courseWeekType').value,
        isMakeup
      };
      if (customStart && customEnd) {
        course.customStart = customStart;
        course.customEnd = customEnd;
      }
      if (skipThisWeek) course.skipWeek = Math.max(1, Math.min(totalWeeks, getCurrentWeek()));
      
      if (editingCourseId) {
        Object.keys(schedule.courses).forEach(d => {
          schedule.courses[d] = schedule.courses[d].filter(c => c.id !== editingCourseId);
        });
      }
      if (!schedule.courses[day]) schedule.courses[day] = [];
      schedule.courses[day].push(course);
      closeModal();
      if (day !== currentDay) { 
        currentDay = day; 
        document.querySelectorAll('.day-tab').forEach(t => t.classList.toggle('active', t.dataset.day === day)); 
      }
      renderSchedule();
      updateNextCourse();
      // 自动保存
      await autoSave();
    }

    function editCourse(id) {
      if (!schedule || !schedule.courses[currentDay]) return;
      const c = schedule.courses[currentDay].find(x => x.id === id);
      if (!c) return;
      editingCourseId = id;
      document.getElementById('modalTitle').textContent = '编辑课程';
      document.getElementById('courseName').value = c.name;
      document.getElementById('coursePeriod').value = c.period;
      document.getElementById('courseDay').value = currentDay;
      document.getElementById('courseLocation').value = c.location || '';
      document.getElementById('courseTeacher').value = c.teacher || '';
      document.getElementById('courseStartWeek').value = c.startWeek || 1;
      document.getElementById('courseEndWeek').value = c.endWeek || totalWeeks;
      document.getElementById('courseWeekType').value = c.weekType || 'all';
      document.getElementById('courseCustomStart').value = c.customStart || '';
      document.getElementById('courseCustomEnd').value = c.customEnd || '';
      // 恢复补课模式状态：优先使用持久化的 isMakeup，兼容旧数据时再回退到启发式判断
      const isMakeup = Object.prototype.hasOwnProperty.call(c, 'isMakeup')
        ? !!c.isMakeup
        : c.startWeek === c.endWeek && c.weekType === 'all';
      const makeupCb = document.getElementById('courseMakeup');
      if (makeupCb) { makeupCb.checked = isMakeup; toggleMakeupMode(); }
      const skipCb = document.getElementById('courseSkipThisWeek');
      if (skipCb) { skipCb.checked = !isMakeup && isSkippedInWeek(c, getCurrentWeek()); skipCb.disabled = !!isMakeup; }
      document.querySelectorAll('.color-option').forEach(o => o.classList.toggle('selected', o.dataset.type === (c.type || '')));
      document.getElementById('courseModal').classList.add('active');
    }

    async function deleteCourse(id) {
      if (!confirm('确定删除这门课程？')) return;
      if (!schedule || !schedule.courses[currentDay]) return;
      schedule.courses[currentDay] = schedule.courses[currentDay].filter(c => c.id !== id);
      renderSchedule();
      // 自动保存
      await autoSave();
    }

    // 自动保存（成功时提示已保存，失败时提示错误）
    async function autoSave() {
      try {
        const res = await fetch('/api/schedule/courses', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:sessionStorage.getItem('scheduleEditPwd')||'',courses:schedule.courses})});
        const data = await res.json();
        if (data.success) {
          showToast('已自动保存', 'success');
        } else {
          showToast(data.error || '保存失败', 'error');
        }
      } catch (err) {
        console.error('自动保存失败:', err);
        showToast('网络错误', 'error'); 
      }
    }

    async function saveChanges() {
      const btn = document.querySelector('[data-action="save"]');
      if (btn) { btn.textContent = '保存中...'; btn.disabled = true; }
      try {
        const res = await fetch('/api/schedule/courses', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:sessionStorage.getItem('scheduleEditPwd')||'',courses:schedule.courses})});
        const data = await res.json();
        showToast(data.success ? '保存成功' : data.error || '保存失败', data.success ? 'success' : 'error');
      } catch (err) {
        console.error('保存失败:', err);
        showToast('网络错误', 'error'); 
      }
      if (btn) { btn.textContent = '💾 保存'; btn.disabled = false; }
    }

    async function clearAll() {
      if (!confirm('确定清空所有课程？此操作不可恢复。')) return;
      schedule.courses = {monday:[],tuesday:[],wednesday:[],thursday:[],friday:[]};
      renderSchedule();
      updateNextCourse();
      // 修复：清空后立即保存到服务器
      await autoSave();
      showToast('已清空并保存', 'success');
    }

    // ===== ICS 日历订阅 =====
    function openIcsModal() {
      const input = document.getElementById('icsLinkInput');
      if (input) input.value = `${location.origin}/api/calendar.ics`;
      document.getElementById('icsModal').classList.add('active');
      const nextCourse = document.getElementById('nextCourse');
      if (nextCourse) nextCourse.style.display = 'none';
    }

    function closeIcsModal() {
      document.getElementById('icsModal').classList.remove('active');
      const nextCourse = document.getElementById('nextCourse');
      if (nextCourse) nextCourse.style.display = 'block';
    }

    async function copyIcsLink() {
      const input = document.getElementById('icsLinkInput');
      if (!input) return;
      try {
        await navigator.clipboard.writeText(input.value);
        showToast('链接已复制', 'success');
      } catch (err) {
        input.select();
        document.execCommand('copy');
        showToast('链接已复制', 'success');
      }
    }

    function exportData() {
      if (!schedule) return;
      // 备份需覆盖全部可恢复数据：公告与调休补课日一并导出，导入端会校验并恢复
      const data = {name:schedule.name,description:schedule.description,semesterStart:schedule.semesterStart,courses:schedule.courses,announcements:Array.isArray(schedule.announcements)?schedule.announcements:[],makeupDays:getMakeupDays(),totalPeriods,totalWeeks,periodSettings,exportDate:new Date().toISOString()};
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
      const a = Object.assign(document.createElement('a'), {href: url, download: `${schedule.name}_课表.json`});
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showToast('已导出');
    }

    async function importData(input) {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (!data.courses) throw new Error('Invalid format');

          const res = await fetch('/api/import', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:sessionStorage.getItem('scheduleEditPwd')||'',data})});
          const result = await res.json();
          if (result.success) {
            if (result.schedule) {
              schedule = result.schedule;
              if (result.schedule.periodSettings?.length) periodSettings = result.schedule.periodSettings;
              if (result.schedule.totalPeriods) totalPeriods = result.schedule.totalPeriods;
              if (result.schedule.totalWeeks) totalWeeks = result.schedule.totalWeeks;
            }
            initWeekOptions(); initPeriodSettings();
            document.getElementById('className').textContent = schedule.name;
            document.getElementById('classDesc').textContent = schedule.description || '点击右上角切换编辑模式';
            document.title = schedule.name;
            updateWeekDisplay(); renderSchedule(); updateNextCourse();
            showToast('导入成功', 'success');
          } else showToast(result.error || '导入失败', 'error');
        } catch (err) {
          console.error('导入失败:', err);
          showToast('文件格式错误', 'error'); 
        }
      };
      reader.readAsText(file);
      input.value = '';
    }

    function showToast(msg, type = '') {
      const toast = document.getElementById('toast');
      if (!toast) return;
      toast.textContent = msg;
      toast.className = 'toast show ' + type;
      setTimeout(() => toast.classList.remove('show'), 2500);
    }

    // ===== 公告系统 =====
    let currentAnnouncements = [];
    let currentAnnIndex = 0;

    async function loadAnnouncements() {
      try {
        const res = await fetch('/api/announcements/active');
        const data = await res.json();
        currentAnnouncements = (data.announcements || []).filter(a => !isAnnDismissed(a.id));
        currentAnnIndex = 0;
        if (currentAnnouncements.length > 0) {
          showAnnouncement(currentAnnouncements[0]);
        }
      } catch (err) {
        console.error('加载公告失败:', err);
      }
    }

    function showAnnouncement(ann) {
      const modal = document.getElementById('announcementModal');
      const title = document.getElementById('annTitle');
      const content = document.getElementById('annContent');
      const dateEl = document.getElementById('annDate');
      if (!modal || !title || !content) return;
      title.textContent = ann.title || '公告';
      content.textContent = ann.content || '';
      const range = [];
      if (ann.startDate) range.push(`生效：${ann.startDate}`);
      if (ann.endDate) range.push(`截止：${ann.endDate}`);
      dateEl.textContent = range.join(' ｜ ');
      modal.classList.add('active');
    }

    function dismissAnnouncement() {
      document.getElementById('announcementModal').classList.remove('active');
      currentAnnIndex++;
      if (currentAnnIndex < currentAnnouncements.length) {
        setTimeout(() => showAnnouncement(currentAnnouncements[currentAnnIndex]), 300);
      }
    }

    function dontShowAgain() {
      const ann = currentAnnouncements[currentAnnIndex];
      if (ann) {
        let dismissed = [];
        try {
          dismissed = JSON.parse(localStorage.getItem('dismissedAnnouncements') || '[]');
          if (!Array.isArray(dismissed)) dismissed = [];
        } catch (e) {
          dismissed = [];
        }
        if (!dismissed.includes(ann.id)) dismissed.push(ann.id);
        localStorage.setItem('dismissedAnnouncements', JSON.stringify(dismissed));
      }
      dismissAnnouncement();
    }

    function isAnnDismissed(id) {
      try {
        const dismissed = JSON.parse(localStorage.getItem('dismissedAnnouncements') || '[]');
        return Array.isArray(dismissed) && dismissed.includes(id);
      } catch (e) {
        return false;
      }
    }

    // ===== 公告管理 =====
    function openAnnManageModal() {
      document.getElementById('annManageModal').classList.add('active');
      resetAnnEditForm();
      renderAnnList();
    }

    function closeAnnManageModal() {
      document.getElementById('annManageModal').classList.remove('active');
    }

    // 通用确认对话框（兼容禁用原生 confirm 的浏览器/嵌入环境）
    let confirmResolve = null;
    function showConfirmModal(msg) {
      document.getElementById('confirmBody').textContent = msg;
      document.getElementById('confirmModal').classList.add('active');
      return new Promise(resolve => { confirmResolve = resolve; });
    }
    function resolveConfirm(result) {
      document.getElementById('confirmModal').classList.remove('active');
      if (typeof confirmResolve === 'function') {
        confirmResolve(result);
        confirmResolve = null;
      }
    }

    function resetAnnEditForm() {
      document.getElementById('annEditId').value = '';
      document.getElementById('annEditTitle').value = '';
      document.getElementById('annEditContent').value = '';
      document.getElementById('annEditStart').value = '';
      document.getElementById('annEditEnd').value = '';
      document.getElementById('annEditEnabled').checked = true;
    }

    async function renderAnnList() {
      const container = document.getElementById('annListContainer');
      if (!container) return;
      let list = [];
      try {
        const res = await fetch('/api/announcements', {
          headers: {'x-password': sessionStorage.getItem('scheduleEditPwd') || ''}
        });
        const data = await res.json();
        list = data.announcements || [];
      } catch (err) {
        console.error('加载公告列表失败:', err);
        container.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:20px;">加载失败</div>';
        return;
      }
      if (list.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:20px;">暂无公告</div>';
        return;
      }
      annListCache = list;
      container.innerHTML = list.map(a => {
        const range = [];
        if (a.startDate) range.push(a.startDate);
        if (a.endDate) range.push(a.endDate);
        const rangeStr = range.length ? range.join(' ~ ') : '永久有效';
        const isEnabled = a.enabled !== false;
        return `
          <div class="ann-list-item ${isEnabled ? '' : 'disabled'}">
            <div class="ann-list-title">${escapeHtml(a.title)} ${isEnabled ? '' : '<span style="color:var(--gray-400);">(已禁用)</span>'}</div>
            <div class="ann-list-meta">${escapeHtml(rangeStr)}</div>
            <div class="ann-list-actions">
              <button class="ann-btn-edit" data-id="${escapeAttr(a.id)}" data-action="edit">编辑</button>
              <button class="ann-btn-del" data-id="${escapeAttr(a.id)}" data-action="delete">删除</button>
            </div>
          </div>
        `;
      }).join('');
    }

    function editAnnouncement(id) {
      const ann = (annListCache || []).find(a => a.id === id);
      if (!ann) return;
      document.getElementById('annEditId').value = ann.id;
      document.getElementById('annEditTitle').value = ann.title || '';
      document.getElementById('annEditContent').value = ann.content || '';
      document.getElementById('annEditStart').value = ann.startDate || '';
      document.getElementById('annEditEnd').value = ann.endDate || '';
      document.getElementById('annEditEnabled').checked = ann.enabled !== false;
    }

    async function saveAnnouncement() {
      const id = document.getElementById('annEditId').value;
      const announcement = {
        id: id || undefined,
        title: document.getElementById('annEditTitle').value.trim(),
        content: document.getElementById('annEditContent').value.trim(),
        startDate: document.getElementById('annEditStart').value || undefined,
        endDate: document.getElementById('annEditEnd').value || undefined,
        enabled: document.getElementById('annEditEnabled').checked
      };
      if (!announcement.title || !announcement.content) {
        showToast('标题和内容不能为空', 'error');
        return;
      }
      try {
        const res = await fetch('/api/announcements', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({password: sessionStorage.getItem('scheduleEditPwd')||'', announcement})
        });
        const data = await res.json();
        if (data.success) {
          showToast('公告已保存', 'success');
          resetAnnEditForm();
          renderAnnList();
        } else {
          showToast(data.error || '保存失败', 'error');
        }
      } catch (err) {
        console.error('保存公告失败:', err);
        showToast('网络错误', 'error');
      }
    }

    async function deleteAnnouncement(id) {
      if (!id) return;
      const ok = await showConfirmModal('确定删除这条公告？');
      if (!ok) return;
      try {
        const res = await fetch(`/api/announcements/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({password: sessionStorage.getItem('scheduleEditPwd')||''})
        });
        const data = await res.json();
        if (data.success) {
          showToast('公告已删除', 'success');
          renderAnnList();
        } else {
          showToast(data.error || '删除失败', 'error');
        }
      } catch (err) {
        console.error('删除公告失败:', err);
        showToast('网络错误', 'error');
      }
    }

    // ===== 调休补课日（「班」日） =====
    // makeupDays 是后续追加入口：随时可新增补课日，等学校通知后再补课程
    let editingMakeupDayId = null;

    function getMakeupDays() {
      return schedule && Array.isArray(schedule.makeupDays) ? schedule.makeupDays : [];
    }

    function makeupDateInfo(dateStr) {
      // '2026-09-20' → { label: '9月20日', weekName: '周六' }
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
      if (!m) return { label: dateStr || '', weekName: '' };
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return { label: `${Number(m[2])}月${Number(m[3])}日`, weekName: weekNames[d.getDay()] };
    }

    function renderMakeupDays() {
      const section = document.getElementById('makeupDaysSection');
      if (!section || !schedule) return;
      const days = getMakeupDays();
      // 只读入口只显示不编辑：编辑入口仅在自己的编辑模式下渲染
      const canEdit = isEditMode && !isReadonlyPublic;
      let html = '';
      if (canEdit) {
        html += `<button class="add-btn" data-action="add-makeup-day">+ 新增补课日</button>`;
      }
      if (days.length) {
        html += `<div class="makeup-days-title">🛠️ 调休补课</div>`;
      }
      [...days].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).forEach(day => {
        const info = makeupDateInfo(day.date);
        const confirmed = day.status === 'confirmed';
        const badge = confirmed
          ? '<span class="makeup-day-badge confirmed">班</span>'
          : '<span class="makeup-day-badge pending">待添加·等待通知</span>';
        html += `
          <div class="makeup-day-card ${confirmed ? '' : 'pending'}">
            <div class="makeup-day-header">
              <div>
                <div class="makeup-day-title">${escapeHtml(info.label)} ${escapeHtml(info.weekName)}${day.name ? ` · ${escapeHtml(day.name)}` : ''}</div>
                ${confirmed && day.copyFrom ? `<div class="makeup-day-sub">补${escapeHtml(dayNames[day.copyFrom] || '')}的课</div>` : ''}
              </div>
              ${badge}
            </div>`;
        if (confirmed) {
          const dayCourses = Array.isArray(day.courses) ? day.courses : [];
          [...dayCourses].sort((a, b) => (parsePeriods(a.period)[0] || 0) - (parsePeriods(b.period)[0] || 0)).forEach(c => {
            html += `
            <div class="makeup-course-row">
              <span class="makeup-course-time">${escapeHtml(formatPeriod(c.period))} ${escapeHtml(getTimeText(c.period))}</span>
              <span class="makeup-course-name">${escapeHtml(c.name)}</span>
              <span class="makeup-course-meta">${c.teacher ? escapeHtml(`👤${c.teacher}`) : ''}${c.location ? escapeHtml(` 📍${c.location}`) : ''}</span>
            </div>`;
          });
        } else {
          html += `<div class="makeup-day-sub" style="margin-top: 8px;">等待学校通知补哪天的课</div>`;
        }
        if (canEdit) {
          html += `<div class="makeup-day-actions">`;
          if (confirmed) {
            html += `<button data-action="makeup-edit-courses" data-id="${escapeAttr(day.id)}">编辑课程</button>`;
            html += `<button data-action="makeup-revert" data-id="${escapeAttr(day.id)}">改回待添加</button>`;
          } else {
            html += `<button data-action="makeup-add-courses" data-id="${escapeAttr(day.id)}">添加课程</button>`;
          }
          html += `<button class="danger" data-action="makeup-delete" data-id="${escapeAttr(day.id)}">删除</button>`;
          html += `</div>`;
        }
        html += `</div>`;
      });
      section.innerHTML = html;
      section.style.display = html ? 'block' : 'none';
    }

    function openMakeupDayModal() {
      document.getElementById('makeupDayDate').value = '';
      document.getElementById('makeupDayName').value = '';
      document.getElementById('makeupDayModal').classList.add('active');
    }

    function closeMakeupDayModal() {
      document.getElementById('makeupDayModal').classList.remove('active');
    }

    async function saveMakeupDay() {
      const date = document.getElementById('makeupDayDate').value;
      const name = document.getElementById('makeupDayName').value.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return showToast('请选择补课日期', 'error');
      }
      if (getMakeupDays().some(d => d.date === date)) {
        return showToast('该日期的补课日已存在', 'error');
      }
      schedule.makeupDays = getMakeupDays().slice();
      schedule.makeupDays.push(createMakeupDay(date, name));
      closeMakeupDayModal();
      renderMakeupDays();
      await saveMakeupDays();
    }

    function toggleMakeupCoursesMode() {
      const mode = document.getElementById('makeupCoursesMode').value;
      document.getElementById('makeupCopyGroup').style.display = mode === 'copy' ? 'block' : 'none';
      document.getElementById('makeupCustomGroup').style.display = mode === 'custom' ? 'block' : 'none';
    }

    function addMakeupCourseRow(course) {
      const container = document.getElementById('makeupCourseRows');
      if (!container) return;
      const c = course || {};
      const row = document.createElement('div');
      row.className = 'makeup-course-form-row';
      row.innerHTML = `
        <div class="form-row">
          <input type="text" class="form-input makeup-row-name" placeholder="课名 *" value="${escapeAttr(c.name || '')}">
          <input type="text" class="form-input makeup-row-period" placeholder="节次，如 1-2" value="${escapeAttr(c.period || '')}">
        </div>
        <div class="form-row" style="margin-top: 8px;">
          <input type="text" class="form-input makeup-row-teacher" placeholder="教师" value="${escapeAttr(c.teacher || '')}">
          <input type="text" class="form-input makeup-row-location" placeholder="地点" value="${escapeAttr(c.location || '')}">
        </div>
        <button type="button" class="row-del" data-action="makeup-remove-row">删除本条</button>`;
      container.appendChild(row);
    }

    function openMakeupCoursesModal(id) {
      const day = getMakeupDays().find(d => d.id === id);
      if (!day) return;
      editingMakeupDayId = id;
      const info = makeupDateInfo(day.date);
      document.getElementById('makeupCoursesTitle').textContent = `${info.label} 补课课程`;
      document.getElementById('makeupCoursesMode').value = day.status === 'confirmed' ? 'custom' : 'copy';
      if (day.copyFrom) document.getElementById('makeupCopyFrom').value = day.copyFrom;
      toggleMakeupCoursesMode();
      document.getElementById('makeupCourseRows').innerHTML = '';
      const existing = Array.isArray(day.courses) ? day.courses : [];
      if (existing.length) existing.forEach(c => addMakeupCourseRow(c));
      else addMakeupCourseRow();
      document.getElementById('makeupCoursesModal').classList.add('active');
    }

    function closeMakeupCoursesModal() {
      document.getElementById('makeupCoursesModal').classList.remove('active');
      editingMakeupDayId = null;
    }

    async function saveMakeupCourses() {
      const day = getMakeupDays().find(d => d.id === editingMakeupDayId);
      if (!day) return closeMakeupCoursesModal();
      const mode = document.getElementById('makeupCoursesMode').value;
      let courses = [];
      let copyFrom = null;
      if (mode === 'copy') {
        // 复制平时某周几的课程：深拷贝进 courses 并置 confirmed
        copyFrom = document.getElementById('makeupCopyFrom').value;
        courses = copyCoursesForMakeupDay(schedule.courses, copyFrom);
        if (!courses.length) {
          return showToast(`${dayNames[copyFrom] || ''}没有课程可复制`, 'error');
        }
      } else {
        for (const row of document.querySelectorAll('#makeupCourseRows .makeup-course-form-row')) {
          const name = row.querySelector('.makeup-row-name').value.trim();
          const period = row.querySelector('.makeup-row-period').value.trim();
          if (!name && !period) continue; // 跳过全空行
          if (!name || !period) return showToast('请填写课名和节次', 'error');
          if (!parsePeriods(period).length) return showToast('节次格式不正确，例如：1-2 或 3', 'error');
          courses.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            name, period,
            teacher: row.querySelector('.makeup-row-teacher').value.trim(),
            location: row.querySelector('.makeup-row-location').value.trim()
          });
        }
        if (!courses.length) return showToast('请至少添加一条课程', 'error');
      }
      day.courses = courses;
      day.copyFrom = copyFrom;
      day.status = 'confirmed';
      closeMakeupCoursesModal();
      renderMakeupDays();
      await saveMakeupDays();
    }

    async function revertMakeupDay(id) {
      const ok = await showConfirmModal('确定改回「待添加」？已填写的课程将被清空。');
      if (!ok) return;
      const day = getMakeupDays().find(d => d.id === id);
      if (!day) return;
      day.status = 'pending';
      day.copyFrom = null;
      day.courses = [];
      renderMakeupDays();
      await saveMakeupDays();
    }

    async function deleteMakeupDay(id) {
      const ok = await showConfirmModal('确定删除这个补课日？');
      if (!ok) return;
      schedule.makeupDays = getMakeupDays().filter(d => d.id !== id);
      renderMakeupDays();
      await saveMakeupDays();
    }

    async function saveMakeupDays() {
      try {
        const res = await fetch('/api/schedule/makeup-days', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:sessionStorage.getItem('scheduleEditPwd')||'',makeupDays:getMakeupDays()})});
        const data = await res.json();
        showToast(data.success ? '补课日已保存' : data.error || '保存失败', data.success ? 'success' : 'error');
      } catch (err) {
        console.error('保存补课日失败:', err);
        showToast('网络错误', 'error');
      }
    }

    // ===== 单周补课 =====
    function toggleMakeupMode() {
      const checkbox = document.getElementById('courseMakeup');
      const hint = document.getElementById('makeupHint');
      const weekNum = document.getElementById('makeupWeekNum');
      const startSel = document.getElementById('courseStartWeek');
      const endSel = document.getElementById('courseEndWeek');
      const weekType = document.getElementById('courseWeekType');
      const skipCb = document.getElementById('courseSkipThisWeek');
      if (!checkbox || !hint) return;
      if (checkbox.checked) {
        const currentWeek = Math.max(1, Math.min(totalWeeks, getCurrentWeek() + currentWeekOffset));
        if (weekNum) weekNum.textContent = currentWeek;
        hint.style.display = 'block';
        if (startSel) startSel.value = currentWeek;
        if (endSel) endSel.value = currentWeek;
        if (weekType) weekType.value = 'all';
        startSel.disabled = true;
        endSel.disabled = true;
        weekType.disabled = true;
        if (skipCb) { skipCb.checked = false; skipCb.disabled = true; }
      } else {
        hint.style.display = 'none';
        startSel.disabled = false;
        endSel.disabled = false;
        weekType.disabled = false;
        if (skipCb) skipCb.disabled = false;
      }
    }

    // 页面卸载时清理定时器
    window.addEventListener('beforeunload', () => {
      if (updateInterval) {
        clearInterval(updateInterval);
      }
    });

    init();
