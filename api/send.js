// api/send.js — recebe o callback do QStash e envia o Web Push.
// Protegido por um segredo compartilhado (?key=SEND_SECRET) que só o /api/schedule conhece.
//
// Texto gerado por IA (opcional): se a notificação trouxer `gen` (contexto) e houver
// ANTHROPIC_API_KEY, tenta gerar o corpo com Claude num TIMEOUT CURTO (~3s). Se a IA falhar
// ou demorar, mantém o `body` já embutido (frase do banco). A IA JAMAIS impede o envio:
// prioridade absoluta = a notificação chegar.
import webpush from 'web-push';

const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:organizador@example.com';
if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) {
  webpush.setVapidDetails(SUBJECT, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
}

const AI_MODEL = 'claude-haiku-4-5';
const AI_TIMEOUT_MS = 3000;

function promptFor(gen) {
  const streak = Number.isFinite(gen.streak) ? gen.streak : 0;
  const done = Number.isFinite(gen.doneToday) ? gen.doneToday : null;
  const total = Number.isFinite(gen.totalToday) ? gen.totalToday : null;
  const prog = (done != null && total != null) ? `Concluídas hoje: ${done}/${total}.` : '';
  const streakTxt = streak > 0 ? `Sequência atual: ${streak} dias seguidos.` : 'Sem sequência ativa no momento.';
  const common = `Escreva UMA notificação push em português do Brasil, curta (1 frase, no máx. 2), tom rigoroso e motivador, cobrança direta. Sem emojis, sem clichês, sem aspas, sem hashtags. Não repita o horário nem o nome da tarefa se já aparecem no título. Responda só com o texto da notificação.`;
  switch (gen.type) {
    case 'taskReminder':
      return `${common}\nContexto: está quase na hora da tarefa "${gen.task || ''}"${gen.time ? ` (${gen.time})` : ''}. ${streakTxt} ${prog}`.trim();
    case 'dailyReminder':
      return `${common}\nContexto: é o lembrete do início do dia para organizar as tarefas. ${streakTxt}`.trim();
    case 'streakRisk':
      return `${common}\nContexto: o dia está terminando e ainda há tarefas pendentes; a sequência está em risco. ${streakTxt} ${prog}`.trim();
    case 'dayComplete':
      return `${common}\nContexto: o usuário concluiu 100% das tarefas do dia. ${streakTxt}`.trim();
    case 'weeklySummary':
      return `${common}\nContexto: é domingo, hora de revisar a semana que passou. ${streakTxt}`.trim();
    default:
      return null;
  }
}

// Gera o corpo com Claude, com timeout duro. Retorna string ou null (nunca lança).
async function generateBody(gen) {
  try {
    if (!gen || !gen.type || !process.env.ANTHROPIC_API_KEY) return null;
    const prompt = promptFor(gen);
    if (!prompt) return null;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
    const call = client.messages.create(
      { model: AI_MODEL, max_tokens: 80, messages: [{ role: 'user', content: prompt }] },
      { timeout: AI_TIMEOUT_MS },
    );
    const guard = new Promise((resolve) => setTimeout(() => resolve(null), AI_TIMEOUT_MS + 200));
    const message = await Promise.race([call, guard]);
    if (!message || message.stop_reason === 'refusal') return null;
    const raw = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const clean = raw.replace(/^["“”']|["“”']$/g, '').trim();
    if (!clean || clean.length > 200) return null;
    return clean;
  } catch (e) {
    return null; // qualquer erro → usa o fallback do banco de frases
  }
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

    // tenta IA (best-effort, timeout curto); mantém o body embutido como fallback garantido
    let body_ = notification.body;
    if (notification.gen) {
      const aiBody = await generateBody(notification.gen);
      if (aiBody) body_ = aiBody;
    }
    // remove o contexto `gen` antes de enviar (não é preciso no cliente e enxuga o payload)
    const { gen, ...rest } = notification;
    const finalNotification = { ...rest, body: body_ };

    await webpush.sendNotification(subscription, JSON.stringify(finalNotification));
    return res.status(200).json({ ok: true });
  } catch (err) {
    const code = err && err.statusCode;
    if (code === 404 || code === 410) return res.status(200).json({ ok: false, gone: true });
    console.error('send error', code, err && err.body);
    return res.status(500).json({ error: 'send-failed' });
  }
}
