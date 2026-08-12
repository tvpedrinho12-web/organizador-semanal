// api/organize-day.js — recebe as tarefas pendentes de um dia e propõe uma organização
// (horários/períodos sugeridos) usando Claude. NÃO altera nada: só devolve uma proposta que o
// app mostra para o usuário aprovar. A chave ANTHROPIC_API_KEY fica só no servidor.
// Entrada (POST JSON): { items:[{id, task, time|null, period}], today?, date? }
// Saída (200): { ok:true, changes:[{ id, time:"HH:MM"|null, period:"morning|afternoon|night" }] }
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';
const PERIODS = ['morning', 'afternoon', 'night'];

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
  catch { return res.status(400).json({ ok: false, error: 'bad-json', message: 'Corpo inválido.' }); }

  const items = Array.isArray(body.items) ? body.items.filter((i) => i && i.id && typeof i.task === 'string') : [];
  if (items.length < 2) return res.status(400).json({ ok: false, error: 'too-few', message: 'Poucas tarefas para organizar.' });
  if (items.length > 40) return res.status(400).json({ ok: false, error: 'too-many', message: 'Tarefas demais para organizar de uma vez.' });

  const list = items.map((i) => ({ id: String(i.id), task: String(i.task).slice(0, 120), time: (typeof i.time === 'string' ? i.time : null), period: PERIODS.includes(i.period) ? i.period : 'morning' }));

  const system =
`Você organiza a agenda de UM dia. Recebe uma lista de tarefas (com id, nome, horário atual e período).
Períodos: morning (manhã, 05:00–11:59), afternoon (tarde, 12:00–17:59), night (noite, 18:00–23:59).
Sugira uma distribuição realista e equilibrada ao longo do dia: espalhe os horários, evite conflitos e sobrecarga em um só período, respeite horários já definidos quando fizerem sentido.
Regras:
- Mantenha EXATAMENTE os mesmos ids recebidos. Não invente nem remova tarefas.
- Para cada tarefa devolva o horário sugerido ("HH:MM" em 24h) ou null se ela não precisar de horário, e o período coerente com o horário.
- Se uma tarefa já está bem posicionada, devolva os mesmos valores dela.
Responda ESTRITAMENTE com um único objeto JSON válido, sem markdown, sem texto em volta, no formato:
{"changes":[{"id":"<id>","time":"HH:MM"|null,"period":"morning|afternoon|night"}, ...]}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });

  let message;
  try {
    message = await client.messages.create(
      { model: MODEL, max_tokens: 700, system, messages: [{ role: 'user', content: JSON.stringify({ tasks: list }) }] },
      { timeout: 12000 },
    );
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return res.status(502).json({ ok: false, error: 'auth', message: 'Chave de IA inválida no servidor.' });
    if (err instanceof Anthropic.PermissionDeniedError) return res.status(502).json({ ok: false, error: 'permission', message: 'Sem permissão ou saldo para usar a IA.' });
    if (err instanceof Anthropic.RateLimitError) return res.status(503).json({ ok: false, error: 'rate-limit', message: 'IA ocupada. Tente de novo em instantes.' });
    if (err instanceof Anthropic.APIConnectionError) return res.status(504).json({ ok: false, error: 'timeout', message: 'A IA demorou a responder. Tente novamente.' });
    console.error('organize-day api error', err?.status, err?.message);
    return res.status(502).json({ ok: false, error: 'ai-failed', message: 'Não consegui organizar agora. Tente de novo.' });
  }

  if (message.stop_reason === 'refusal') return res.status(422).json({ ok: false, error: 'refusal', message: 'Não consegui processar.' });

  const raw = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const parsed = extractJson(raw);
  if (!parsed || !Array.isArray(parsed.changes)) {
    console.error('organize-day bad ai json:', raw.slice(0, 200));
    return res.status(422).json({ ok: false, error: 'bad-ai-json', message: 'A IA respondeu em formato inesperado.' });
  }

  const validIds = new Set(list.map((i) => i.id));
  const changes = [];
  for (const c of parsed.changes) {
    if (!c || !validIds.has(String(c.id))) continue;
    let time = null;
    if (typeof c.time === 'string' && /^\d{1,2}:\d{2}$/.test(c.time)) {
      const [h, m] = c.time.split(':').map(Number);
      if (h >= 0 && h < 24 && m >= 0 && m < 60) time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    const period = PERIODS.includes(c.period) ? c.period : (time ? (Number(time.split(':')[0]) < 12 ? 'morning' : (Number(time.split(':')[0]) < 18 ? 'afternoon' : 'night')) : 'morning');
    changes.push({ id: String(c.id), time, period });
  }

  return res.status(200).json({ ok: true, changes });
}
