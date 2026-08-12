// api/plan-day.js — recebe um "despejo" de texto ("preciso gravar 3 vídeos, treinar, ir ao mercado")
// e devolve um PLANO do dia: várias tarefas com período, horário sugerido e prioridade.
// NÃO cria nada: o app mostra a proposta para o usuário aprovar. A chave ANTHROPIC_API_KEY fica só no servidor.
// Entrada (POST JSON): { text, date?:"YYYY-MM-DD", now?:"HH:MM" (hora local, só se date for hoje) }
// Saída (200): { ok:true, tasks:[{ task, period:"morning|afternoon|night", time:"HH:MM"|null, priority:"alta|media|baixa" }] }
// Erros: sempre { ok:false, error, message } — nunca derruba o app.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';
const PERIODS = ['morning', 'afternoon', 'night'];
const PRIORITIES = ['alta', 'media', 'baixa'];

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function periodFromTime(hhmm) {
  const h = Number(hhmm.split(':')[0]);
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  return 'night';
}
function extractJson(raw) {
  if (!raw) return null;
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let obj = tryParse(raw);
  if (obj) return obj;
  const fenced = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  obj = tryParse(fenced);
  if (obj) return obj;
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) obj = tryParse(raw.slice(a, b + 1));
  return obj || null;
}
function normTime(v) {
  if (typeof v !== 'string' || !/^\d{1,2}:\d{2}$/.test(v)) return null;
  const [h, m] = v.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method', message: 'Use POST.' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ ok: false, error: 'server-not-configured', message: 'IA indisponível: falta ANTHROPIC_API_KEY no servidor.' });
  }

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ ok: false, error: 'bad-json', message: 'Corpo da requisição inválido.' }); }

  const text = (body && typeof body.text === 'string') ? body.text.trim() : '';
  if (!text) return res.status(400).json({ ok: false, error: 'no-text', message: 'Escreva o que precisa fazer.' });
  if (text.length > 1000) return res.status(400).json({ ok: false, error: 'too-long', message: 'Texto muito longo (máx. 1000 caracteres).' });

  const today = todayInSaoPaulo();
  const date = (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) ? body.date : today;
  const isToday = date === today;
  const now = (isToday && typeof body.now === 'string' && /^\d{1,2}:\d{2}$/.test(body.now)) ? normTime(body.now) : null;

  const timeCtx = isToday
    ? `O plano é para HOJE. ${now ? `Agora são ${now} (hora local). Não agende nada antes disso; distribua a partir de agora.` : 'Distribua ao longo do dia a partir de já.'}`
    : `O plano é para uma data futura (${date}). Distribua ao longo do dia inteiro.`;

  const system =
`Você é um organizador do dia. Recebe uma frase/despejo em português com VÁRIAS coisas a fazer e transforma em um PLANO realista.
${timeCtx}
Períodos: morning (manhã, 05:00–11:59), afternoon (tarde, 12:00–17:59), night (noite, 18:00–23:59).
Regras:
- Separe em tarefas concretas e curtas (só o nome, sem data/horário embutido). Entre 1 e 12 tarefas. Se pedirem "3 vídeos", pode agrupar em uma tarefa "Gravar 3 vídeos" ou separar — use bom senso.
- Sugira um horário ("HH:MM", 24h) para as tarefas que fazem sentido ter horário; deixe time = null para as flexíveis. Espalhe os horários com folga entre eles (deixe respiro/pausas), evite empilhar tudo junto e evite sobrecarregar um só período.
- Defina priority para cada tarefa: "alta", "media" ou "baixa".
- Ordem sugerida = a ordem natural pelos horários.
Responda ESTRITAMENTE com um único objeto JSON válido, sem markdown, sem texto em volta, exatamente neste formato:
{"tasks":[{"task":<string>,"period":"morning|afternoon|night","time":"HH:MM"|null,"priority":"alta|media|baixa"}, ...]}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });

  let message;
  try {
    message = await client.messages.create(
      { model: MODEL, max_tokens: 900, system, messages: [{ role: 'user', content: text }] },
      { timeout: 14000 },
    );
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return res.status(502).json({ ok: false, error: 'auth', message: 'Chave de IA inválida no servidor.' });
    if (err instanceof Anthropic.PermissionDeniedError) return res.status(502).json({ ok: false, error: 'permission', message: 'Sem permissão ou saldo para usar a IA.' });
    if (err instanceof Anthropic.RateLimitError) return res.status(503).json({ ok: false, error: 'rate-limit', message: 'IA ocupada no momento. Tente de novo em instantes.' });
    if (err instanceof Anthropic.APIConnectionError) return res.status(504).json({ ok: false, error: 'timeout', message: 'A IA demorou a responder. Tente novamente.' });
    if (err?.status === 400 && /credit|balance|billing|insufficient/i.test(err?.message || '')) {
      return res.status(502).json({ ok: false, error: 'no-credit', message: 'Sem créditos de IA. Verifique o faturamento da conta Anthropic.' });
    }
    console.error('plan-day api error', err?.status, err?.message);
    return res.status(502).json({ ok: false, error: 'ai-failed', message: 'Não consegui montar o plano agora. Tente de novo.' });
  }

  if (message.stop_reason === 'refusal') return res.status(422).json({ ok: false, error: 'refusal', message: 'Não consegui processar esse texto.' });

  const raw = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const parsed = extractJson(raw);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    console.error('plan-day bad ai json:', raw.slice(0, 200));
    return res.status(422).json({ ok: false, error: 'bad-ai-json', message: 'A IA respondeu em formato inesperado. Tente de novo.' });
  }

  const tasks = [];
  for (const t of parsed.tasks) {
    if (!t || typeof t.task !== 'string' || !t.task.trim()) continue;
    const time = normTime(t.time);
    const period = PERIODS.includes(t.period) ? t.period : (time ? periodFromTime(time) : 'morning');
    const priority = PRIORITIES.includes(t.priority) ? t.priority : 'media';
    tasks.push({ task: t.task.trim().slice(0, 120), period, time, priority });
    if (tasks.length >= 12) break;
  }
  if (!tasks.length) return res.status(422).json({ ok: false, error: 'no-tasks', message: 'Não identifiquei tarefas nesse texto.' });

  return res.status(200).json({ ok: true, tasks });
}
