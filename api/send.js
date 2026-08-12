// api/send.js — recebe o callback do QStash e envia o Web Push.
// Protegido por um segredo compartilhado (?key=SEND_SECRET) que só o /api/schedule conhece.
import webpush from 'web-push';

const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:organizador@example.com';
if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) {
  webpush.setVapidDetails(SUBJECT, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!process.env.SEND_SECRET || req.query.key !== process.env.SEND_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { subscription, notification } = body || {};
    if (!subscription || !notification) return res.status(400).json({ error: 'payload' });

    await webpush.sendNotification(subscription, JSON.stringify(notification));
    return res.status(200).json({ ok: true });
  } catch (err) {
    const code = err && err.statusCode;
    // 404/410 = inscrição expirada/removida; responde 200 pro QStash não ficar reentregando
    if (code === 404 || code === 410) return res.status(200).json({ ok: false, gone: true });
    console.error('send error', code, err && err.body);
    return res.status(500).json({ error: 'send-failed' });
  }
}
