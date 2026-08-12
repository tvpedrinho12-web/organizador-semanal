// push.js — cliente de Web Push. Cuida da inscrição e de (re)agendar os lembretes no backend.
// Degrada com elegância: se o backend não existir (ex.: GitHub Pages puro), simplesmente não ativa.
(function (global) {
  const cfg = global.PUSH_CONFIG || {};
  const IDS_KEY = 'organizador_push_ids';

  function base() { return (cfg.apiBase || '').replace(/\/$/, ''); }
  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  function urlB64ToUint8Array(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(s);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  function getIds() { try { return JSON.parse(localStorage.getItem(IDS_KEY) || '{}'); } catch { return {}; } }
  function setIds(v) { localStorage.setItem(IDS_KEY, JSON.stringify(v || {})); }

  async function getSubscription() {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if (!cfg.vapidPublic) throw new Error('sem vapidPublic no config.js');
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(cfg.vapidPublic),
      });
    }
    return sub;
  }

  let syncTimer = null, lastPlan = null;
  function scheduleSync(plan) {
    lastPlan = plan;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { doSync().catch((e) => console.warn('push sync falhou:', e.message)); }, 800);
  }
  async function syncNow(plan) { lastPlan = plan; return doSync(); }

  async function doSync() {
    if (!supported() || !lastPlan) return { skipped: true };
    if (Notification.permission !== 'granted') return { skipped: 'perm' };

    let sub;
    try { sub = await getSubscription(); }
    catch (e) { global.__pushActive = false; throw new Error('subscribe: ' + e.message); }

    const prev = getIds();
    const payload = {
      subscription: sub.toJSON(),
      dailyCron: lastPlan.dailyCron || null,
      dailyNotification: lastPlan.dailyNotification || null,
      tasks: lastPlan.tasks || [],
      previous: prev,
    };
    const res = await fetch(base() + '/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { global.__pushActive = false; throw new Error('schedule http ' + res.status); }
    const data = await res.json();
    setIds({ dailyScheduleId: data.dailyScheduleId, messageIds: (data.messageIds || []).map((m) => m.id) });
    global.__pushActive = true; // servidor assumiu os lembretes -> desliga o fallback local
    return data;
  }

  // testa se o backend responde (para decidir push vs. fallback local)
  async function probe() {
    try {
      const r = await fetch(base() + '/api/schedule', { method: 'OPTIONS' });
      return r.status === 204 || r.ok;
    } catch { return false; }
  }

  // ---- Diagnóstico ----
  async function info() {
    const out = { origin: location.origin, apiBase: base() || '(mesma origem)', supported: supported(), permission: (typeof Notification !== 'undefined' ? Notification.permission : 'n/a') };
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      out.hasSubscription = !!sub;
      out.endpointHost = sub ? new URL(sub.toJSON().endpoint).host : null;
    } catch (e) { out.subError = String(e); }
    const ids = getIds();
    out.dailyScheduleId = ids.dailyScheduleId || null;
    out.taskMessages = (ids.messageIds || []).length;
    out.backendReachable = await probe();
    return out;
  }
  // Envia um push imediato pelo servidor, SEM passar pelo QStash.
  async function testPush() {
    const sub = await getSubscription();
    const res = await fetch(base() + '/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), testNow: true }),
    });
    let data = null; try { data = await res.json(); } catch {}
    return { httpStatus: res.status, ...data };
  }

  global.PushClient = { supported, getSubscription, scheduleSync, syncNow, doSync, probe, getIds, info, testPush };
})(window);
