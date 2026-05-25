    // State
    let schedule = null, isEditMode = false, currentDay = 'monday', currentWeekOffset = 0, editingCourseId = null;
    let annListCache = [];
    let totalPeriods = 12, totalWeeks = 16;
    let updateInterval = null; // 修复：用于清理定时器
    const dayNames = { monday: '周一', tuesday: '周二', wednesday: '周三', thursday: '周四', friday: '周五' };
    const defaultPeriods = [{startTime:'08:00',duration:45},{startTime:'08:55',duration:45},{startTime:'10:00',duration:45},{startTime:'10:55',duration:45},{startTime:'14:00',duration:45},{startTime:'14:55',duration:45},{startTime:'16:00',duration:45},{startTime:'16:55',duration:45},{startTime:'19:00',duration:45},{startTime:'19:55',duration:45},{startTime:'20:50',duration:45},{startTime:'21:45',duration:45}];
    let periodSettings = [...defaultPeriods];

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

    async function init() {
      try {
        await loadSchedule();
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
        start.add(new Option(`第${i}周起`, i));
        end.add(new Option(`到第${i}周`, i));
      }
      start.value = 1; end.value = totalWeeks;
    }

    function initPeriodSettings() {
      const container = document.getElementById('periodSettingsContainer');
      const count = +document.getElementById('settingTotalPeriods')?.value || totalPeriods;
      totalPeriods = count;
      while (periodSettings.length < count) {
        const last = periodSettings[periodSettings.length - 1];
        const [h, m] = last.startTime.split(':'); 
        const totalMin = +h * 60 + +m + last.duration + 10;
        periodSettings.push({startTime: `${String(Math.floor(totalMin/60)).padStart(2,'0')}:${String(totalMin%60).padStart(2,'0')}`, duration: 45});
      }
      if (container) {
        container.innerHTML = periodSettings.slice(0, count).map((p, i) => `
          <div class="period-setting">
            <label>第${i+1}节</label>
            <input type="time" id="periodTime${i}" value="${escapeAttr(p.startTime)}">
            <input type="number" id="periodDuration${i}" value="${p.duration}" min="1" max="180" style="width:60px;">
            <span style="font-size:12px;color:var(--gray-400);">分钟</span>
          </div>
        `).join('');
      }
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
      document.getElementById('currentDate').textContent = `${d.getMonth()+1}月${d.getDate()}日 周${w[d.getDay()]}`; 
    }

    function getCurrentWeek() {
      if (!schedule || !schedule.semesterStart) return 1;
      const today = new Date();
      const semesterStart = new Date(schedule.semesterStart);
      const diff = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(semesterStart.getFullYear(), semesterStart.getMonth(), semesterStart.getDate());
      return Math.max(1, Math.floor(diff / 604800000) + 1);
    }

    function updateWeekDisplay() {
      if (!schedule) return;
      const week = getCurrentWeek() + currentWeekOffset;
      document.getElementById('weekDisplay').textContent = `第${week}周`;
      const start = new Date(schedule.semesterStart);
      ['monday','tuesday','wednesday','thursday','friday'].forEach((day, i) => {
        const date = new Date(start.getTime() + (week - 1) * 604800000 + i * 86400000);
        const dayNumberEl = document.querySelector(`[data-day="${day}"] .day-number`);
        if (dayNumberEl) {
          dayNumberEl.textContent = `${date.getMonth()+1}/${date.getDate()}`;
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
      const end = (([h,m]) => { const t = +h*60 + +m + last.duration; return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`; })(last.startTime.split(':'));
      return `${first.startTime}-${end}`;
    }

    function isCurrentCourse(c) {
      if (currentWeekOffset !== 0) return false;
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
      return t === 'all' ? true : t === 'odd' ? week % 2 === 1 : week % 2 === 0;
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
      if (!courses.length) {
        html += `<div class="empty-state"><div class="empty-state-icon">📚</div><p>${isEditMode ? '暂无课程' : '今日无课'}</p></div>`;
      } else {
        const week = getCurrentWeek() + currentWeekOffset;
        [...courses].sort((a,b) => (parsePeriods(a.period)[0]||0) - (parsePeriods(b.period)[0]||0)).forEach(c => {
          const isActive = isActiveInWeek(c, week);
          const inWeekRange = week >= (c.startWeek || 1) && week <= (c.endWeek || totalWeeks);
          const isSkipWeek = !isActive && inWeekRange && (c.weekType === 'odd' || c.weekType === 'even');
          if (!isActive && !isSkipWeek) return;
          const isCurrent = isActive && isCurrentCourse(c);
          // 修复：使用 escapeHtml 防止 XSS
          html += `
            <div class="course-item ${isCurrent?'current':''}${isSkipWeek?' skip-week':''}">
              <div class="course-time"><span class="period">${escapeHtml(formatPeriod(c.period))}</span><span class="time">${escapeHtml(getTimeText(c.period))}</span></div>
              <div class="course-info" data-type="${escapeAttr(c.type||'')}">
                <div class="course-name">${escapeHtml(c.name)}${c.isMakeup?'<span class="makeup-badge">补课</span>':''}${isCurrent?' <span style="color:#FF6B6B;font-size:12px;">· 进行中</span>':''}</div>
                <div class="course-meta">${c.location?escapeHtml(`📍${c.location}`):''}${c.teacher?escapeHtml(` | 👤${c.teacher}`):''}</div>
                ${c.startWeek||c.endWeek?`<div class="course-weeks">${escapeHtml(formatWeekRange(c))}</div>`:''}
                ${isEditMode?`<div class="course-actions"><button data-action="edit" data-id="${escapeAttr(c.id)}">✏️</button><button data-action="delete" data-id="${escapeAttr(c.id)}">🗑️</button></div>`:''}
              </div>
              ${isSkipWeek?`<div class="skip-week-stamp"${isEditMode?' style="right:92px;"':''}>本周<br>不上</div>`:''}
            </div>`;
        });
      }
      container.innerHTML = html;
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
          const time = new Date(now);
          // 修复：正确计算课程日期（周日 getDay()=0 视为 7）
          const todayDay = time.getDay() === 0 ? 7 : time.getDay();
          let dayDiff = (i + 1) - todayDay;
          let weekOffset = 0;
          if (dayDiff < 0) {
            dayDiff += 7;
            weekOffset = 1;
          }
          if (!isActiveInWeek(c, week + weekOffset)) return;
          time.setDate(time.getDate() + dayDiff);
          time.setHours(+h, +m, 0, 0);
          if (time > now) courses.push({...c, dayName: dayNames[day], time});
        });
      });
      return courses.sort((a,b) => a.time - b.time)[0] || null;
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
      el.classList.remove('no-class', 'in-class', 'ending-soon');
      
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
          html += `<div class="next-course-info">${escapeHtml(next.dayName === current.dayName ? '今天' : next.dayName)} ${escapeHtml(getTimeText(next.period))} | 📍${escapeHtml(next.location||'暂无地点')}</div>`;
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
            html += `<div class="next-course-secondary">下一节课：${escapeHtml(next.name)}（${escapeHtml(next.dayName === current.dayName ? '今天' : next.dayName)}，还有${formatRemaining(diffMins)}）</div>`;
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
        const todayIndex = new Date().getDay() - 1;
        const todayKey = ['monday','tuesday','wednesday','thursday','friday'][todayIndex];
        const isToday = todayKey && next.dayName === dayNames[todayKey];
        
        let html = `<div class="next-course-title">⏰ 下一节课</div>`;
        html += `<div class="next-course-name">${escapeHtml(next.name)}</div>`;
        html += `<div class="next-course-info">${isToday ? '今天' : escapeHtml(next.dayName)} ${escapeHtml(getTimeText(next.period))} | 📍${escapeHtml(next.location||'暂无地点')}</div>`;
        html += `<div class="next-course-countdown" style="color:#FF6B6B;">${diffMins > 0 ? `还有${formatRemaining(diffMins)}` : '即将开始'}</div>`;
        content.innerHTML = html;
        return;
      }
    }

    function setupListeners() {
      document.querySelectorAll('.day-tab').forEach(t => t.onclick = () => { currentDay = t.dataset.day; document.querySelectorAll('.day-tab').forEach(x => x.classList.remove('active')); t.classList.add('active'); renderSchedule(); });
      document.querySelectorAll('.color-option').forEach(o => o.onclick = () => { document.querySelectorAll('.color-option').forEach(x => x.classList.remove('selected')); o.classList.add('selected'); });
      const makeupCb = document.getElementById('courseMakeup');
      if (makeupCb) makeupCb.addEventListener('change', toggleMakeupMode);
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
      if (isEditMode) { 
        isEditMode = false; 
        updateModeUI(); 
        renderSchedule(); 
      } else {
        try {
          const res = await fetch('/api/verify', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:''})});
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
      initPeriodSettings();
      document.getElementById('settingsModal').classList.add('active');
      // 隐藏下一节课卡片
      const nextCourse = document.getElementById('nextCourse');
      if (nextCourse) nextCourse.style.display = 'none';
    }

    function closeSettingsModal() { 
      document.getElementById('settingsModal').classList.remove('active'); 
      // 恢复下一节课卡片显示
      const nextCourse = document.getElementById('nextCourse');
      if (nextCourse) nextCourse.style.display = 'block';
    }

    async function saveSettings() {
      const name = document.getElementById('settingClassName').value.trim();
      const description = document.getElementById('settingClassDesc').value.trim();
      const semesterStart = document.getElementById('settingSemesterStart').value;
      const newTotalPeriods = +document.getElementById('settingTotalPeriods').value || 12;
      const newTotalWeeks = +document.getElementById('settingTotalWeeks').value || 16;
      const newPeriodSettings = [];
      for (let i = 0; i < newTotalPeriods; i++) {
        const timeInput = document.getElementById(`periodTime${i}`);
        const durationInput = document.getElementById(`periodDuration${i}`);
        if (timeInput && durationInput) {
          newPeriodSettings.push({startTime: timeInput.value, duration: +durationInput.value || 45});
        }
      }
      try {
        const res = await fetch('/api/schedule/settings', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:sessionStorage.getItem('scheduleEditPwd')||'',name,description,semesterStart,totalPeriods:newTotalPeriods,totalWeeks:newTotalWeeks,periodSettings:newPeriodSettings})});
        const data = await res.json();
        if (data.success) {
          schedule.name = name; schedule.description = description; schedule.semesterStart = semesterStart;
          totalPeriods = newTotalPeriods; totalWeeks = newTotalWeeks; periodSettings = newPeriodSettings;
          initWeekOptions();
          document.getElementById('className').textContent = name;
          document.getElementById('classDesc').textContent = description || '点击右上角切换编辑模式';
          document.title = name;
          closeSettingsModal(); updateWeekDisplay(); renderSchedule();
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
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      // 重置补课模式
      const makeupCb = document.getElementById('courseMakeup');
      if (makeupCb) { makeupCb.checked = false; toggleMakeupMode(); }
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
      const startWeek = +document.getElementById('courseStartWeek').value;
      const endWeek = +document.getElementById('courseEndWeek').value;
      if (startWeek > endWeek) {
        return showToast('起始周次不能大于结束周次', 'error');
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
      // 恢复补课模式状态：优先使用持久化的 isMakeup，兼容旧数据时再回退到启发式判断
      const isMakeup = Object.prototype.hasOwnProperty.call(c, 'isMakeup')
        ? !!c.isMakeup
        : c.startWeek === c.endWeek && c.weekType === 'all';
      const makeupCb = document.getElementById('courseMakeup');
      if (makeupCb) { makeupCb.checked = isMakeup; toggleMakeupMode(); }
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

    function exportData() {
      if (!schedule) return;
      const data = {name:schedule.name,description:schedule.description,semesterStart:schedule.semesterStart,courses:schedule.courses,totalPeriods,totalWeeks,periodSettings,exportDate:new Date().toISOString()};
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
        const res = await fetch('/api/announcements');
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

    // ===== 单周补课 =====
    function toggleMakeupMode() {
      const checkbox = document.getElementById('courseMakeup');
      const hint = document.getElementById('makeupHint');
      const weekNum = document.getElementById('makeupWeekNum');
      const startSel = document.getElementById('courseStartWeek');
      const endSel = document.getElementById('courseEndWeek');
      const weekType = document.getElementById('courseWeekType');
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
      } else {
        hint.style.display = 'none';
        startSel.disabled = false;
        endSel.disabled = false;
        weekType.disabled = false;
      }
    }

    // 页面卸载时清理定时器
    window.addEventListener('beforeunload', () => {
      if (updateInterval) {
        clearInterval(updateInterval);
      }
    });

    init();
