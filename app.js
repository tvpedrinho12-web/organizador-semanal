/* app.js — Organizador Semanal (redesign IA, 100% local) */
(function () {
  'use strict';

  // ---------- Constantes ----------
  const PERIODS = [
    { key: 'morning', label: 'Manhã' },
    { key: 'afternoon', label: 'Tarde' },
    { key: 'night', label: 'Noite' },
  ];
  const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];      // getDay()
  const DOW_TAB = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];  // ordem de exibição
  const DOW_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const CHECK_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M5 13l4 4L19 7" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ---------- Estado ----------
  let state = null;
  let viewDate = todayISO();     // dia mostrado na tela Hoje
  let currentView = 'hoje';
  let saveTimer = null;

  function defaultState() {
    return {
      version: 3,
      goals: [],
      goalProgress: {},
      days: {},
      routines: [],
      streak: { history: [], breaksLogged: {} },
      settings: { dailyReminder: '08:00', defaultReminder: 10, streakGoal: 30, eveningNudge: '20:30' },
      aiUsage: { month: monthKey(), count: 0 },
      ui: { suggestDismissed: {}, reviewedDate: null, routineMineDismissed: {} },
    };
  }

  const dismissed = { carry: {}, sunday: false }; // dismissais só desta sessão

  // ---------- Helpers de data ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function fromISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
  function todayISO() { return toISO(new Date()); }
  function monthKey() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
  function addDays(iso, n) { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  function mondayOf(iso) {
    const d = fromISO(iso);
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    return toISO(d);
  }
  function weekDates(iso) { const mon = mondayOf(iso); return Array.from({ length: 7 }, (_, i) => addDays(mon, i)); }
  function weekKey(iso) { return mondayOf(iso); }
  function daysBetween(a, b) { return Math.round((fromISO(b) - fromISO(a)) / 86400000); }
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MONTHS_FULL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const DOW_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  function fmtHeader(iso) { const d = fromISO(iso); return `${DOW_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS_FULL[d.getMonth()]}`; }
  function fmtLong(iso) { const d = fromISO(iso); return `${DOW[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; }
  function relLabel(iso) {
    const diff = daysBetween(todayISO(), iso);
    if (diff === 0) return 'Hoje';
    if (diff === -1) return 'Ontem';
    if (diff === 1) return 'Amanhã';
    return '';
  }
  function nowMinutes() { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
  function timeToMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

  // ---------- Acesso a dados ----------
  function dayData(iso) {
    if (!state.days[iso]) state.days[iso] = { morning: [], afternoon: [], night: [], seeded: [] };
    if (!Array.isArray(state.days[iso].seeded)) state.days[iso].seeded = [];
    return state.days[iso];
  }

  // ---------- Rotinas ----------
  function materializeRoutines(iso) {
    if (!state.routines.length) return false;
    if (iso < todayISO()) return false;
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
  function clearFutureRoutine(routineId, alsoUnseed) {
    const t = todayISO();
    Object.keys(state.days).forEach((iso) => {
      if (iso < t) return;
      const d = state.days[iso];
      PERIODS.forEach((p) => { d[p.key] = (d[p.key] || []).filter((it) => !(it.routineId === routineId && !it.done)); });
      if (alsoUnseed && Array.isArray(d.seeded)) d.seeded = d.seeded.filter((id) => id !== routineId);
    });
  }
  function seedHorizon() {
    let changed = false;
    for (let i = 0; i <= 3; i++) { if (materializeRoutines(addDays(todayISO(), i))) changed = true; }
    return changed;
  }
  function allItems(iso) {
    const d = state.days[iso];
    if (!d) return [];
    return [...d.morning, ...d.afternoon, ...d.night];
  }
  // itens com o período embutido (pra render/edição)
  function itemsWithPeriod(iso) {
    const d = state.days[iso];
    if (!d) return [];
    const out = [];
    PERIODS.forEach((p) => (d[p.key] || []).forEach((it) => out.push({ it, period: p.key })));
    return out;
  }
  function dayStats(iso) {
    const items = allItems(iso);
    const total = items.length;
    const done = items.filter((i) => i.done).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }
  function isDayComplete(iso) { const s = dayStats(iso); return s.total > 0 && s.done === s.total; }
  function progressFor(gid) {
    const wk = weekKey(viewDate);
    if (!state.goalProgress[wk]) state.goalProgress[wk] = {};
    if (!state.goalProgress[wk][gid]) state.goalProgress[wk][gid] = { done: false, count: 0 };
    return state.goalProgress[wk][gid];
  }
  function findItem(iso, id) {
    const d = state.days[iso];
    if (!d) return null;
    for (const p of PERIODS) { const it = (d[p.key] || []).find((x) => x.id === id); if (it) return { it, period: p.key }; }
    return null;
  }
  function removeItemById(iso, id) {
    const d = state.days[iso];
    if (!d) return false;
    for (const p of PERIODS) {
      const i = (d[p.key] || []).findIndex((x) => x.id === id);
      if (i >= 0) { d[p.key].splice(i, 1); return true; }
    }
    return false;
  }

  // ---------- Persistência ----------
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { DB.setState(state).catch(console.error); }, 120);
    syncPush();
  }

  // ---------- Contador de uso da IA ----------
  function bumpAiUsage() {
    const m = monthKey();
    if (!state.aiUsage || state.aiUsage.month !== m) state.aiUsage = { month: m, count: 0 };
    state.aiUsage.count++;
    save();
  }
  function aiUsageCount() {
    const m = monthKey();
    if (!state.aiUsage || state.aiUsage.month !== m) return 0;
    return state.aiUsage.count;
  }

  // ---------- Integração com o backend de push ----------
  function utcCronFromLocal(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const off = new Date().getTimezoneOffset();
    let total = h * 60 + m + off;
    total = ((total % 1440) + 1440) % 1440;
    return `${total % 60} ${Math.floor(total / 60)} * * *`;
  }
  function pickPhrase(cat, fallback) { return (window.Phrases && Phrases.pick(cat)) || fallback; }

  function buildReminderPlan() {
    const s = state.settings;
    seedHorizon();
    const plan = { dailyCron: null, dailyNotification: null, tasks: [] };
    const streak = computeStreak();
    if (s.dailyReminder) {
      plan.dailyCron = utcCronFromLocal(s.dailyReminder);
      plan.dailyNotification = {
        title: 'Hora de organizar',
        body: pickPhrase('dailyReminder', 'Define suas prioridades antes que o dia te defina.'),
        tag: 'daily',
        gen: { type: 'dailyReminder', streak },
      };
    }
    const now = Date.now();
    for (let i = 0; i <= 3; i++) {
      const iso = addDays(todayISO(), i);
      const st = dayStats(iso);
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
              gen: { type: 'taskReminder', task: it.text, time: it.time, streak, doneToday: st.done, totalToday: st.total },
            },
          });
        }
      });
    }

    const nudgeAt = s.eveningNudge || '20:30';
    const t = todayISO();
    const st = dayStatus(t);
    if (st === 'incomplete' && nudgeAt) {
      const [nh, nm] = nudgeAt.split(':').map(Number);
      const d = fromISO(t); d.setHours(nh, nm, 0, 0);
      const fireAt = d.getTime();
      if (fireAt > now + 15000) {
        const ds = dayStats(t);
        plan.tasks.push({
          key: t + '|__nudge',
          notBeforeUnix: Math.floor(fireAt / 1000),
          notification: {
            title: 'Sequência em risco',
            body: pickPhrase('streakRisk', 'O dia está acabando e a lista não. Fecha o que falta.'),
            tag: 'nudge', data: {},
            gen: { type: 'streakRisk', streak, doneToday: ds.done, totalToday: ds.total, remaining: ds.total - ds.done },
          },
        });
      }
    }
    return plan;
  }
  function syncPush() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (window.PushClient && window.PushClient.supported()) window.PushClient.scheduleSync(buildReminderPlan());
  }
  async function enablePush() {
    if (!(window.PushClient && window.PushClient.supported())) return;
    try { await window.PushClient.syncNow(buildReminderPlan()); }
    catch (e) { console.warn('push indisponível — usando fallback local:', e.message); }
  }

  // ---------- Streak ----------
  function dayStatus(iso) { const s = dayStats(iso); if (s.total === 0) return 'empty'; return s.done === s.total ? 'complete' : 'incomplete'; }
  function earliestDay() { const keys = Object.keys(state.days); if (!keys.length) return todayISO(); return keys.sort()[0]; }
  function streakLenEndingAt(iso) {
    const floor = earliestDay();
    let count = 0, cursor = iso;
    while (cursor >= floor) {
      const st = dayStatus(cursor);
      if (st === 'complete') count++;
      else if (st === 'incomplete') break;
      cursor = addDays(cursor, -1);
    }
    return count;
  }
  function computeStreak() {
    const t = todayISO();
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
      cursor = addDays(cursor, -1);
    }
    return best;
  }
  function completeDaysThisMonth() {
    const now = new Date();
    const y = now.getFullYear(), mo = now.getMonth();
    const days = new Date(y, mo + 1, 0).getDate();
    let n = 0;
    for (let d = 1; d <= days; d++) { const iso = toISO(new Date(y, mo, d)); if (isDayComplete(iso)) n++; }
    return n;
  }
  function detectBreak() {
    const floor = earliestDay();
    let cursor = addDays(todayISO(), -1);
    while (cursor >= floor) {
      const st = dayStatus(cursor);
      if (st === 'incomplete') {
        const len = streakLenEndingAt(addDays(cursor, -1));
        if (len > 0) return { date: cursor, len };
        return null;
      }
      cursor = addDays(cursor, -1);
    }
    return null;
  }
  function checkBreak() {
    const info = detectBreak();
    if (!info) return;
    if (state.streak.breaksLogged[info.date]) return;
    state.streak.breaksLogged[info.date] = true;
    state.streak.history.push({ date: info.date, len: info.len, reason: null });
    save();
    openBreakModal(info.date, info.len);
  }

  // ---------- Utilidades visuais ----------
  function conic(pct, color, rest) {
    const c = color || 'var(--purple)';
    const r = rest || 'var(--track)';
    return `conic-gradient(${c} 0% ${pct}%, ${r} ${pct}% 100%)`;
  }

  // ---------- Render (dispatcher) ----------
  function render() {
    if (materializeRoutines(viewDate)) save();
    renderHoje();
    if (currentView === 'semana') renderSemana();
    if (currentView === 'progresso') renderProgresso();
    if (currentView === 'ajustes') { /* estático + diag; nada dependente do dia */ }
  }

  // ---------- Tela HOJE ----------
  function renderHoje() {
    const isToday = viewDate === todayISO();
    $('#hojeTitle').textContent = fmtHeader(viewDate);
    const count = allItems(viewDate).length;
    const countTxt = `${count} ${count === 1 ? 'tarefa' : 'tarefas'}${isToday ? ' hoje' : ''}`;
    let sub;
    if (isToday) {
      const streak = computeStreak();
      sub = `${streak} ${streak === 1 ? 'dia seguido' : 'dias seguidos'} · ${countTxt}`;
    } else {
      const rel = relLabel(viewDate);
      sub = (rel ? rel + ' · ' : '') + countTxt;
    }
    $('#hojeSub').textContent = sub;

    renderTimed();
    renderUntimed();
    renderDaySummary();
    renderSuggestion();
  }

  function timedNextId(sorted) {
    if (viewDate !== todayISO()) return null;
    const now = nowMinutes();
    const cand = sorted.find((x) => !x.it.done && timeToMin(x.it.time) >= now);
    return cand ? cand.it.id : null;
  }

  function renderTimed() {
    const wrap = $('#timedList');
    wrap.innerHTML = '';
    const timed = itemsWithPeriod(viewDate).filter((x) => x.it.time).sort((a, b) => timeToMin(a.it.time) - timeToMin(b.it.time));
    $('#timedEmpty').classList.toggle('hidden', timed.length > 0);
    const nextId = timedNextId(timed);
    timed.forEach(({ it, period }) => {
      const row = document.createElement('div');
      row.className = 'timed-item' + (it.done ? ' done' : '') + (it.id === nextId ? ' next' : '');
      row.innerHTML = `
        <div class="timed-time">${it.time}</div>
        <div class="timed-card">
          <div class="timed-text">${it.priority === 'alta' ? '<span class="prio-dot" title="prioridade alta"></span>' : ''}${esc(it.text)}${it.routineId ? '<span class="routine-badge">rotina</span>' : ''}</div>
          <button class="check ${it.done ? 'on' : ''}" aria-label="Concluir">${CHECK_SVG}</button>
        </div>`;
      row.querySelector('.check').onclick = (e) => { e.stopPropagation(); toggleItem(viewDate, period, it.id); };
      row.querySelector('.timed-text').onclick = (e) => openItemMenu(e, it, period);
      wrap.appendChild(row);
    });
  }

  function renderUntimed() {
    const section = $('#untimedSection');
    const wrap = $('#untimedList');
    wrap.innerHTML = '';
    const untimed = itemsWithPeriod(viewDate).filter((x) => !x.it.time);
    section.classList.toggle('hidden', untimed.length === 0);
    untimed.forEach(({ it, period }) => {
      const row = document.createElement('div');
      row.className = 'todo-row' + (it.done ? ' done' : '');
      row.innerHTML = `
        <button class="check sm ${it.done ? 'on' : ''}" aria-label="Concluir">${CHECK_SVG}</button>
        <div class="todo-text">${it.priority === 'alta' ? '<span class="prio-dot" title="prioridade alta"></span>' : ''}${esc(it.text)}${it.routineId ? '<span class="routine-badge">rotina</span>' : ''}</div>`;
      row.querySelector('.check').onclick = (e) => { e.stopPropagation(); toggleItem(viewDate, period, it.id); };
      row.querySelector('.todo-text').onclick = (e) => openItemMenu(e, it, period);
      wrap.appendChild(row);
    });
  }

  function renderDaySummary() {
    const slot = $('#daySummarySlot');
    const s = dayStats(viewDate);
    if (s.total === 0) { slot.innerHTML = ''; return; }
    const streak = computeStreak();
    const isToday = viewDate === todayISO();
    const sub = isToday ? `${streak} ${streak === 1 ? 'dia seguido' : 'dias seguidos'}` : (s.pct === 100 ? 'dia completo' : `${s.total - s.done} ${s.total - s.done === 1 ? 'pendente' : 'pendentes'}`);
    slot.innerHTML = `
      <div class="day-summary">
        <div class="mini-ring" style="background:${conic(s.pct)}">
          <div class="mini-ring-hole">${s.pct}%</div>
        </div>
        <div class="day-summary-text">
          <div class="day-summary-main">${s.done} de ${s.total} ${s.done === 1 ? 'concluída' : 'concluídas'}</div>
          <div class="day-summary-sub">${sub}</div>
        </div>
      </div>`;
  }

  // ---------- Sugestões proativas (no máx. 1, na tela Hoje) ----------
  function pruneSuggestDismissed() {
    const ui = state.ui || (state.ui = { suggestDismissed: {} });
    const floor = addDays(todayISO(), -7);
    Object.keys(ui.suggestDismissed || {}).forEach((k) => { const date = k.split('|')[0]; if (date < floor) delete ui.suggestDismissed[k]; });
  }
  function isSuggestDismissed(key) { return !!(state.ui && state.ui.suggestDismissed && state.ui.suggestDismissed[todayISO() + '|' + key]); }
  function dismissSuggestion(key) {
    const ui = state.ui || (state.ui = { suggestDismissed: {} });
    ui.suggestDismissed[todayISO() + '|' + key] = true;
    save(); renderSuggestion();
  }

  function buildSuggestion() {
    const t = todayISO();
    // 1) pendências de ontem
    const y = addDays(t, -1);
    const pend = pendingFrom(y);
    if (pend.length && !isSuggestDismissed('carry')) {
      return {
        key: 'carry', tag: 'PENDÊNCIAS',
        text: `Você deixou ${pend.length} ${pend.length === 1 ? 'tarefa' : 'tarefas'} para trás ontem. Quer trazer para hoje?`,
        primary: { label: 'Trazer', fn: () => { carryMove(); } },
        ghosts: [{ label: 'Ignorar', fn: () => dismissSuggestion('carry') }],
      };
    }
    // 2) rotina do dia que foi removida
    const wd = fromISO(t).getDay();
    const d = state.days[t];
    for (const r of state.routines) {
      if (!r.days || !r.days.includes(wd)) continue;
      const present = d && PERIODS.some((p) => (d[p.key] || []).some((it) => it.routineId === r.id));
      const key = 'routine-' + r.id;
      if (!present && !isSuggestDismissed(key)) {
        return {
          key, tag: 'SUGESTÃO',
          text: `Você costuma "${r.text}" toda ${DOW_FULL[wd]} e ainda não colocou hoje.`,
          primary: { label: 'Adicionar', fn: () => { addRoutineInstanceToday(r); dismissSuggestion(key); } },
          ghosts: [{ label: 'Ignorar', fn: () => dismissSuggestion(key) }],
        };
      }
    }
    // 3) período sobrecarregado
    if (d) {
      for (const p of PERIODS) {
        const pendingCount = (d[p.key] || []).filter((it) => !it.done).length;
        const key = 'heavy-' + p.key;
        if (pendingCount >= 5 && !isSuggestDismissed(key)) {
          return {
            key, tag: 'SUGESTÃO',
            text: `Seu ${p.label.toLowerCase()} está pesado — ${pendingCount} tarefas pendentes. Quer mover a última para amanhã?`,
            primary: { label: 'Mover', fn: () => { moveLastPendingToTomorrow(p.key); dismissSuggestion(key); } },
            ghosts: [{ label: 'Manter', fn: () => dismissSuggestion(key) }],
          };
        }
      }
    }
    // 3.5) orçamento de tempo: tarefas demais para as horas que sobram hoje
    const budget = timeBudgetToday();
    if (budget && !isSuggestDismissed('budget')) {
      return {
        key: 'budget', tag: 'REPLANEJAR',
        text: `Você ainda tem ${budget.pending} ${budget.pending === 1 ? 'tarefa' : 'tarefas'} e só ${budget.hoursTxt} ${budget.hoursTxt === '1' ? 'hora livre' : 'horas livres'} hoje. Quer mover uma para amanhã?`,
        primary: { label: 'Mover uma', fn: () => { moveOnePendingToTomorrow(); dismissSuggestion('budget'); } },
        ghosts: [{ label: 'Deixa assim', fn: () => dismissSuggestion('budget') }],
      };
    }
    // 3.6) memória de rotina: padrão que se repete e ainda não virou rotina fixa
    const pat = detectRoutinePattern();
    if (pat) {
      const key = 'routinemine-' + pat.textKey;
      return {
        key, tag: 'MEMÓRIA', persist: pat.textKey,
        text: `Você costuma "${pat.text}" ${pat.daysLabel}. Quer transformar em rotina fixa?`,
        primary: { label: 'Criar rotina', fn: () => { createRoutineFromPattern(pat); } },
        ghosts: [{ label: 'Agora não', fn: () => dismissRoutineMine(pat.textKey) }],
      };
    }
    // 4) domingo: revisar semana
    if (wd === 0 && !isSuggestDismissed('sunday')) {
      return {
        key: 'sunday', tag: 'DOMINGO',
        text: pickPhrase('weeklySummary', 'Semana encerrada. Olha os números e ajusta.'),
        primary: { label: 'Ver progresso', fn: () => switchView('progresso') },
        ghosts: [{ label: 'Ignorar', fn: () => dismissSuggestion('sunday') }],
      };
    }
    return null;
  }

  function renderSuggestion() {
    const slot = $('#suggestionSlot');
    slot.innerHTML = '';
    if (viewDate !== todayISO()) return;
    pruneSuggestDismissed();
    const sug = buildSuggestion();
    if (!sug) return;
    const el = document.createElement('div');
    el.className = 'suggestion';
    el.innerHTML = `
      <div class="suggestion-head"><span class="suggestion-dot"></span><span class="suggestion-tag">${sug.tag}</span></div>
      <div class="suggestion-text">${esc(sug.text)}</div>
      <div class="suggestion-actions"></div>`;
    const acts = el.querySelector('.suggestion-actions');
    const pb = document.createElement('button');
    pb.className = 's-primary'; pb.textContent = sug.primary.label; pb.onclick = sug.primary.fn;
    acts.appendChild(pb);
    (sug.ghosts || []).forEach((g) => { const b = document.createElement('button'); b.className = 's-ghost'; b.textContent = g.label; b.onclick = g.fn; acts.appendChild(b); });
    slot.appendChild(el);
  }

  function addRoutineInstanceToday(r) {
    const per = PERIODS.some((p) => p.key === r.period) ? r.period : 'morning';
    const t = todayISO();
    dayData(t)[per].push({ id: uid(), routineId: r.id, text: r.text, time: r.time || null, reminder: (r.reminder != null ? r.reminder : null), done: false });
    if (!dayData(t).seeded.includes(r.id)) dayData(t).seeded.push(r.id);
    save(); render(); scheduleNotifications();
    toast('Adicionado');
  }
  function moveLastPendingToTomorrow(periodKey) {
    const t = todayISO();
    const arr = dayData(t)[periodKey];
    for (let i = arr.length - 1; i >= 0; i--) {
      if (!arr[i].done) {
        const it = arr.splice(i, 1)[0];
        dayData(addDays(t, 1))[periodKey].push({ id: uid(), text: it.text, time: it.time || null, reminder: (it.reminder != null ? it.reminder : null), done: false });
        save(); render(); scheduleNotifications();
        toast('Movida para amanhã');
        return;
      }
    }
  }

  // ---------- Replanejamento: orçamento de tempo (feature 2) ----------
  const DAY_END_MIN = 22 * 60; // consideramos o dia "produtivo" até as 22h
  function timeBudgetToday() {
    const now = nowMinutes();
    if (now < 12 * 60) return null;          // não incomoda de manhã
    const hoursLeft = (DAY_END_MIN - now) / 60;
    if (hoursLeft <= 0) return null;
    const t = todayISO();
    const pending = allItems(t).filter((it) => !it.done).length;
    if (pending < 3) return null;
    if (pending <= hoursLeft) return null;   // tem folga, tudo bem
    return { pending, hoursTxt: String(Math.max(1, Math.round(hoursLeft))) };
  }
  function relocateToTomorrow(iso, periodKey, index) {
    const arr = dayData(iso)[periodKey];
    const it = arr.splice(index, 1)[0];
    dayData(addDays(iso, 1))[periodKey].push({ id: uid(), text: it.text, time: it.time || null, reminder: (it.reminder != null ? it.reminder : null), done: false, priority: it.priority || null });
    save(); render(); scheduleNotifications();
    toast('Movida para amanhã');
  }
  function moveOnePendingToTomorrow() {
    const t = todayISO();
    // 1) preferir uma pendente SEM horário (menos comprometida)
    for (const p of PERIODS) {
      const arr = dayData(t)[p.key];
      for (let i = arr.length - 1; i >= 0; i--) if (!arr[i].done && !arr[i].time) return relocateToTomorrow(t, p.key, i);
    }
    // 2) senão, a de horário mais tarde
    let best = null;
    PERIODS.forEach((p) => (dayData(t)[p.key] || []).forEach((it, i) => {
      if (!it.done && it.time) { const m = timeToMin(it.time); if (!best || m > best.m) best = { key: p.key, i, m }; }
    }));
    if (best) relocateToTomorrow(t, best.key, best.i);
  }

  // ---------- Memória de rotina: detecção de padrões (feature 3) ----------
  function normKey(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function pluralDow(wd) { return DOW_FULL[wd] + 's'; }
  function mostCommon(arr) {
    if (!arr.length) return null;
    const c = {}; let best = arr[0], bestN = 0;
    arr.forEach((v) => { const k = String(v); c[k] = (c[k] || 0) + 1; if (c[k] > bestN) { bestN = c[k]; best = v; } });
    return best;
  }
  function detectRoutinePattern() {
    const t = todayISO();
    const floor = addDays(t, -70);
    // agrupa ocorrências manuais por texto normalizado
    const groups = {}; // key -> { text, byDow: {wd: {weeks:Set, times:[], periods:[]}} }
    Object.keys(state.days).forEach((iso) => {
      if (iso >= t || iso < floor) return;
      const wd = fromISO(iso).getDay();
      const wk = weekKey(iso);
      PERIODS.forEach((p) => (state.days[iso][p.key] || []).forEach((it) => {
        if (it.routineId) return;                 // já é rotina
        const key = normKey(it.text);
        if (!key) return;
        const g = groups[key] || (groups[key] = { text: it.text, byDow: {} });
        g.text = it.text;                          // texto representativo (mais recente pela ordem de iso)
        const slot = g.byDow[wd] || (g.byDow[wd] = { weeks: new Set(), times: [], periods: [] });
        slot.weeks.add(wk);
        if (it.time) slot.times.push(it.time);
        slot.periods.push(p.key);
      }));
    });
    // escolhe o melhor candidato: texto com dias que se repetem em >=3 semanas e ainda não é rotina
    let bestCand = null, bestScore = 0;
    Object.keys(groups).forEach((key) => {
      if (state.ui.routineMineDismissed && state.ui.routineMineDismissed[key]) return;
      const g = groups[key];
      const weekdays = [], allTimes = [], allPeriods = [];
      let score = 0;
      Object.keys(g.byDow).forEach((wdStr) => {
        const wd = Number(wdStr);
        const slot = g.byDow[wd];
        if (slot.weeks.size < 3) return;                                   // precisa se repetir em >=3 semanas
        if (routineCoversDow(key, wd)) return;                             // já existe rotina nesse dia
        weekdays.push(wd); allTimes.push(...slot.times); allPeriods.push(...slot.periods);
        score += slot.weeks.size;
      });
      if (weekdays.length && score > bestScore) {
        bestScore = score;
        weekdays.sort((a, b) => a - b);
        const time = mostCommon(allTimes) || null;
        const period = mostCommon(allPeriods) || 'morning';
        const daysLabel = weekdays.length === 1 ? `toda ${DOW_FULL[weekdays[0]]}` : `nas ${weekdays.map(pluralDow).join(' e ')}`;
        bestCand = { textKey: key, text: g.text, weekdays, daysLabel, time, period };
      }
    });
    return bestCand;
  }
  function routineCoversDow(textKey, wd) {
    return state.routines.some((r) => normKey(r.text) === textKey && Array.isArray(r.days) && r.days.includes(wd));
  }
  function createRoutineFromPattern(pat) {
    state.routines.push({ id: uid(), text: pat.text, period: pat.period, time: pat.time, reminder: null, days: pat.weekdays });
    if (!state.ui.routineMineDismissed) state.ui.routineMineDismissed = {};
    state.ui.routineMineDismissed[pat.textKey] = true;
    seedHorizon();
    save(); render(); renderRoutines(); scheduleNotifications();
    toast('Rotina criada');
  }
  function dismissRoutineMine(textKey) {
    if (!state.ui.routineMineDismissed) state.ui.routineMineDismissed = {};
    state.ui.routineMineDismissed[textKey] = true;
    save(); renderSuggestion();
  }

  // pendências de um dia
  function pendingFrom(iso) {
    const d = state.days[iso];
    if (!d) return [];
    const out = [];
    PERIODS.forEach((per) => (d[per.key] || []).forEach((it) => { if (!it.done) out.push({ it, period: per.key }); }));
    return out;
  }
  function carryMove() {
    const t = todayISO();
    const y = addDays(t, -1);
    const pend = pendingFrom(y);
    if (!pend.length) return;
    pend.forEach(({ it, period }) => {
      dayData(t)[period].push({ id: uid(), text: it.text, time: it.time || null, reminder: (it.reminder != null ? it.reminder : null), done: false });
    });
    dismissSuggestion('carry');
    save(); render(); scheduleNotifications();
    toast(`${pend.length} ${pend.length === 1 ? 'pendência trazida' : 'pendências trazidas'}`);
  }

  // ---------- CRUD itens ----------
  function toggleItem(iso, period, id) {
    const found = findItem(iso, id);
    if (!found) return;
    found.it.done = !found.it.done;
    save(); render();
    if (isDayComplete(iso)) maybeCelebrate(iso);
  }
  function deleteItem(iso, period, id) { removeItemById(iso, id); save(); render(); scheduleNotifications(); }
  function duplicateItem(it, period) {
    dayData(viewDate)[period].push({ id: uid(), text: it.text, time: it.time || null, reminder: (it.reminder != null ? it.reminder : null), done: false });
    save(); render(); scheduleNotifications();
    toast('Tarefa duplicada');
  }
  function moveItemToTomorrow(iso, period, id) {
    const found = findItem(iso, id);
    if (!found) return;
    removeItemById(iso, id);
    dayData(addDays(iso, 1))[found.period].push({ id: uid(), text: found.it.text, time: found.it.time || null, reminder: (found.it.reminder != null ? found.it.reminder : null), done: false });
    save(); render(); scheduleNotifications();
    toast('Movida para amanhã');
  }

  function openItemMenu(ev, it, period) {
    openCtxMenu(ev, [
      { label: 'Editar', fn: () => openItemModal(it, period) },
      { label: 'Mover para amanhã', fn: () => moveItemToTomorrow(viewDate, period, it.id) },
      { label: 'Duplicar', fn: () => duplicateItem(it, period) },
      { label: 'Apagar', danger: true, fn: () => deleteItem(viewDate, period, it.id) },
    ]);
  }

  // ---------- CRUD metas ----------
  function deleteGoal(id) {
    state.goals = state.goals.filter((g) => g.id !== id);
    Object.values(state.goalProgress).forEach((wk) => delete wk[id]);
    save(); renderGoals();
  }

  // ---------- Tela SEMANA ----------
  function renderSemana() {
    const week = weekDates(viewDate);
    const first = fromISO(week[0]), last = fromISO(week[6]);
    const range = first.getMonth() === last.getMonth()
      ? `${first.getDate()} – ${last.getDate()} de ${MONTHS_FULL[last.getMonth()]}`
      : `${first.getDate()} ${MONTHS[first.getMonth()]} – ${last.getDate()} ${MONTHS[last.getMonth()]}`;
    $('#semanaSub').textContent = range;

    const list = $('#weekList');
    list.innerHTML = '';
    const t = todayISO();
    week.forEach((iso) => {
      const d = fromISO(iso);
      const idx = (d.getDay() + 6) % 7;
      const s = dayStats(iso);
      const isToday = iso === t;
      const el = document.createElement('div');
      el.className = 'week-day' + (isToday ? ' today' : '');
      const countHtml = isToday
        ? `<span>Hoje</span>${s.total ? `<span class="frac">${s.done}/${s.total}</span>` : ''}`
        : `${s.total} ${s.total === 1 ? 'tarefa' : 'tarefas'}`;
      const fillPct = s.total ? Math.max(s.pct, 4) : 0;
      el.innerHTML = `
        <div class="week-date">
          <div class="week-dow">${DOW_TAB[idx].toUpperCase()}</div>
          <div class="week-num">${d.getDate()}</div>
        </div>
        <div class="week-info">
          <div class="week-count">${countHtml}</div>
          <div class="week-bar"><span style="width:${fillPct}%"></span></div>
        </div>
        <div class="week-chev">›</div>`;
      el.onclick = () => { viewDate = iso; switchView('hoje'); };
      list.appendChild(el);
    });

    renderGoals();
  }

  function renderGoals() {
    const list = $('#goalList');
    if (!list) return;
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
          <button class="check ${p.done ? 'on' : ''}" aria-label="Concluir">${CHECK_SVG}</button>
          <span class="goal-text">${esc(g.text)}</span>
          <button class="row-menu" aria-label="Opções">⋯</button>`;
        li.querySelector('.check').onclick = () => { p.done = !p.done; save(); renderGoals(); };
      }
      li.querySelector('.row-menu').onclick = (e) => openCtxMenu(e, [
        { label: 'Editar', fn: () => openGoalModal(g) },
        { label: 'Apagar', danger: true, fn: () => deleteGoal(g.id) },
      ]);
      list.appendChild(li);
    });
  }

  // ---------- Tela PROGRESSO ----------
  function renderProgresso() {
    const week = weekDates(viewDate);
    let wDone = 0, wTotal = 0;
    week.forEach((iso) => { const s = dayStats(iso); wDone += s.done; wTotal += s.total; });
    const wpct = wTotal ? Math.round((wDone / wTotal) * 100) : 0;
    $('#weekRing').style.background = conic(wpct, 'var(--purple)', 'oklch(0.24 0.017 285)');
    $('#weekRingPct').textContent = wpct + '%';
    $('#weekTasksCaption').textContent = `${wDone} ${wDone === 1 ? 'tarefa concluída' : 'tarefas concluídas'} nesta semana`;

    const tiles = $('#statTiles');
    tiles.innerHTML = `
      <div class="stat-tile"><div class="st-num hl">${computeStreak()}</div><div class="st-lbl">sequência<br/>atual</div></div>
      <div class="stat-tile"><div class="st-num">${completeDaysThisMonth()}</div><div class="st-lbl">dias 100%<br/>este mês</div></div>
      <div class="stat-tile"><div class="st-num">${bestStreak()}</div><div class="st-lbl">melhor<br/>sequência</div></div>`;

    renderHistory30();

    const bh = $('#breakHistory');
    const hist = (state.streak.history || []).slice().reverse();
    bh.innerHTML = hist.length
      ? hist.slice(0, 8).map((h) => `<li><b>${h.len} ${h.len === 1 ? 'dia' : 'dias'}</b> até ${fmtLong(h.date)}${h.reason ? ` — ${esc(h.reason)}` : ''}</li>`).join('')
      : '<li>Nenhuma quebra registrada. Mantém assim.</li>';
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
      if (s.total > 0) {
        if (s.pct === 100) cell.classList.add('l3');
        else if (s.pct >= 50) cell.classList.add('l2');
        else cell.classList.add('l1');
      }
      if (iso === t) cell.classList.add('today');
      cell.title = `${iso} — ${s.total ? s.pct + '%' : 'vazio'}`;
      grid.appendChild(cell);
    }
  }

  // ---------- Ferramentas de semana ----------
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
          if (it.routineId) return;
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

  // ---------- Notificações (fallback local) ----------
  const timers = [];
  function clearTimers() { timers.forEach(clearTimeout); timers.length = 0; }
  function scheduleNotifications() {
    clearTimers();
    if (window.__pushActive) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const [dh, dm] = state.settings.dailyReminder.split(':').map(Number);
    scheduleAt(dh, dm, () => notify('Hora de organizar', { body: pickPhrase('dailyReminder', 'Define suas prioridades antes que o dia te defina.'), tag: 'daily' }));
    const t = todayISO();
    allItems(t).forEach((it) => {
      if (!it.time || it.done) return;
      const [h, m] = it.time.split(':').map(Number);
      const rem = (it.reminder != null ? it.reminder : state.settings.defaultReminder) || 0;
      let target = new Date(); target.setHours(h, m, 0, 0);
      target = new Date(target.getTime() - rem * 60000);
      const delay = target.getTime() - Date.now();
      if (delay > 0 && delay < 26 * 3600000) {
        timers.push(setTimeout(() => notify(it.text, {
          body: `${it.time} · ${pickPhrase('taskReminder', 'Está no horário. Levanta e faz.')}`,
          tag: 'task-' + it.id, data: { itemId: it.id, date: t }, actions: [{ action: 'done', title: 'Concluir' }],
        }), delay));
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
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) { reg.showNotification(title, opts); return; } }
    catch (e) { /* fallback abaixo */ }
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, opts);
  }
  const MILESTONES = [7, 14, 21, 30, 50, 75, 100, 150, 200, 365];
  function maybeCelebrate(iso) {
    if (iso !== todayISO()) return;
    const streak = computeStreak();
    if (streak > 0 && streak === state.settings.streakGoal) toast('Meta de ' + streak + ' dias batida. Agora sustenta.');
    else if (MILESTONES.includes(streak)) toast(streak + ' dias seguidos. ' + pickPhrase('dayComplete', 'É assim que se constrói.'));
    else toast(pickPhrase('dayComplete', 'Dia fechado. É assim que se constrói.') + ' (' + streak + ')');
  }

  // ---------- Views ----------
  const SCREENS = ['hoje', 'semana', 'progresso', 'ajustes'];
  function switchView(v) {
    currentView = v;
    SCREENS.forEach((name) => $('#screen-' + name).classList.toggle('hidden', name !== v));
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    if (v === 'hoje') renderHoje();
    if (v === 'semana') renderSemana();
    if (v === 'progresso') renderProgresso();
    if (v === 'ajustes') renderSettings();
    window.scrollTo(0, 0);
  }

  // ---------- Ajustes ----------
  function renderSettings() {
    $('#dailyReminder').value = state.settings.dailyReminder;
    $('#defaultReminder').value = state.settings.defaultReminder;
    $('#streakGoalInput').value = state.settings.streakGoal;
    $('#aiUsageCount').textContent = aiUsageCount();
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
    if (!('Notification' in window)) { btn.textContent = 'Indisponível'; btn.disabled = true; note.textContent = 'Este navegador não suporta notificações.'; return; }
    const p = Notification.permission;
    if (p === 'granted') { btn.textContent = 'Ativadas ✓'; btn.disabled = true; }
    else if (p === 'denied') { btn.textContent = 'Bloqueadas'; btn.disabled = true; note.textContent = 'Você bloqueou. Libere nas configurações do navegador.'; }
    else { btn.textContent = 'Ativar'; btn.disabled = false; }
    if (p === 'granted') note.textContent = 'No iPhone, as notificações só disparam com o app instalado na tela inicial (adicionado à Tela de Início). O texto pode ser gerado pela IA na hora, com o banco de frases como reserva.';
    else if (p === 'default') note.textContent = 'Ative para receber o lembrete diário e os avisos das tarefas.';
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
      const oldArr = dayData(viewDate)[editing.period];
      const i = oldArr.findIndex((x) => x.id === editing.item.id);
      if (i >= 0) oldArr.splice(i, 1);
      editing.item.text = text; editing.item.time = time; editing.item.reminder = reminder;
      dayData(viewDate)[period].push(editing.item);
    } else if ($('#itemRepeat').checked) {
      const isos = $$('#dupDays .dup-day').filter((b) => b.dataset.on === '1').map((b) => b.dataset.iso);
      const days = Array.from(new Set((isos.length ? isos : [viewDate]).map((iso) => fromISO(iso).getDay()))).sort();
      state.routines.push({ id: uid(), text, period, time, reminder, days });
      seedHorizon();
      toast('Rotina criada');
    } else {
      const targets = $$('#dupDays .dup-day').filter((b) => b.dataset.on === '1').map((b) => b.dataset.iso);
      const list = targets.length ? targets : [viewDate];
      list.forEach((iso) => dayData(iso)[period].push({ id: uid(), text, time, reminder, done: false }));
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
    if (editing.goal) { editing.goal.text = text; editing.goal.type = type; editing.goal.target = target; }
    else state.goals.push({ id: uid(), text, type, target });
    save(); hide('#goalModal'); renderGoals();
  }

  // ---------- Rotinas: modal + lista ----------
  function buildRoutineDayPicker(selected) {
    const wrap = $('#routineDays'); wrap.innerHTML = '';
    const sel = new Set(selected || []);
    DOW_TAB.forEach((label, i) => {
      const dow = (i + 1) % 7;
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
      clearFutureRoutine(r.id, true);
      r.text = text; r.period = period; r.time = time; r.reminder = reminder; r.days = days;
    } else state.routines.push({ id: uid(), text, period, time, reminder, days });
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
    $('#breakModalText').innerHTML = `<strong>${esc(phrase)}</strong><br><span style="color:var(--muted)">Sequência perdida: ${len} ${len === 1 ? 'dia' : 'dias'}. Anota o motivo? (opcional)</span>`;
    $('#breakReason').value = '';
    $('#breakModal').dataset.date = date;
    $('#breakModal').dataset.len = len;
    show('#breakModal');
  }
  function saveBreak(withReason) {
    const m = $('#breakModal');
    const date = m.dataset.date;
    const entry = (state.streak.history || []).slice().reverse().find((h) => h.date === date);
    if (entry) entry.reason = withReason ? ($('#breakReason').value.trim() || null) : null;
    else state.streak.history.push({ date, len: Number(m.dataset.len), reason: withReason ? ($('#breakReason').value.trim() || null) : null });
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
    const r = (ev.currentTarget || ev.target).getBoundingClientRect();
    const mw = 170;
    menu.style.top = Math.min(r.bottom + 4, window.innerHeight - 200) + 'px';
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)) + 'px';
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

  // ---------- Snackbar (Desfazer) ----------
  let snackTimer = null, snackFn = null;
  function showUndo(msg, undoFn, ms) {
    const sb = $('#snackbar');
    $('#snackbarText').textContent = msg;
    snackFn = undoFn;
    sb.classList.remove('hidden');
    clearTimeout(snackTimer);
    snackTimer = setTimeout(hideUndo, ms || 6000);
  }
  function hideUndo() { $('#snackbar').classList.add('hidden'); snackFn = null; clearTimeout(snackTimer); }

  // ---------- Criar tarefa por texto (IA) ----------
  function apiBase() { return ((window.PUSH_CONFIG && window.PUSH_CONFIG.apiBase) || '').replace(/\/$/, ''); }
  let aiBusy = false;
  async function aiCreateTask() {
    if (aiBusy) return;
    const input = $('#aiText');
    const hint = $('#aiHint');
    const text = input.value.trim();
    hint.classList.remove('err');
    if (!text) { input.focus(); return; }
    aiBusy = true; $('#aiBar').classList.add('busy'); $('#aiSend').disabled = true; hint.textContent = 'Interpretando…';
    try {
      bumpAiUsage();
      const res = await fetch(apiBase() + '/api/parse-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, today: todayISO() }),
      });
      let data = null;
      try { data = await res.json(); } catch { /* resposta não-JSON */ }
      if (!data) { hint.classList.add('err'); hint.textContent = 'IA indisponível aqui (precisa do backend).'; return; }
      if (!data.ok) { hint.classList.add('err'); hint.textContent = data.message || 'Não consegui entender. Tente falar de outro jeito.'; return; }

      const t = data.task;
      const period = PERIODS.some((p) => p.key === t.period) ? t.period : 'morning';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : todayISO();
      const newId = uid();
      dayData(date)[period].push({ id: newId, text: t.task, time: t.time || null, reminder: null, done: false });
      input.value = '';
      hint.textContent = 'Ex.: "Amanhã às 14h preciso gravar três vídeos"';
      if (date !== viewDate) viewDate = date;
      save(); render(); scheduleNotifications();
      const when = date === todayISO() ? 'hoje' : (relLabel(date).toLowerCase() || fmtLong(date));
      const timePart = t.time ? ' às ' + t.time : '';
      const cap = t.task.charAt(0).toUpperCase() + t.task.slice(1);
      showUndo(`${cap} ${date === todayISO() ? 'adicionada hoje' : 'adicionada ' + when}${timePart}`, () => {
        removeItemById(date, newId);
        save(); render(); scheduleNotifications();
        toast('Desfeito');
      });
    } catch (e) {
      hint.classList.add('err'); hint.textContent = 'Sem conexão com a IA. Tente de novo.';
    } finally {
      aiBusy = false; $('#aiBar').classList.remove('busy'); $('#aiSend').disabled = false;
    }
  }

  // ---------- Organizar meu dia (IA, requer aprovação) ----------
  let organizeProposal = null;
  async function organizeDay() {
    const iso = viewDate;
    const items = itemsWithPeriod(iso).filter((x) => !x.it.done).map(({ it, period }) => ({ id: it.id, task: it.text, time: it.time || null, period }));
    if (items.length < 2) { toast('Adicione mais tarefas para organizar'); return; }
    const btn = $('#organizeDay');
    btn.disabled = true; btn.textContent = 'Organizando…';
    try {
      bumpAiUsage();
      const res = await fetch(apiBase() + '/api/organize-day', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, today: todayISO(), date: iso }),
      });
      let data = null; try { data = await res.json(); } catch {}
      if (!data) { toast('IA indisponível aqui (precisa do backend).'); return; }
      if (!data.ok) { toast(data.message || 'Não consegui organizar agora.'); return; }
      const changes = (data.changes || []).filter((c) => c && c.id && findItem(iso, c.id) && (c.time || c.period));
      // só mudanças que realmente alteram algo
      const real = changes.filter((c) => { const f = findItem(iso, c.id); if (!f) return false; return (c.time && c.time !== (f.it.time || null)) || (c.period && c.period !== f.period); });
      if (!real.length) { toast('Seu dia já está bem organizado.'); return; }
      organizeProposal = { date: iso, changes: real };
      openOrganizeModal(real, iso);
    } catch (e) {
      toast('Sem conexão com a IA. Tente de novo.');
    } finally {
      btn.disabled = false; btn.textContent = 'Organizar meu dia';
    }
  }
  function openOrganizeModal(changes, iso) {
    const list = $('#organizeList');
    list.innerHTML = '';
    const perLabel = (k) => (PERIODS.find((p) => p.key === k) || {}).label || '';
    changes.forEach((c) => {
      const f = findItem(iso, c.id);
      const parts = [];
      if (c.time && c.time !== (f.it.time || null)) parts.push(`horário → ${c.time}`);
      if (c.period && c.period !== f.period) parts.push(`período → ${perLabel(c.period)}`);
      const row = document.createElement('div');
      row.className = 'organize-row';
      row.innerHTML = `<div class="or-task">${esc(f.it.text)}</div><div class="or-change">${esc(parts.join(' · '))}</div>`;
      list.appendChild(row);
    });
    show('#organizeModal');
  }
  function applyOrganize() {
    if (!organizeProposal) { hide('#organizeModal'); return; }
    const { date, changes } = organizeProposal;
    changes.forEach((c) => {
      const f = findItem(date, c.id);
      if (!f) return;
      const newPeriod = c.period && PERIODS.some((p) => p.key === c.period) ? c.period : f.period;
      if (c.time && /^\d{1,2}:\d{2}$/.test(c.time)) f.it.time = c.time;
      if (newPeriod !== f.period) { removeItemById(date, c.id); dayData(date)[newPeriod].push(f.it); }
    });
    organizeProposal = null;
    save(); hide('#organizeModal'); render(); scheduleNotifications();
    toast('Dia reorganizado');
  }

  // ---------- Modo foco (feature 4) ----------
  function focusQueue() {
    const items = itemsWithPeriod(todayISO()).filter((x) => !x.it.done);
    const timed = items.filter((x) => x.it.time).sort((a, b) => timeToMin(a.it.time) - timeToMin(b.it.time));
    const untimed = items.filter((x) => !x.it.time);
    return [...timed, ...untimed];
  }
  function openFocus() {
    viewDate = todayISO();
    show('#focusScreen');
    renderFocus();
  }
  function closeFocus() { hide('#focusScreen'); render(); }
  function renderFocus() {
    const body = $('#focusBody'), foot = $('#focusFoot');
    const q = focusQueue();
    const s = dayStats(todayISO());
    if (!q.length) {
      $('#focusLabel').textContent = 'HOJE';
      body.innerHTML = `
        <div class="focus-done-emoji">✓</div>
        <div class="focus-task">${s.total ? 'Tudo feito por hoje' : 'Nada para hoje'}</div>
        <div class="focus-count">${s.total ? s.done + ' de ' + s.total + ' concluídas' : 'Adicione tarefas na tela Hoje'}</div>`;
      foot.innerHTML = '';
      const out = document.createElement('button'); out.className = 'focus-secondary'; out.textContent = 'Sair do foco'; out.onclick = closeFocus;
      foot.appendChild(out);
      return;
    }
    $('#focusLabel').textContent = 'AGORA';
    const cur = q[0], nxt = q[1];
    const prio = cur.it.priority === 'alta' ? '<div class="focus-prio alta">prioridade alta</div>' : '';
    body.innerHTML = `
      <div class="focus-time ${cur.it.time ? '' : 'none'}">${cur.it.time || 'sem horário'}</div>
      <div class="focus-task">${esc(cur.it.text)}</div>
      ${prio}
      ${nxt ? `<div class="focus-next">depois: <b>${esc(nxt.it.text)}</b>${nxt.it.time ? ' · ' + nxt.it.time : ''}</div>` : '<div class="focus-next">é a última de hoje</div>'}
      <div class="focus-count">${s.done} de ${s.total} concluídas hoje</div>`;
    foot.innerHTML = '';
    const done = document.createElement('button');
    done.className = 'focus-primary';
    done.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true"><path d="M5 13l4 4L19 7" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg> Concluir';
    done.onclick = () => focusComplete(cur);
    const later = document.createElement('button');
    later.className = 'focus-secondary';
    later.textContent = cur.it.time ? 'Adiar 30 min' : 'Mover para amanhã';
    later.onclick = () => focusAdiar(cur);
    foot.appendChild(done); foot.appendChild(later);
  }
  function focusComplete(cur) {
    const t = todayISO();
    const found = findItem(t, cur.it.id);
    if (found) { found.it.done = true; save(); }
    renderFocus(); renderHoje();
    if (isDayComplete(t)) maybeCelebrate(t);
  }
  function focusAdiar(cur) {
    const t = todayISO();
    const found = findItem(t, cur.it.id);
    if (!found) { renderFocus(); return; }
    if (found.it.time) {
      let m = timeToMin(found.it.time) + 30;
      if (m > 23 * 60 + 30) m = 23 * 60 + 30;
      found.it.time = pad(Math.floor(m / 60)) + ':' + pad(m % 60);
      save(); scheduleNotifications();
      toast('Adiada para ' + found.it.time);
    } else {
      removeItemById(t, cur.it.id);
      dayData(addDays(t, 1))[found.period].push({ id: uid(), text: found.it.text, time: null, reminder: (found.it.reminder != null ? found.it.reminder : null), done: false, priority: found.it.priority || null });
      save(); scheduleNotifications();
      toast('Movida para amanhã');
    }
    renderFocus(); renderHoje();
  }

  // ---------- Revisão do dia (feature 5) ----------
  function maybeShowReview() {
    const t = todayISO();
    if (state.ui.reviewedDate === t) return;
    if (dayStatus(t) !== 'incomplete') return;                 // só se sobrou algo pendente hoje
    const nudge = state.settings.eveningNudge || '20:30';
    if (nowMinutes() < timeToMin(nudge)) return;               // só à noite
    if (!$('#focusScreen').classList.contains('hidden')) return;
    if ($$('.modal-overlay').some((m) => !m.classList.contains('hidden'))) return;
    openReview();
  }
  function openReview() {
    state.ui.reviewedDate = todayISO();                        // mostra no máx. uma vez por noite
    save();
    renderReview();
    show('#reviewModal');
  }
  function renderReview() {
    const t = todayISO();
    const s = dayStats(t);
    const pend = pendingFrom(t);
    const left = pend.length;
    $('#reviewSummary').innerHTML = left
      ? `Hoje você concluiu <b>${s.done} de ${s.total}</b>. ${left} ${left === 1 ? 'ficou pendente' : 'ficaram pendentes'}. O que fazer com ${left === 1 ? 'ela' : 'elas'}?`
      : `Tudo resolvido. ${s.done} de ${s.total} ${s.done === 1 ? 'concluída' : 'concluídas'} hoje.`;
    const list = $('#reviewList');
    list.innerHTML = '';
    pend.forEach(({ it }) => {
      const row = document.createElement('div');
      row.className = 'review-row';
      row.innerHTML = `
        <div class="review-task">${it.time ? `<span class="rv-time">${it.time}</span>` : ''}${esc(it.text)}</div>
        <div class="review-actions">
          <button data-a="tom">Amanhã</button>
          <button data-a="other">Outro dia</button>
          <button class="rv-del" data-a="del">Excluir</button>
        </div>
        <div class="review-date hidden"><input type="date" min="${addDays(t, 2)}" value="${addDays(t, 2)}" /></div>`;
      row.querySelector('[data-a="tom"]').onclick = () => reviewResolve(() => reviewMove(it.id, addDays(t, 1)));
      row.querySelector('[data-a="del"]').onclick = () => reviewResolve(() => removeItemById(t, it.id));
      const otherBtn = row.querySelector('[data-a="other"]');
      const dateWrap = row.querySelector('.review-date');
      const dateInput = dateWrap.querySelector('input');
      otherBtn.onclick = () => { dateWrap.classList.toggle('hidden'); otherBtn.classList.toggle('on'); };
      dateInput.onchange = () => { const dst = dateInput.value; if (/^\d{4}-\d{2}-\d{2}$/.test(dst) && dst > t) reviewResolve(() => reviewMove(it.id, dst)); };
      list.appendChild(row);
    });
  }
  function reviewMove(id, destIso) {
    const t = todayISO();
    const found = findItem(t, id);
    if (!found) return;
    removeItemById(t, id);
    dayData(destIso)[found.period].push({ id: uid(), text: found.it.text, time: found.it.time || null, reminder: (found.it.reminder != null ? found.it.reminder : null), done: false, priority: found.it.priority || null });
  }
  function reviewResolve(action) {
    action();
    save(); scheduleNotifications();
    renderReview(); render();
  }
  function reviewAllTomorrow() {
    const t = todayISO();
    const pend = pendingFrom(t);
    pend.forEach(({ it }) => reviewMove(it.id, addDays(t, 1)));
    save(); scheduleNotifications();
    closeReview(); render();
    if (pend.length) toast(pend.length + (pend.length === 1 ? ' tarefa movida' : ' tarefas movidas'));
  }
  function closeReview() {
    state.ui.reviewedDate = todayISO();
    save(); hide('#reviewModal');
  }

  // ---------- Planejar meu dia (feature 1, IA com aprovação) ----------
  let planProposal = null;
  function openPlanModal() {
    $('#planStep1').classList.remove('hidden');
    $('#planStep2').classList.add('hidden');
    $('#planText').value = '';
    $('#planHint').textContent = ''; $('#planHint').classList.remove('err');
    $('#planBuild').disabled = false; $('#planBuild').textContent = 'Montar plano';
    show('#planModal');
    setTimeout(() => $('#planText').focus(), 60);
  }
  async function buildPlan() {
    const text = $('#planText').value.trim();
    const hint = $('#planHint'); hint.classList.remove('err');
    if (!text) { $('#planText').focus(); return; }
    const btn = $('#planBuild'); btn.disabled = true; btn.textContent = 'Montando…'; hint.textContent = 'Organizando seu dia…';
    const date = viewDate;
    const now = date === todayISO() ? pad(new Date().getHours()) + ':' + pad(new Date().getMinutes()) : null;
    try {
      bumpAiUsage();
      const res = await fetch(apiBase() + '/api/plan-day', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, date, now }),
      });
      let data = null; try { data = await res.json(); } catch {}
      if (!data) { hint.classList.add('err'); hint.textContent = 'IA indisponível aqui (precisa do backend).'; return; }
      if (!data.ok) { hint.classList.add('err'); hint.textContent = data.message || 'Não consegui montar agora.'; return; }
      const tasks = (data.tasks || []).filter((t) => t && t.task);
      if (!tasks.length) { hint.classList.add('err'); hint.textContent = 'Não identifiquei tarefas nesse texto.'; return; }
      planProposal = { date, tasks };
      renderPlanProposal();
    } catch (e) {
      hint.classList.add('err'); hint.textContent = 'Sem conexão com a IA. Tente de novo.';
    } finally {
      btn.disabled = false; btn.textContent = 'Montar plano';
    }
  }
  function periodRank(p) { return p === 'morning' ? 0 : p === 'afternoon' ? 1 : 2; }
  function sortPlan(a, b) {
    const am = a.time ? timeToMin(a.time) : periodRank(a.period) * 1000 + 900;
    const bm = b.time ? timeToMin(b.time) : periodRank(b.period) * 1000 + 900;
    return am - bm;
  }
  function renderPlanProposal() {
    const { tasks, date } = planProposal;
    $('#planIntro').textContent = `${tasks.length} ${tasks.length === 1 ? 'tarefa' : 'tarefas'} para ${date === todayISO() ? 'hoje' : fmtLong(date)}. Nada é criado até você aprovar.`;
    const list = $('#planList'); list.innerHTML = '';
    const perLabel = (k) => (PERIODS.find((p) => p.key === k) || {}).label || '';
    tasks.slice().sort(sortPlan).forEach((t) => {
      const row = document.createElement('div'); row.className = 'organize-row';
      const meta = t.time ? t.time : perLabel(t.period);
      const prio = (t.priority === 'alta' || t.priority === 'media') ? `<span class="or-prio ${t.priority}">${t.priority === 'alta' ? 'prioridade alta' : 'média'}</span>` : '';
      row.innerHTML = `<div class="or-task">${esc(t.task)}</div><div class="or-change">${esc(meta)}${prio ? ' · ' + prio : ''}</div>`;
      list.appendChild(row);
    });
    $('#planStep1').classList.add('hidden');
    $('#planStep2').classList.remove('hidden');
  }
  function planApply() {
    if (!planProposal) { hide('#planModal'); return; }
    const { date, tasks } = planProposal;
    const created = [];
    tasks.forEach((t) => {
      const period = PERIODS.some((p) => p.key === t.period) ? t.period : 'morning';
      const id = uid(); created.push({ date, id });
      dayData(date)[period].push({ id, text: t.task, time: t.time || null, reminder: null, done: false, priority: (t.priority === 'alta' || t.priority === 'media') ? t.priority : null });
    });
    planProposal = null;
    if (date !== viewDate) viewDate = date;
    save(); hide('#planModal'); render(); scheduleNotifications();
    showUndo(`${created.length} ${created.length === 1 ? 'tarefa criada' : 'tarefas criadas'}`, () => {
      created.forEach((x) => removeItemById(x.date, x.id));
      save(); render(); scheduleNotifications();
      toast('Desfeito');
    });
  }

  // ---------- Voz (Web Speech API) ----------
  let recog = null, recognizing = false;
  function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { $('#aiMic').classList.add('hidden'); return; }
    recog = new SR();
    recog.lang = 'pt-BR';
    recog.interimResults = true;
    recog.continuous = false;
    recog.onstart = () => { recognizing = true; $('#aiMic').classList.add('recording'); $('#listening').classList.remove('hidden'); };
    recog.onerror = () => { stopVoiceUI(); };
    recog.onend = () => {
      stopVoiceUI();
      const val = $('#aiText').value.trim();
      if (val && voiceProduced) aiCreateTask();
      voiceProduced = false;
    };
    recog.onresult = (e) => {
      let txt = '';
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      $('#aiText').value = txt;
      voiceProduced = true;
    };
  }
  let voiceProduced = false;
  function stopVoiceUI() { recognizing = false; $('#aiMic').classList.remove('recording'); $('#listening').classList.add('hidden'); }
  function toggleVoice() {
    if (!recog) return;
    if (recognizing) { try { recog.stop(); } catch {} return; }
    voiceProduced = false;
    $('#aiText').value = '';
    try { recog.start(); } catch (e) { /* já rodando */ }
  }

  // ---------- Eventos ----------
  function bindEvents() {
    $$('.nav-btn').forEach((b) => b.onclick = () => switchView(b.dataset.view));
    $$('[data-open-ajustes]').forEach((b) => b.onclick = () => switchView('ajustes'));
    $('#ajustesBack').onclick = () => switchView('hoje');

    // barra IA
    $('#aiSend').onclick = aiCreateTask;
    $('#aiMic').onclick = toggleVoice;
    $('#aiText').addEventListener('keydown', (e) => { if (e.key === 'Enter') aiCreateTask(); });
    $('#aiText').addEventListener('focus', () => $('#aiBar').classList.add('focused'));
    $('#aiText').addEventListener('blur', () => $('#aiBar').classList.remove('focused'));
    $('#organizeDay').onclick = organizeDay;

    // modo foco (feature 4)
    $('#focusBtn').onclick = openFocus;
    $('#focusClose').onclick = closeFocus;

    // planejar meu dia (feature 1)
    $('#planDayBtn').onclick = openPlanModal;
    $('#planCancel').onclick = () => hide('#planModal');
    $('#planBuild').onclick = buildPlan;
    $('#planText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) buildPlan(); });
    $('#planBack').onclick = () => { $('#planStep2').classList.add('hidden'); $('#planStep1').classList.remove('hidden'); };
    $('#planApply').onclick = planApply;

    // revisão do dia (feature 5)
    $('#reviewClose').onclick = closeReview;
    $('#reviewAllTomorrow').onclick = reviewAllTomorrow;

    // snackbar
    $('#snackbarAction').onclick = () => { if (snackFn) snackFn(); hideUndo(); };

    // metas
    $('#addGoalBtn').onclick = () => openGoalModal(null);

    // modal item
    $('#itemCancel').onclick = () => hide('#itemModal');
    $('#itemSave').onclick = saveItemFromModal;
    $('#itemText').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveItemFromModal(); });
    $('#itemRepeat').onchange = () => { $('#dupLabel').textContent = $('#itemRepeat').checked ? 'Repetir nesses dias da semana' : 'Duplicar para outros dias'; };

    // modal meta
    $('#goalCancel').onclick = () => hide('#goalModal');
    $('#goalSave').onclick = saveGoalFromModal;
    $('#goalType').onchange = () => $('#goalTargetWrap').classList.toggle('hidden', $('#goalType').value !== 'counter');
    $('#goalText').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveGoalFromModal(); });

    // modal rotina
    $('#addRoutineBtn').onclick = () => openRoutineModal(null);
    $('#routineCancel').onclick = () => hide('#routineModal');
    $('#routineSave').onclick = saveRoutineFromModal;
    $('#routineText').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveRoutineFromModal(); });

    // modal break
    $('#breakSkip').onclick = () => saveBreak(false);
    $('#breakSave').onclick = () => saveBreak(true);

    // modal organizar
    $('#organizeCancel').onclick = () => { organizeProposal = null; hide('#organizeModal'); };
    $('#organizeApply').onclick = applyOrganize;

    // ferramentas de semana
    $('#copyPrevWeek').onclick = copyPrevWeekIntoCurrent;
    $('#copyNextWeek').onclick = copyCurrentIntoNext;

    // fechar modal ao clicar no fundo
    $$('.modal-overlay').forEach((ov) => ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.add('hidden'); }));

    // ajustes
    $('#notifToggle').onclick = requestNotif;
    $('#dailyReminder').onchange = (e) => { state.settings.dailyReminder = e.target.value || '08:00'; save(); scheduleNotifications(); };
    $('#defaultReminder').onchange = (e) => { state.settings.defaultReminder = clampInt(e.target.value, 0, 120, 10); e.target.value = state.settings.defaultReminder; save(); };
    $('#streakGoalInput').onchange = (e) => { state.settings.streakGoal = clampInt(e.target.value, 1, 365, 30); e.target.value = state.settings.streakGoal; save(); renderHoje(); };
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

    // rollover ao voltar pro app
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        if (swReg) swReg.update().catch(() => {});
        seedHorizon();
        render();
        checkBreak();
        maybeShowReview();
        syncPush();
        scheduleNotifications();
      }
    });
  }

  function clampInt(v, min, max, dflt) { const n = parseInt(v, 10); if (isNaN(n)) return dflt; return Math.max(min, Math.min(max, n)); }

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
    save(); viewDate = todayISO();
    render(); switchView('hoje');
    toast('Tudo apagado');
  }

  // ---------- Service worker ----------
  let swReg = null;
  function registerSW() {
    if ('serviceWorker' in navigator) {
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
          const found = findItem(date, itemId);
          if (found) { found.it.done = true; save(); render(); }
        }
      });
    }
  }

  // ---------- Boot ----------
  async function init() {
    try { state = await DB.getState(); } catch (e) { console.error(e); }
    if (!state) { state = defaultState(); await DB.setState(state).catch(() => {}); }
    // migração leve (aditiva — nunca apaga dados existentes)
    state.settings = Object.assign(defaultState().settings, state.settings || {});
    state.streak = Object.assign({ history: [], breaksLogged: {} }, state.streak || {});
    if (!Array.isArray(state.routines)) state.routines = [];
    if (!state.aiUsage || typeof state.aiUsage.count !== 'number') state.aiUsage = { month: monthKey(), count: 0 };
    if (!state.ui || typeof state.ui !== 'object') state.ui = { suggestDismissed: {} };
    if (!state.ui.suggestDismissed) state.ui.suggestDismissed = {};
    if (typeof state.ui.reviewedDate === 'undefined') state.ui.reviewedDate = null;
    if (!state.ui.routineMineDismissed) state.ui.routineMineDismissed = {};
    state.version = 3;

    bindEvents();
    initVoice();
    registerSW();
    seedHorizon();
    render();
    switchView('hoje');
    checkBreak();
    maybeShowReview();
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') { await enablePush(); }
    scheduleNotifications();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
