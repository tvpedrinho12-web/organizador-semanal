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
      version: 2,
      goals: [],                 // { id, text, type:'bool'|'counter', target }
      goalProgress: {},          // { [weekKey]: { [goalId]: { done, count } } }
      days: {},                  // { [iso]: { morning:[item], afternoon:[item], night:[item], seeded:[routineId] } }
      routines: [],              // { id, text, period, time, reminder, days:[0..6 getDay] }
      streak: { history: [], breaksLogged: {} }, // history:[{date,len,reason}]
      settings: { dailyReminder: '08:00', defaultReminder: 10, streakGoal: 30, eveningNudge: '20:30' },
    };
  }

  // dismissais de banner só desta sessão (não persistem)
  const dismissed = { carry: {}, sunday: false };

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
    if (!state.days[iso]) state.days[iso] = { morning: [], afternoon: [], night: [], seeded: [] };
    if (!Array.isArray(state.days[iso].seeded)) state.days[iso].seeded = [];
    return state.days[iso];
  }

  // ---------- Rotinas (tarefas recorrentes) ----------
  // Materializa as rotinas de um dia (só hoje em diante). Respeita exclusões: se o usuário
  // apagou a instância daquele dia, o routineId fica em `seeded` e não é recriado.
  function materializeRoutines(iso) {
    if (!state.routines.length) return false;
    if (iso < todayISO()) return false; // não reescreve o passado
    const wd = fromISO(iso).getDay();
    const d = dayData(iso);
    let changed = false;
    state.routines.forEach((r) => {
      if (!r.days || !r.days.includes(wd)) return;
      if (d.seeded.includes(r.id)) return;
      const per = PERIODS.some((p) => p.key === r.period) ? r.period : 'morning';
      d[per].push({ id: uid(), routineId: r.id, text: r.text, time: r.time || null, reminder: (r.reminder != null ? r.reminder : null), done: false });
      d.seeded.push(r.id);
      changed = true;
    });
    return changed;
  }
  // Remove instâncias futuras (hoje em diante) ainda não concluídas de uma rotina,
  // e limpa a marca `seeded` — usado ao editar/apagar rotina para re-semear com o novo conteúdo.
  function clearFutureRoutine(routineId, alsoUnseed) {
    const t = todayISO();
    Object.keys(state.days).forEach((iso) => {
      if (iso < t) return;
      const d = state.days[iso];
      PERIODS.forEach((p) => {
        d[p.key] = (d[p.key] || []).filter((it) => !(it.routineId === routineId && !it.done));
      });
      if (alsoUnseed && Array.isArray(d.seeded)) d.seeded = d.seeded.filter((id) => id !== routineId);
    });
  }
  function seedHorizon() {
    // hoje + próximos 3 dias (garante que os lembretes de push tenham o que agendar)
    let changed = false;
    for (let i = 0; i <= 3; i++) { if (materializeRoutines(addDays(todayISO(), i))) changed = true; }
    return changed;
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
  function pickPhrase(cat, fallback) {
    return (window.Phrases && Phrases.pick(cat)) || fallback;
  }

  function buildReminderPlan() {
    const s = state.settings;
    seedHorizon(); // garante rotinas materializadas nos dias que vamos agendar
    const plan = { dailyCron: null, dailyNotification: null, tasks: [] };
    if (s.dailyReminder) {
      plan.dailyCron = utcCronFromLocal(s.dailyReminder);
      plan.dailyNotification = { title: 'Hora de organizar', body: pickPhrase('dailyReminder', 'Define suas prioridades antes que o dia te defina.'), tag: 'daily' };
    }
    const now = Date.now();
    // agenda hoje + próximos 3 dias (o QStash guarda; dispara mesmo com o app fechado)
    for (let i = 0; i <= 3; i++) {
      const iso = addDays(todayISO(), i);
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
              body: `${it.time} · ${pickPhrase('taskReminder', 'Está no horário. Levanta e faz.')}`,
              tag: 'task-' + it.id,
              data: { itemId: it.id, date: iso },
              actions: [{ action: 'done', title: 'Concluir' }],
            },
          });
        }
      });
    }

    // Nudge de "streak em risco": se HOJE tem tarefas e ainda há pendência, avisa à noite.
    const nudgeAt = s.eveningNudge || '20:30';
    const t = todayISO();
    const st = dayStatus(t);
    if (st === 'incomplete' && nudgeAt) {
      const [nh, nm] = nudgeAt.split(':').map(Number);
      const d = fromISO(t); d.setHours(nh, nm, 0, 0);
      const fireAt = d.getTime();
      if (fireAt > now + 15000) {
        plan.tasks.push({
          key: t + '|__nudge',
          notBeforeUnix: Math.floor(fireAt / 1000),
          notification: {
            title: 'Sequência em risco',
            body: pickPhrase('streakRisk', 'O dia está acabando e a lista não. Fecha o que falta.'),
            tag: 'nudge',
            data: {},
          },
        });
      }
    }
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
  // Dias sem NENHUMA tarefa são "descanso": não contam nem quebram a sequência (freeze).
  // Só um dia com tarefas e alguma pendente ('incomplete') quebra o streak.
  function dayStatus(iso) {
    const s = dayStats(iso);
    if (s.total === 0) return 'empty';
    return s.done === s.total ? 'complete' : 'incomplete';
  }
  function earliestDay() {
    const keys = Object.keys(state.days);
    if (!keys.length) return todayISO();
    return keys.sort()[0];
  }
  // conta dias 'complete' terminando em `iso`, pulando dias vazios, parando no primeiro 'incomplete'
  function streakLenEndingAt(iso) {
    const floor = earliestDay();
    let count = 0, cursor = iso;
    while (cursor >= floor) {
      const st = dayStatus(cursor);
      if (st === 'complete') count++;
      else if (st === 'incomplete') break;
      // 'empty' => pula (freeze)
      cursor = addDays(cursor, -1);
    }
    return count;
  }
  function computeStreak() {
    const t = todayISO();
    // hoje ainda pode ser fechado: se não está completo, olha a partir de ontem
    let start = dayStatus(t) === 'complete' ? t : addDays(t, -1);
    return streakLenEndingAt(start);
  }
  function bestStreak() {
    const floor = earliestDay();
    let best = 0, run = 0, cursor = todayISO();
    while (cursor >= floor) {
      const st = dayStatus(cursor);
      if (st === 'complete') { run++; best = Math.max(best, run); }
      else if (st === 'incomplete') { run = 0; }
      // 'empty' => mantém run (freeze)
      cursor = addDays(cursor, -1);
    }
    return best;
  }
  // Detecta a quebra mais recente: um dia 'incomplete' (teve tarefas, sobrou pendência)
  // que encerrou uma sequência de dias completos. Ignora dias vazios.
  function detectBreak() {
    const floor = earliestDay();
    let cursor = addDays(todayISO(), -1); // não cobra o dia de hoje (ainda em aberto)
    while (cursor >= floor) {
      const st = dayStatus(cursor);
      if (st === 'incomplete') {
        const len = streakLenEndingAt(addDays(cursor, -1)); // sequência que existia antes da falha
        if (len > 0) return { date: cursor, len };
        return null; // falhou mas não havia sequência a perder
      }
      cursor = addDays(cursor, -1);
    }
    return null;
  }
  function checkBreak() {
    const info = detectBreak();
    if (!info) return;
    if (state.streak.breaksLogged[info.date]) return;
    // registra a quebra IMEDIATAMENTE (não depende do modal) — corrige perda de histórico
    state.streak.breaksLogged[info.date] = true;
    state.streak.history.push({ date: info.date, len: info.len, reason: null });
    save();
    openBreakModal(info.date, info.len); // modal só adiciona o motivo, se o usuário quiser
  }

  // ---------- Render ----------
  function render() {
    if (materializeRoutines(viewDate)) save(); // preenche rotinas do dia visto (hoje em diante)
    renderHeader();
    renderTabs();
    renderGoals();
    renderChecklist();
    renderDayProgress();
    renderSundayBanner();
    renderCarryBanner();
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
        <div class="quick-row">
          <input class="quick-add" type="text" placeholder="+ tarefa rápida" autocomplete="off" aria-label="Adicionar tarefa rápida em ${per.label.toLowerCase()}" />
          <button class="add-item-detail" type="button" aria-label="Adicionar com detalhes">⋯</button>
        </div>`;
      const listEl = block.querySelector('.item-list');
      items.forEach((it) => listEl.appendChild(renderItem(it, per.key)));
      const quick = block.querySelector('.quick-add');
      quick.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const text = quick.value.trim();
        if (!text) return;
        dayData(viewDate)[per.key].push({ id: uid(), text, time: null, reminder: null, done: false });
        quick.value = '';
        save(); render(); scheduleNotifications();
        // re-foca no mesmo campo pra adicionar várias em sequência
        setTimeout(() => { const q = $$('.block')[PERIODS.indexOf(per)]?.querySelector('.quick-add'); if (q) q.focus(); }, 0);
      });
      block.querySelector('.add-item-detail').onclick = () => openItemModal(null, per.key);
      wrap.appendChild(block);
    });
  }

  function renderItem(it, periodKey) {
    const el = document.createElement('div');
    el.className = 'item' + (it.done ? ' done' : '');
    const timeHtml = it.time
      ? `<div class="item-time ${isPast(it.time) ? 'past' : ''}">${it.time}${it.reminder ? ' · avisa ' + it.reminder + 'min antes' : ''}</div>`
      : '';
    const routineTag = it.routineId ? '<span class="routine-tag" title="Rotina fixa">rotina</span>' : '';
    el.innerHTML = `
      <button class="item-check ${it.done ? 'on' : ''}">${it.done ? '✓' : ''}</button>
      <div class="item-body">
        <div class="item-text">${esc(it.text)}${routineTag}</div>
        ${timeHtml}
      </div>
      <button class="row-menu" aria-label="Opções">⋯</button>`;
    el.querySelector('.item-check').onclick = () => toggleItem(viewDate, periodKey, it.id);
    el.querySelector('.row-menu').onclick = (e) => openCtxMenu(e, [
      { label: 'Editar', fn: () => openItemModal(it, periodKey) },
      { label: 'Duplicar', fn: () => duplicateItem(it, periodKey) },
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

  let sundayPhrase = null;
  function renderSundayBanner() {
    const isSunday = fromISO(todayISO()).getDay() === 0;
    const showIt = isSunday && currentView === 'hoje';
    $('#sundayBanner').classList.toggle('hidden', !showIt);
    if (showIt) {
      if (!sundayPhrase) sundayPhrase = pickPhrase('weeklySummary', 'Semana encerrada. Olha os números e ajusta.');
      $('#sundayBannerText').textContent = sundayPhrase;
    }
  }

  // pendências (não concluídas) de um dia, com período
  function pendingFrom(iso) {
    const d = state.days[iso];
    if (!d) return [];
    const out = [];
    PERIODS.forEach((per) => (d[per.key] || []).forEach((it) => { if (!it.done) out.push({ it, period: per.key }); }));
    return out;
  }
  function renderCarryBanner() {
    const banner = $('#carryBanner');
    const t = todayISO();
    const y = addDays(t, -1);
    const pend = pendingFrom(y);
    const showIt = currentView === 'hoje' && viewDate === t && pend.length > 0 && !dismissed.carry[y];
    banner.classList.toggle('hidden', !showIt);
    if (showIt) {
      $('#carryText').textContent = `Você deixou ${pend.length} ${pend.length === 1 ? 'tarefa' : 'tarefas'} pra trás ontem. Traga pra hoje e resolva.`;
    }
  }
  function carryMove() {
    const t = todayISO();
    const y = addDays(t, -1);
    const pend = pendingFrom(y);
    if (!pend.length) return;
    pend.forEach(({ it, period }) => {
      dayData(t)[period].push({ id: uid(), text: it.text, time: it.time || null, reminder: (it.reminder != null ? it.reminder : null), done: false });
    });
    dismissed.carry[y] = true;
    save(); render(); scheduleNotifications();
    toast(`${pend.length} ${pend.length === 1 ? 'pendência trazida' : 'pendências trazidas'}`);
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
  function duplicateItem(it, period) {
    // cópia solta (não herda vínculo de rotina), logo abaixo, não concluída
    dayData(viewDate)[period].push({ id: uid(), text: it.text, time: it.time || null, reminder: (it.reminder != null ? it.reminder : null), done: false });
    save(); render(); scheduleNotifications();
    toast('Tarefa duplicada');
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
      notify('Hora de organizar', { body: pickPhrase('dailyReminder', 'Define suas prioridades antes que o dia te defina.'), tag: 'daily' });
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
            body: `${it.time} · ${pickPhrase('taskReminder', 'Está no horário. Levanta e faz.')}`,
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

  const MILESTONES = [7, 14, 21, 30, 50, 75, 100, 150, 200, 365];
  function maybeCelebrate(iso) {
    if (iso !== todayISO()) return;
    const streak = computeStreak();
    // marco: meta batida ou número redondo de sequência
    if (streak > 0 && streak === state.settings.streakGoal) {
      toast('Meta de ' + streak + ' dias batida. Agora sustenta.');
    } else if (MILESTONES.includes(streak)) {
      toast(streak + ' dias seguidos. ' + pickPhrase('dayComplete', 'É assim que se constrói.'));
    } else {
      toast(pickPhrase('dayComplete', 'Dia fechado. É assim que se constrói.') + ' (' + streak + ')');
    }
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

  // ---------- Ferramentas de semana ----------
  // Copia a estrutura de tarefas (sem 'done', sem duplicar rotinas) da semana de srcMon p/ destMon.
  function copyWeek(srcMon, destMon, skipPast) {
    const t = todayISO();
    let copied = 0;
    for (let i = 0; i < 7; i++) {
      const srcIso = addDays(srcMon, i);
      const destIso = addDays(destMon, i);
      if (skipPast && destIso < t) continue;
      const src = state.days[srcIso];
      if (!src) continue;
      PERIODS.forEach((per) => {
        (src[per.key] || []).forEach((it) => {
          if (it.routineId) return; // rotinas se materializam sozinhas — não duplica
          dayData(destIso)[per.key].push({ id: uid(), text: it.text, time: it.time || null, reminder: (it.reminder != null ? it.reminder : null), done: false });
          copied++;
        });
      });
    }
    if (copied) { save(); render(); scheduleNotifications(); }
    return copied;
  }
  function copyPrevWeekIntoCurrent() {
    const cur = mondayOf(todayISO());
    const n = copyWeek(addDays(cur, -7), cur, true);
    $('#weekToolsResult').textContent = n ? `${n} ${n === 1 ? 'tarefa trazida' : 'tarefas trazidas'} da semana passada.` : 'Nada pra trazer (semana passada vazia ou só rotinas).';
  }
  function copyCurrentIntoNext() {
    const cur = mondayOf(todayISO());
    const n = copyWeek(cur, addDays(cur, 7), false);
    $('#weekToolsResult').textContent = n ? `${n} ${n === 1 ? 'tarefa copiada' : 'tarefas copiadas'} para a próxima semana.` : 'Nada pra copiar (semana atual sem tarefas manuais).';
  }

  // ---------- Ajustes ----------
  function renderSettings() {
    $('#dailyReminder').value = state.settings.dailyReminder;
    $('#defaultReminder').value = state.settings.defaultReminder;
    $('#streakGoalInput').value = state.settings.streakGoal;
    renderRoutines();
    updateNotifButton();
    refreshDiag();
  }

  async function refreshDiag() {
    const el = $('#pushDiag');
    if (!el) return;
    if (!(window.PushClient && window.PushClient.supported())) { el.textContent = 'Push não suportado neste navegador.'; return; }
    el.textContent = 'carregando…';
    try {
      const i = await window.PushClient.info();
      el.textContent =
        `origem:        ${i.origin}\n` +
        `apiBase:       ${i.apiBase}\n` +
        `backend ok:    ${i.backendReachable ? 'sim' : 'NÃO (app sem push aqui)'}\n` +
        `permissão:     ${i.permission}\n` +
        `inscrição:     ${i.hasSubscription ? 'sim' : 'NÃO'}${i.endpointHost ? ' (' + i.endpointHost + ')' : ''}\n` +
        `agend. diário: ${i.dailyScheduleId ? 'sim' : 'não'}\n` +
        `tarefas agend: ${i.taskMessages}`;
    } catch (e) { el.textContent = 'erro: ' + e.message; }
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
  let editing = { item: null, period: null, goal: null, routine: null };

  function openItemModal(item, periodKey) {
    editing.item = item; editing.period = periodKey;
    $('#itemModalTitle').textContent = item ? 'Editar tarefa' : 'Nova tarefa';
    $('#itemText').value = item ? item.text : '';
    $('#itemPeriod').value = periodKey || 'morning';
    $('#itemTime').value = item ? (item.time || '') : '';
    $('#itemReminder').value = item ? (item.reminder != null ? item.reminder : '') : '';
    $('#itemReminder').placeholder = String(state.settings.defaultReminder);

    // duplicar / repetir só ao criar
    $('#dupWrap').classList.toggle('hidden', !!item);
    $('#repeatWrap').classList.toggle('hidden', !!item);
    $('#itemRepeat').checked = false;
    $('#dupLabel').textContent = 'Duplicar para outros dias';
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
    } else if ($('#itemRepeat').checked) {
      // vira rotina fixa: dias marcados => dias da semana (getDay)
      const isos = $$('#dupDays .dup-day').filter((b) => b.dataset.on === '1').map((b) => b.dataset.iso);
      const days = Array.from(new Set((isos.length ? isos : [viewDate]).map((iso) => fromISO(iso).getDay()))).sort();
      state.routines.push({ id: uid(), text, period, time, reminder, days });
      seedHorizon();
      toast('Rotina criada');
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

  // ---------- Rotinas: modal + lista ----------
  function buildRoutineDayPicker(selected) {
    const wrap = $('#routineDays'); wrap.innerHTML = '';
    const sel = new Set(selected || []);
    DOW_TAB.forEach((label, i) => {
      const dow = (i + 1) % 7; // 0=Seg(getDay1) ... 6=Dom(getDay0)
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dup-day' + (sel.has(dow) ? ' on' : '');
      b.textContent = label;
      b.dataset.dow = dow;
      b.onclick = () => b.classList.toggle('on');
      wrap.appendChild(b);
    });
  }
  function openRoutineModal(routine) {
    editing.routine = routine || null;
    $('#routineModalTitle').textContent = routine ? 'Editar rotina' : 'Nova rotina';
    $('#routineText').value = routine ? routine.text : '';
    $('#routinePeriod').value = routine ? routine.period : 'morning';
    $('#routineTime').value = routine ? (routine.time || '') : '';
    $('#routineReminder').value = routine ? (routine.reminder != null ? routine.reminder : '') : '';
    $('#routineReminder').placeholder = String(state.settings.defaultReminder);
    buildRoutineDayPicker(routine ? routine.days : [fromISO(viewDate).getDay()]);
    show('#routineModal');
    setTimeout(() => $('#routineText').focus(), 50);
  }
  function saveRoutineFromModal() {
    const text = $('#routineText').value.trim();
    if (!text) { toast('Escreva a tarefa'); return; }
    const period = $('#routinePeriod').value;
    const time = $('#routineTime').value || null;
    const remRaw = $('#routineReminder').value;
    const reminder = remRaw === '' ? null : Math.max(0, parseInt(remRaw, 10) || 0);
    const days = $$('#routineDays .dup-day').filter((b) => b.classList.contains('on')).map((b) => Number(b.dataset.dow)).sort();
    if (!days.length) { toast('Escolha ao menos um dia'); return; }
    if (editing.routine) {
      const r = editing.routine;
      clearFutureRoutine(r.id, true); // remove instâncias futuras não concluídas p/ re-semear com o novo conteúdo
      r.text = text; r.period = period; r.time = time; r.reminder = reminder; r.days = days;
    } else {
      state.routines.push({ id: uid(), text, period, time, reminder, days });
    }
    seedHorizon();
    save(); hide('#routineModal'); render(); renderRoutines(); scheduleNotifications();
    toast(editing.routine ? 'Rotina atualizada' : 'Rotina criada');
  }
  function deleteRoutine(id) {
    clearFutureRoutine(id, true);
    state.routines = state.routines.filter((r) => r.id !== id);
    save(); render(); renderRoutines(); scheduleNotifications();
  }
  function renderRoutines() {
    const list = $('#routineList');
    if (!list) return;
    list.innerHTML = '';
    $('#routinesEmpty').classList.toggle('hidden', state.routines.length > 0);
    const perLabel = (k) => (PERIODS.find((p) => p.key === k) || {}).label || '';
    state.routines.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'routine-item';
      const daysTxt = r.days.slice().sort().map((dow) => DOW[dow]).join(' ');
      const meta = [perLabel(r.period), r.time ? r.time : null, daysTxt].filter(Boolean).join(' · ');
      li.innerHTML = `
        <div class="routine-body">
          <div class="routine-text">${esc(r.text)}</div>
          <div class="routine-meta">${esc(meta)}</div>
        </div>
        <button class="row-menu" aria-label="Opções">⋯</button>`;
      li.querySelector('.row-menu').onclick = (e) => openCtxMenu(e, [
        { label: 'Editar', fn: () => openRoutineModal(r) },
        { label: 'Apagar', danger: true, fn: () => deleteRoutine(r.id) },
      ]);
      list.appendChild(li);
    });
  }

  function openBreakModal(date, len) {
    const phrase = (window.Phrases && Phrases.pick('streakBreak')) || 'A sequência caiu. Recomeça hoje.';
    $('#breakModalText').innerHTML = `<strong>${esc(phrase)}</strong><br><span style="color:var(--muted-2)">Sequência perdida: ${len} ${len === 1 ? 'dia' : 'dias'}. Anota o motivo? (opcional)</span>`;
    $('#breakReason').value = '';
    $('#breakModal').dataset.date = date;
    $('#breakModal').dataset.len = len;
    show('#breakModal');
  }
  function saveBreak(withReason) {
    const m = $('#breakModal');
    const date = m.dataset.date;
    // a entrada já foi criada em checkBreak; aqui só completamos o motivo
    const entry = (state.streak.history || []).slice().reverse().find((h) => h.date === date);
    if (entry) { entry.reason = withReason ? ($('#breakReason').value.trim() || null) : null; }
    else { state.streak.history.push({ date, len: Number(m.dataset.len), reason: withReason ? ($('#breakReason').value.trim() || null) : null }); }
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
    // checkbox "repetir toda semana" (modal item)
    $('#itemRepeat').onchange = () => { $('#dupLabel').textContent = $('#itemRepeat').checked ? 'Repetir nesses dias da semana' : 'Duplicar para outros dias'; };
    // modal rotina
    $('#addRoutineBtn').onclick = () => openRoutineModal(null);
    $('#routineCancel').onclick = () => hide('#routineModal');
    $('#routineSave').onclick = saveRoutineFromModal;
    $('#routineText').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveRoutineFromModal(); });
    // banners
    $('#carryMove').onclick = carryMove;
    $('#carryDismiss').onclick = () => { dismissed.carry[addDays(todayISO(), -1)] = true; renderCarryBanner(); };
    // ferramentas de semana
    $('#copyPrevWeek').onclick = copyPrevWeekIntoCurrent;
    $('#copyNextWeek').onclick = copyCurrentIntoNext;
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

    // diagnóstico push
    $('#diagRefresh').onclick = refreshDiag;
    $('#diagResync').onclick = async () => {
      $('#diagResult').textContent = 'reagendando…';
      try {
        if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
          const p = await Notification.requestPermission();
          if (p !== 'granted') { $('#diagResult').textContent = 'Permissão não concedida.'; return; }
        }
        const data = await window.PushClient.syncNow(buildReminderPlan());
        $('#diagResult').textContent = 'Reagendado: ' + JSON.stringify(data);
      } catch (e) { $('#diagResult').textContent = 'Falhou: ' + e.message; }
      refreshDiag();
    };
    $('#diagTest').onclick = async () => {
      $('#diagResult').textContent = 'enviando teste…';
      try {
        if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
          const p = await Notification.requestPermission();
          if (p !== 'granted') { $('#diagResult').textContent = 'Permissão não concedida.'; return; }
        }
        const r = await window.PushClient.testPush();
        $('#diagResult').textContent = 'Resposta do /api/schedule (teste): ' + JSON.stringify(r);
      } catch (e) { $('#diagResult').textContent = 'Falhou: ' + e.message; }
      refreshDiag();
    };

    // rollover: revalida ao voltar pro app
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        if (swReg) swReg.update().catch(() => {}); // força checar SW novo ao reabrir (iOS)
        seedHorizon();
        render();
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
  let swReg = null;
  function registerSW() {
    if ('serviceWorker' in navigator) {
      // updateViaCache:'none' => o browser sempre revalida o sw.js na rede (evita SW preso em cache no iOS)
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
        .then((reg) => { swReg = reg; reg.update().catch(() => {}); })
        .catch(console.error);
      navigator.serviceWorker.addEventListener('message', (ev) => {
        if (ev.data && ev.data.type === 'reload') {
          if (!window.__reloadedBySW) { window.__reloadedBySW = true; location.reload(); }
          return;
        }
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
    if (!Array.isArray(state.routines)) state.routines = [];
    state.version = 2;

    bindEvents();
    registerSW();
    seedHorizon();
    render();
    switchView('hoje');
    checkBreak();
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') { await enablePush(); }
    scheduleNotifications();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
