/* app.js — Organizador Semanal (100% local) */
(function () {
  'use strict';

  // ---------- Constantes ----------
  const PERIODS = [
    { key: 'morning', label: 'Manhã' },
    { key: 'afternoon', label: 'Tarde' },
    { key: 'night', label: 'Noite' },
  ];
  const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']; // getDay()
  const DOW_TAB = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']; // ordem de exibição

  // ---------- Estado ----------
  let state = null;
  let viewDate = todayISO();     // dia selecionado nas abas
  let currentView = 'hoje';
  let saveTimer = null;

  function defaultState() {
    return {
      version: 1,
      goals: [],                 // { id, text, type:'bool'|'counter', target }
      goalProgress: {},          // { [weekKey]: { [goalId]: { done, count } } }
      days: {},                  // { [iso]: { morning:[item], afternoon:[item], night:[item] } }
      streak: { history: [], breaksLogged: {} }, // history:[{date,len,reason}]
      settings: { dailyReminder: '08:00', defaultReminder: 10, streakGoal: 30 },
    };
  }

  // ---------- Helpers de data ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function fromISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
  function todayISO() { return toISO(new Date()); }
  function addDays(iso, n) { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  function mondayOf(iso) {
    const d = fromISO(iso);
    const dow = d.getDay();               // 0=Dom
    const diff = dow === 0 ? -6 : 1 - dow; // volta pra segunda
    d.setDate(d.getDate() + diff);
    return toISO(d);
  }
  function weekDates(iso) {
    const mon = mondayOf(iso);
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  }
  function weekKey(iso) { return mondayOf(iso); }
  function daysBetween(a, b) { return Math.round((fromISO(b) - fromISO(a)) / 86400000); }
  function fmtLong(iso) {
    const d = fromISO(iso);
    const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return `${DOW[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
  }
  function relLabel(iso) {
    const diff = daysBetween(todayISO(), iso);
    if (diff === 0) return 'Hoje';
    if (diff === -1) return 'Ontem';
    if (diff === 1) return 'Amanhã';
    return '';
  }

  // ---------- Acesso a dados ----------
  function dayData(iso) {
    if (!state.days[iso]) state.days[iso] = { morning: [], afternoon: [], night: [] };
    return state.days[iso];
  }
  function allItems(iso) {
    const d = state.days[iso];
    if (!d) return [];
    return [...d.morning, ...d.afternoon, ...d.night];
  }
  function dayStats(iso) {
    const items = allItems(iso);
    const total = items.length;
    const done = items.filter((i) => i.done).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }
  function isDayComplete(iso) {
    const s = dayStats(iso);
    return s.total > 0 && s.done === s.total;
  }
  function progressFor(gid) {
    const wk = weekKey(viewDate);
    if (!state.goalProgress[wk]) state.goalProgress[wk] = {};
    if (!state.goalProgress[wk][gid]) state.goalProgress[wk][gid] = { done: false, count: 0 };
    return state.goalProgress[wk][gid];
  }

  // ---------- Persistência ----------
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { DB.setState(state).catch(console.error); }, 120);
    syncPush();
  }

  // ---------- Integração com o backend de push ----------
  function utcCronFromLocal(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const off = new Date().getTimezoneOffset(); // minutos; UTC = local + off
    let total = h * 60 + m + off;
    total = ((total % 1440) + 1440) % 1440;
    return `${total % 60} ${Math.floor(total / 60)} * * *`;
  }
  function buildReminderPlan() {
    const s = state.settings;
    const plan = { dailyCron: null, dailyNotification: null, tasks: [] };
    if (s.dailyReminder) {
      plan.dailyCron = utcCronFromLocal(s.dailyReminder);
      plan.dailyNotification = { title: 'Bom dia! ☀️', body: 'Hora de organizar o seu dia.', tag: 'daily' };
    }
    const now = Date.now();
    // agenda hoje + amanhã (o QStash guarda; dispara mesmo com o app fechado)
    [todayISO(), addDays(todayISO(), 1)].forEach((iso) => {
      allItems(iso).forEach((it) => {
        if (!it.time || it.done) return;
        const [h, m] = it.time.split(':').map(Number);
        const rem = (it.reminder != null ? it.reminder : s.defaultReminder) || 0;
        const d = fromISO(iso); d.setHours(h, m, 0, 0);
        const fireAt = d.getTime() - rem * 60000;
        if (fireAt > now + 15000) {
          plan.tasks.push({
            key: iso + '|' + it.id,
            notBeforeUnix: Math.floor(fireAt / 1000),
            notification: {
              title: it.text,
              body: rem ? `Em ${rem} min (${it.time})` : `Agora (${it.time})`,
              tag: 'task-' + it.id,
              data: { itemId: it.id, date: iso },
              actions: [{ action: 'done', title: 'Concluir' }],
            },
          });
        }
      });
    });
    return plan;
  }
  function syncPush() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (window.PushClient && window.PushClient.supported()) {
      window.PushClient.scheduleSync(buildReminderPlan());
    }
  }
  async function enablePush() {
    if (!(window.PushClient && window.PushClient.supported())) return;
    try { await window.PushClient.syncNow(buildReminderPlan()); }
    catch (e) { console.warn('push indisponível — usando fallback local:', e.message); }
  }

  // ---------- Streak ----------
  function computeStreak() {
    const t = todayISO();
    let count = 0;
    let cursor = t;
    if (isDayComplete(t)) { count = 1; cursor = addDays(t, -1); }
    else { cursor = addDays(t, -1); }
    while (isDayComplete(cursor)) { count++; cursor = addDays(cursor, -1); }
    return count;
  }
  function bestStreak() {
    // varre todos os dias registrados
    const dates = Object.keys(state.days).filter((iso) => isDayComplete(iso)).sort();
    let best = 0, run = 0, prev = null;
    for (const iso of dates) {
      if (prev && daysBetween(prev, iso) === 1) run++;
      else run = 1;
      best = Math.max(best, run);
      prev = iso;
    }
    return best;
  }
  function lastCompleteDate() {
    const dates = Object.keys(state.days).filter((iso) => isDayComplete(iso)).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }
  function streakLenEndingAt(iso) {
    let count = 0, cursor = iso;
    while (isDayComplete(cursor)) { count++; cursor = addDays(cursor, -1); }
    return count;
  }
  function checkBreak() {
    const last = lastCompleteDate();
    if (!last) return;
    // se o último dia completo foi antes de ontem, a sequência quebrou
    if (daysBetween(last, todayISO()) >= 2 && !state.streak.breaksLogged[last]) {
      const len = streakLenEndingAt(last);
      state.streak.breaksLogged[last] = true;
      openBreakModal(last, len);
    }
  }

  // ---------- Render ----------
  function render() {
    renderHeader();
    renderTabs();
    renderGoals();
    renderChecklist();
    renderDayProgress();
    renderSundayBanner();
  }

  function renderHeader() {
    $('#viewDate').textContent = fmtLong(viewDate);
    $('#viewRel').textContent = relLabel(viewDate) || '';
    const streak = computeStreak();
    $('#streakCount').textContent = streak;
    $('#streakGoal').textContent = '/' + state.settings.streakGoal;
  }

  function renderTabs() {
    const tabs = $('#dayTabs');
    tabs.innerHTML = '';
    weekDates(viewDate).forEach((iso) => {
      const d = fromISO(iso);
      const idx = (d.getDay() + 6) % 7; // 0=Seg
      const btn = document.createElement('button');
      btn.className = 'day-tab';
      if (iso === viewDate) btn.classList.add('active');
      if (iso === todayISO()) btn.classList.add('today');
      if (isDayComplete(iso)) btn.classList.add('done');
      btn.innerHTML = `<span class="dt-name">${DOW_TAB[idx]}</span><span class="dt-num">${d.getDate()}</span>`;
      btn.onclick = () => { viewDate = iso; render(); };
      tabs.appendChild(btn);
    });
  }

  function renderGoals() {
    const list = $('#goalList');
    list.innerHTML = '';
    $('#goalsEmpty').classList.toggle('hidden', state.goals.length > 0);
    state.goals.forEach((g) => {
      const p = progressFor(g.id);
      const li = document.createElement('li');
      li.className = 'goal-item';
      const complete = g.type === 'counter' ? p.count >= g.target : p.done;
      if (complete) li.classList.add('complete');

      if (g.type === 'counter') {
        li.innerHTML = `
          <span class="goal-text">${esc(g.text)}</span>
          <div class="counter ${complete ? 'done' : ''}">
            <button data-act="dec">−</button>
            <span class="cval">${p.count}/${g.target}</span>
            <button data-act="inc">+</button>
          </div>
          <button class="row-menu" aria-label="Opções">⋯</button>`;
        li.querySelector('[data-act="dec"]').onclick = () => { p.count = Math.max(0, p.count - 1); save(); renderGoals(); };
        li.querySelector('[data-act="inc"]').onclick = () => { p.count = Math.min(g.target, p.count + 1); save(); renderGoals(); };
      } else {
        li.innerHTML = `
          <button class="goal-check ${p.done ? 'on' : ''}">${p.done ? '✓' : ''}</button>
          <span class="goal-text">${esc(g.text)}</span>
          <button class="row-menu" aria-label="Opções">⋯</button>`;
        li.querySelector('.goal-check').onclick = () => { p.done = !p.done; save(); renderGoals(); };
      }
      li.querySelector('.row-menu').onclick = (e) => openCtxMenu(e, [
        { label: 'Editar', fn: () => openGoalModal(g) },
        { label: 'Apagar', danger: true, fn: () => { deleteGoal(g.id); } },
      ]);
      list.appendChild(li);
    });
  }

  function renderChecklist() {
    const wrap = $('#checklist');
    wrap.innerHTML = '';
    const d = dayData(viewDate);
    PERIODS.forEach((per) => {
      const items = d[per.key];
      const done = items.filter((i) => i.done).length;
      const block = document.createElement('section');
      block.className = 'block';
      block.innerHTML = `
        <div class="block-head">
          <h2>${per.label}</h2>
          <span class="block-count">${done}/${items.length}</span>
        </div>
        <div class="item-list"></div>
        <button class="add-item">+ adicionar em ${per.label.toLowerCase()}</button>`;
      const listEl = block.querySelector('.item-list');
      items.forEach((it) => listEl.appendChild(renderItem(it, per.key)));
      block.querySelector('.add-item').onclick = () => openItemModal(null, per.key);
      wrap.appendChild(block);
    });
  }

  function renderItem(it, periodKey) {
    const el = document.createElement('div');
    el.className = 'item' + (it.done ? ' done' : '');
    const timeHtml = it.time
      ? `<div class="item-time ${isPast(it.time) ? 'past' : ''}">${it.time}${it.reminder ? ' · avisa ' + it.reminder + 'min antes' : ''}</div>`
      : '';
    el.innerHTML = `
      <button class="item-check ${it.done ? 'on' : ''}">${it.done ? '✓' : ''}</button>
      <div class="item-body">
        <div class="item-text">${esc(it.text)}</div>
        ${timeHtml}
      </div>
      <button class="row-menu" aria-label="Opções">⋯</button>`;
    el.querySelector('.item-check').onclick = () => toggleItem(viewDate, periodKey, it.id);
    el.querySelector('.row-menu').onclick = (e) => openCtxMenu(e, [
      { label: 'Editar', fn: () => openItemModal(it, periodKey) },
      { label: 'Apagar', danger: true, fn: () => deleteItem(viewDate, periodKey, it.id) },
    ]);
    return el;
  }

  function renderDayProgress() {
    const s = dayStats(viewDate);
    const bar = $('#dayProgress').querySelector('.day-progress-bar');
    $('#dayProgressFill').style.width = s.pct + '%';
    bar.classList.toggle('full', s.pct === 100 && s.total > 0);
    $('#dayProgressLabel').textContent = s.total ? s.pct + '%' : '—';
  }

  function renderSundayBanner() {
    const isSunday = fromISO(todayISO()).getDay() === 0;
    $('#sundayBanner').classList.toggle('hidden', !(isSunday && currentView === 'hoje'));
  }

  function isPast(hhmm) {
    if (viewDate !== todayISO()) return viewDate < todayISO();
    const now = new Date();
    const [h, m] = hhmm.split(':').map(Number);
    return now.getHours() > h || (now.getHours() === h && now.getMinutes() > m);
  }

  // ---------- CRUD itens ----------
  function toggleItem(iso, period, id) {
    const it = dayData(iso)[period].find((x) => x.id === id);
    if (!it) return;
    it.done = !it.done;
    save();
    render();
    if (isDayComplete(iso)) maybeCelebrate(iso);
  }
  function deleteItem(iso, period, id) {
    const arr = dayData(iso)[period];
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) arr.splice(i, 1);
    save(); render();
  }

  // ---------- CRUD metas ----------
  function deleteGoal(id) {
    state.goals = state.goals.filter((g) => g.id !== id);
    Object.values(state.goalProgress).forEach((wk) => delete wk[id]);
    save(); renderGoals();
  }

  // ---------- Notificações (fase local) ----------
  const timers = [];
  function clearTimers() { timers.forEach(clearTimeout); timers.length = 0; }

  function scheduleNotifications() {
    clearTimers();
    if (window.__pushActive) return; // o push do servidor assumiu os lembretes
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    // lembrete diário
    const [dh, dm] = state.settings.dailyReminder.split(':').map(Number);
    scheduleAt(dh, dm, () => {
      notify('Bom dia! ☀️', { body: 'Hora de organizar o seu dia.', tag: 'daily' });
    });

    // por tarefa (somente as de hoje, com horário, não concluídas)
    const t = todayISO();
    allItems(t).forEach((it) => {
      if (!it.time || it.done) return;
      const [h, m] = it.time.split(':').map(Number);
      const rem = (it.reminder != null ? it.reminder : state.settings.defaultReminder) || 0;
      let target = new Date(); target.setHours(h, m, 0, 0);
      target = new Date(target.getTime() - rem * 60000);
      const delay = target.getTime() - Date.now();
      if (delay > 0 && delay < 26 * 3600000) {
        timers.push(setTimeout(() => {
          notify(it.text, {
            body: rem ? `Em ${rem} min (${it.time})` : `Agora (${it.time})`,
            tag: 'task-' + it.id,
            data: { itemId: it.id, date: t },
            actions: [{ action: 'done', title: 'Concluir' }],
          });
        }, delay));
      }
    });
  }

  function scheduleAt(h, m, fn) {
    const now = new Date();
    let target = new Date(); target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const delay = target.getTime() - now.getTime();
    if (delay < 26 * 3600000) timers.push(setTimeout(fn, delay));
  }

  async function notify(title, opts) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) { reg.showNotification(title, opts); return; }
    } catch (e) { /* fallback abaixo */ }
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, opts);
    }
  }

  function maybeCelebrate(iso) {
    if (iso !== todayISO()) return;
    toast('Dia 100% concluído! 🔥 Sequência: ' + computeStreak());
  }

  // ---------- Views ----------
  function switchView(v) {
    currentView = v;
    ['hoje', 'stats', 'ajustes'].forEach((name) => {
      $('#view-' + name).classList.toggle('hidden', name !== v);
    });
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    if (v === 'stats') renderStats();
    if (v === 'ajustes') renderSettings();
    renderSundayBanner();
  }

  // ---------- Stats ----------
  function renderStats() {
    const week = weekDates(viewDate);
    // esta semana
    let wDone = 0, wTotal = 0;
    week.forEach((iso) => { const s = dayStats(iso); wDone += s.done; wTotal += s.total; });
    const wpct = wTotal ? Math.round((wDone / wTotal) * 100) : 0;
    const completeDays = week.filter(isDayComplete).length;
    $('#weekSummary').innerHTML = `
      <div class="stat-box"><div class="big">${wpct}%</div><div class="lbl">semana</div></div>
      <div class="stat-box"><div class="big">${completeDays}/7</div><div class="lbl">dias 100%</div></div>
      <div class="stat-box"><div class="big">${wDone}</div><div class="lbl">tarefas feitas</div></div>`;

    // barras da semana
    const bars = $('#weekBars');
    bars.innerHTML = '';
    week.forEach((iso) => {
      const s = dayStats(iso);
      const d = fromISO(iso);
      const idx = (d.getDay() + 6) % 7;
      const bar = document.createElement('div');
      bar.className = 'weekbar' + (iso === todayISO() ? ' today' : '');
      bar.innerHTML = `
        <div class="bar-track"><div class="bar-fill ${s.pct === 100 && s.total ? 'full' : ''}" style="height:${s.total ? Math.max(s.pct, 4) : 0}%"></div></div>
        <div class="bar-lbl">${DOW_TAB[idx]}</div>`;
      bars.appendChild(bar);
    });

    renderWeeklySummary(week);
    renderHistory30();
    renderStreakStats();
  }

  function renderWeeklySummary(week) {
    let done = 0, total = 0;
    const pending = [];
    week.forEach((iso) => {
      const s = dayStats(iso);
      done += s.done; total += s.total;
      PERIODS.forEach((per) => {
        (state.days[iso]?.[per.key] || []).forEach((it) => {
          if (!it.done) pending.push(`${DOW[fromISO(iso).getDay()]}: ${it.text}`);
        });
      });
    });
    const goalsDone = state.goals.filter((g) => {
      const p = (state.goalProgress[weekKey(viewDate)] || {})[g.id];
      if (!p) return false;
      return g.type === 'counter' ? p.count >= g.target : p.done;
    }).length;

    let html = `
      <div class="sum-line"><span>Tarefas concluídas</span><span class="sum-val">${done}/${total}</span></div>
      <div class="sum-line"><span>Metas batidas</span><span class="sum-val">${goalsDone}/${state.goals.length}</span></div>
      <div class="sum-line"><span>Dias 100%</span><span class="sum-val">${week.filter(isDayComplete).length}/7</span></div>`;
    if (pending.length) {
      html += `<div class="sum-pending"><h4>Ficou pendente (${pending.length})</h4><ul>${pending.slice(0, 12).map((p) => `<li>• ${esc(p)}</li>`).join('')}${pending.length > 12 ? `<li>… +${pending.length - 12}</li>` : ''}</ul></div>`;
    } else if (total > 0) {
      html += `<div class="sum-pending"><h4>Tudo em dia ✓</h4></div>`;
    }
    $('#summaryContent').innerHTML = html;
  }

  function renderHistory30() {
    const grid = $('#history30');
    grid.innerHTML = '';
    const t = todayISO();
    for (let i = 29; i >= 0; i--) {
      const iso = addDays(t, -i);
      const s = dayStats(iso);
      const cell = document.createElement('div');
      cell.className = 'h-cell';
      if (s.total > 0) cell.classList.add(s.pct === 100 ? 'full' : 'part');
      if (iso === t) cell.classList.add('today');
      cell.title = `${iso} — ${s.total ? s.pct + '%' : 'vazio'}`;
      grid.appendChild(cell);
    }
  }

  function renderStreakStats() {
    $('#streakStats').innerHTML = `
      <div class="stat-box"><div class="big">${computeStreak()}</div><div class="lbl">atual</div></div>
      <div class="stat-box"><div class="big">${bestStreak()}</div><div class="lbl">recorde</div></div>
      <div class="stat-box"><div class="big">${state.settings.streakGoal}</div><div class="lbl">meta</div></div>`;
    const bh = $('#breakHistory');
    const hist = (state.streak.history || []).slice().reverse();
    bh.innerHTML = hist.length
      ? hist.map((h) => `<li><b>${h.len} ${h.len === 1 ? 'dia' : 'dias'}</b> até ${fmtLong(h.date)}${h.reason ? ` — ${esc(h.reason)}` : ''}</li>`).join('')
      : '<li style="border:none;color:var(--muted-2)">Nenhuma quebra registrada.</li>';
  }

  // ---------- Ajustes ----------
  function renderSettings() {
    $('#dailyReminder').value = state.settings.dailyReminder;
    $('#defaultReminder').value = state.settings.defaultReminder;
    $('#streakGoalInput').value = state.settings.streakGoal;
    updateNotifButton();
  }
  function updateNotifButton() {
    const btn = $('#notifToggle');
    const note = $('#notifNote');
    if (!('Notification' in window)) {
      btn.textContent = 'Indisponível'; btn.disabled = true;
      note.textContent = 'Este navegador não suporta notificações.';
      return;
    }
    const p = Notification.permission;
    if (p === 'granted') { btn.textContent = 'Ativadas ✓'; btn.disabled = true; }
    else if (p === 'denied') { btn.textContent = 'Bloqueadas'; btn.disabled = true; note.textContent = 'Você bloqueou. Libere nas configurações do navegador.'; }
    else { btn.textContent = 'Ativar'; btn.disabled = false; }
    if (p === 'granted') {
      note.textContent = 'No iPhone, as notificações só disparam com o app instalado na tela inicial. Enquanto o app está fechado por muito tempo, o iOS pode não entregar — a versão com servidor (push real) virá depois.';
    } else if (p === 'default') {
      note.textContent = 'Ative para receber o lembrete diário e os avisos das tarefas.';
    }
  }

  // ---------- Modais ----------
  let editing = { item: null, period: null, goal: null };

  function openItemModal(item, periodKey) {
    editing.item = item; editing.period = periodKey;
    $('#itemModalTitle').textContent = item ? 'Editar tarefa' : 'Nova tarefa';
    $('#itemText').value = item ? item.text : '';
    $('#itemPeriod').value = periodKey || 'morning';
    $('#itemTime').value = item ? (item.time || '') : '';
    $('#itemReminder').value = item ? (item.reminder != null ? item.reminder : '') : '';
    $('#itemReminder').placeholder = String(state.settings.defaultReminder);

    // duplicar só ao criar
    $('#dupWrap').classList.toggle('hidden', !!item);
    const dup = $('#dupDays'); dup.innerHTML = '';
    if (!item) {
      weekDates(viewDate).forEach((iso) => {
        const d = fromISO(iso);
        const idx = (d.getDay() + 6) % 7;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dup-day' + (iso === viewDate ? ' on self' : '');
        b.textContent = DOW_TAB[idx];
        b.dataset.iso = iso;
        if (iso === viewDate) b.dataset.on = '1';
        b.onclick = () => { b.classList.toggle('on'); b.dataset.on = b.classList.contains('on') ? '1' : ''; };
        dup.appendChild(b);
      });
    }
    show('#itemModal');
    setTimeout(() => $('#itemText').focus(), 50);
  }

  function saveItemFromModal() {
    const text = $('#itemText').value.trim();
    if (!text) { toast('Escreva a tarefa'); return; }
    const period = $('#itemPeriod').value;
    const time = $('#itemTime').value || null;
    const remRaw = $('#itemReminder').value;
    const reminder = remRaw === '' ? null : Math.max(0, parseInt(remRaw, 10) || 0);

    if (editing.item) {
      // mover de período se mudou
      const oldArr = dayData(viewDate)[editing.period];
      const i = oldArr.findIndex((x) => x.id === editing.item.id);
      if (i >= 0) oldArr.splice(i, 1);
      editing.item.text = text; editing.item.time = time; editing.item.reminder = reminder;
      dayData(viewDate)[period].push(editing.item);
    } else {
      const targets = $$('#dupDays .dup-day').filter((b) => b.dataset.on === '1').map((b) => b.dataset.iso);
      const list = targets.length ? targets : [viewDate];
      list.forEach((iso) => {
        dayData(iso)[period].push({ id: uid(), text, time, reminder, done: false });
      });
      if (list.length > 1) toast(`Adicionado em ${list.length} dias`);
    }
    save(); hide('#itemModal'); render(); scheduleNotifications();
  }

  function openGoalModal(goal) {
    editing.goal = goal;
    $('#goalModalTitle').textContent = goal ? 'Editar meta' : 'Nova meta';
    $('#goalText').value = goal ? goal.text : '';
    $('#goalType').value = goal ? goal.type : 'bool';
    $('#goalTarget').value = goal ? (goal.target || 5) : 5;
    $('#goalTargetWrap').classList.toggle('hidden', ($('#goalType').value !== 'counter'));
    show('#goalModal');
    setTimeout(() => $('#goalText').focus(), 50);
  }
  function saveGoalFromModal() {
    const text = $('#goalText').value.trim();
    if (!text) { toast('Escreva a meta'); return; }
    const type = $('#goalType').value;
    const target = type === 'counter' ? Math.max(1, parseInt($('#goalTarget').value, 10) || 1) : null;
    if (editing.goal) {
      editing.goal.text = text; editing.goal.type = type; editing.goal.target = target;
    } else {
      state.goals.push({ id: uid(), text, type, target });
    }
    save(); hide('#goalModal'); renderGoals();
  }

  function openBreakModal(date, len) {
    $('#breakModalText').textContent = `Sua sequência de ${len} ${len === 1 ? 'dia' : 'dias'} foi interrompida. Quer anotar o motivo? (opcional)`;
    $('#breakReason').value = '';
    $('#breakModal').dataset.date = date;
    $('#breakModal').dataset.len = len;
    show('#breakModal');
  }
  function saveBreak(withReason) {
    const m = $('#breakModal');
    state.streak.history.push({
      date: m.dataset.date,
      len: Number(m.dataset.len),
      reason: withReason ? ($('#breakReason').value.trim() || null) : null,
    });
    save(); hide('#breakModal');
  }

  // ---------- Menu de contexto ----------
  let ctxEl = null;
  function openCtxMenu(ev, options) {
    ev.stopPropagation();
    closeCtxMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    options.forEach((o) => {
      const b = document.createElement('button');
      b.textContent = o.label;
      if (o.danger) b.className = 'danger';
      b.onclick = () => { closeCtxMenu(); o.fn(); };
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const r = ev.currentTarget.getBoundingClientRect();
    const mw = 160;
    menu.style.top = Math.min(r.bottom + 4, window.innerHeight - 120) + 'px';
    menu.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';
    ctxEl = menu;
    setTimeout(() => document.addEventListener('click', closeCtxMenu, { once: true }), 0);
  }
  function closeCtxMenu() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }

  // ---------- Utils DOM ----------
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.from(document.querySelectorAll(s)); }
  function show(sel) { $(sel).classList.remove('hidden'); }
  function hide(sel) { $(sel).classList.add('hidden'); }
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function uid() { return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2)); }
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  // ---------- Eventos ----------
  function bindEvents() {
    $$('.nav-btn').forEach((b) => b.onclick = () => switchView(b.dataset.view));
    $('#addGoalBtn').onclick = () => openGoalModal(null);
    $('#streakChip').onclick = () => switchView('stats');
    $('#openSummaryFromBanner').onclick = () => switchView('stats');

    // modais item
    $('#itemCancel').onclick = () => hide('#itemModal');
    $('#itemSave').onclick = saveItemFromModal;
    $('#itemText').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveItemFromModal(); });
    // modal meta
    $('#goalCancel').onclick = () => hide('#goalModal');
    $('#goalSave').onclick = saveGoalFromModal;
    $('#goalType').onchange = () => $('#goalTargetWrap').classList.toggle('hidden', $('#goalType').value !== 'counter');
    $('#goalText').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveGoalFromModal(); });
    // modal break
    $('#breakSkip').onclick = () => saveBreak(false);
    $('#breakSave').onclick = () => saveBreak(true);

    // fechar modal ao clicar no fundo
    $$('.modal-overlay').forEach((ov) => ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.add('hidden'); }));

    // ajustes
    $('#notifToggle').onclick = requestNotif;
    $('#dailyReminder').onchange = (e) => { state.settings.dailyReminder = e.target.value || '08:00'; save(); scheduleNotifications(); };
    $('#defaultReminder').onchange = (e) => { state.settings.defaultReminder = clampInt(e.target.value, 0, 120, 10); e.target.value = state.settings.defaultReminder; save(); };
    $('#streakGoalInput').onchange = (e) => { state.settings.streakGoal = clampInt(e.target.value, 1, 365, 30); e.target.value = state.settings.streakGoal; save(); renderHeader(); };
    $('#resetBtn').onclick = resetAll;

    // rollover: revalida ao voltar pro app
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        const wasDate = viewDate;
        render();
        if (wasDate !== todayISO() && relLabel(wasDate) === '') { /* mantém seleção */ }
        checkBreak();
        syncPush();
        scheduleNotifications();
      }
    });
  }

  function clampInt(v, min, max, dflt) {
    const n = parseInt(v, 10);
    if (isNaN(n)) return dflt;
    return Math.max(min, Math.min(max, n));
  }

  async function requestNotif() {
    if (!('Notification' in window)) return;
    try {
      const p = await Notification.requestPermission();
      updateNotifButton();
      if (p === 'granted') {
        await enablePush();
        scheduleNotifications();
        toast(window.__pushActive ? 'Notificações ativadas (push)' : 'Notificações ativadas');
      }
    } catch (e) { console.error(e); }
  }

  function resetAll() {
    if (!confirm('Apagar TODOS os dados deste aparelho? Isso não tem como desfazer.')) return;
    state = defaultState();
    save();
    viewDate = todayISO();
    render(); switchView('hoje');
    toast('Tudo apagado');
  }

  // ---------- Service worker ----------
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(console.error);
      navigator.serviceWorker.addEventListener('message', (ev) => {
        if (ev.data && ev.data.type === 'item-done') {
          const { date, itemId } = ev.data;
          const d = state.days[date];
          if (d) {
            for (const per of PERIODS) {
              const it = d[per.key].find((x) => x.id === itemId);
              if (it) { it.done = true; break; }
            }
            save(); render();
          }
        }
      });
    }
  }

  // ---------- Boot ----------
  async function init() {
    try {
      state = await DB.getState();
    } catch (e) { console.error(e); }
    if (!state) { state = defaultState(); await DB.setState(state).catch(() => {}); }
    // migração leve
    state.settings = Object.assign(defaultState().settings, state.settings || {});
    state.streak = Object.assign({ history: [], breaksLogged: {} }, state.streak || {});

    bindEvents();
    registerSW();
    render();
    switchView('hoje');
    checkBreak();
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') { await enablePush(); }
    scheduleNotifications();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
