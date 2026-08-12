// api/schedule.js — o app (cliente) chama aqui para (re)agendar os lembretes no QStash.
// Mantém o token do QStash no servidor. É idempotente: apaga o que foi agendado antes e recria.
// Também aceita { testNow: true } para enviar um push imediato SEM passar pelo QStash (diagnóstico).
import { Client } from '@upstash/qstash';
import webpush from 'web-push';

const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:organizador@example.com';
if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) {
  webpush.setVapidDetails(SUBJECT, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
}

function baseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  // CORS (permite chamar de outra origem, ex.: app no GitHub Pages + backend no Vercel)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'bad-json' }); }

  const { subscription, dailyCron, dailyNotification, tasks = [], previous = {}, testNow } = body || {};
  if (!subscription) return res.status(400).json({ error: 'no-subscription' });

  // ---- Diagnóstico: envia um push imediato, direto pelo web-push (sem QStash) ----
  if (testNow) {
    if (!process.env.VAPID_PUBLIC || !process.env.VAPID_PRIVATE) {
      return res.status(200).json({ ok: false, test: 'no-vapid', hint: 'faltam VAPID_PUBLIC/VAPID_PRIVATE no Vercel' });
    }
    const notification = body.testNotification || {
      title: 'Teste ✅', body: 'Push direto (sem QStash) chegou.', tag: 'test',
    };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(notification));
      return res.status(200).json({ ok: true, test: 'sent' });
    } catch (err) {
      return res.status(200).json({
        ok: false, test: 'failed',
        statusCode: err && err.statusCode,
        detail: (err && err.body) || String(err),
      });
    }
  }

  // ---- Caminho normal: agendar no QStash ----
  const token = process.env.QSTASH_TOKEN;
  const secret = process.env.SEND_SECRET;
  if (!token || !secret) return res.status(500).json({ error: 'server-not-configured', missing: { QSTASH_TOKEN: !token, SEND_SECRET: !secret } });

  const qstash = new Client({ token });
  const dest = `${baseUrl(req)}/api/send?key=${encodeURIComponent(secret)}`;

  // 1) limpa o agendamento anterior (idempotência) — best-effort
  if (previous.dailyScheduleId) {
    try { await qstash.schedules.delete(previous.dailyScheduleId); } catch (e) { /* já pode ter ido */ }
  }
  for (const id of previous.messageIds || []) {
    try { await qstash.messages.delete(id); } catch (e) { /* já entregue/expirada */ }
  }

  const errors = [];

  // 2) lembrete diário (cron em UTC)
  let dailyScheduleId = null;
  if (dailyCron && dailyNotification) {
    try {
      const r = await qstash.schedules.create({
        destination: dest,
        cron: dailyCron,
        body: JSON.stringify({ subscription, notification: dailyNotification }),
        headers: { 'Content-Type': 'application/json' },
      });
      dailyScheduleId = r.scheduleId;
    } catch (e) {
      console.error('daily schedule', e && e.message);
      errors.push({ where: 'daily', name: e && e.name, message: (e && e.message) || String(e) });
    }
  }

  // 3) por tarefa (mensagem única, entregue no horário calculado)
  const messageIds = [];
  for (const t of tasks) {
    if (!t || !t.notBeforeUnix || !t.notification) continue;
    try {
      const r = await qstash.publishJSON({
        url: dest,
        body: { subscription, notification: t.notification },
        notBefore: t.notBeforeUnix, // unix (segundos) — QStash só entrega a partir daí
      });
      const id = Array.isArray(r) ? r[0]?.messageId : r?.messageId;
      if (id) messageIds.push({ key: t.key, id });
    } catch (e) {
      console.error('task publish', t.key, e && e.message);
      errors.push({ where: 'task', key: t.key, message: (e && e.message) || String(e) });
    }
  }

  return res.status(200).json({ ok: true, dailyScheduleId, messageIds, count: messageIds.length, errors });
}
