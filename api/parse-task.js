// api/parse-task.js — interpreta um texto livre em uma tarefa estruturada usando Claude (Haiku).
// A chave ANTHROPIC_API_KEY fica SÓ no servidor (Environment Variable do Vercel); nunca vai pro cliente.
// Entrada (POST JSON): { text: "reunião com cliente amanhã 14h", today?: "YYYY-MM-DD" }
// Saída (200): { ok:true, task:{ task, date, weekday, period, time } }
// Erros: sempre { ok:false, error:<código>, message:<texto claro pro front> } — nunca derruba o app.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5'; // o mais barato; suficiente para extração simples
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']; // getDay(): 0=domingo
const PERIODS = ['morning', 'afternoon', 'night'];

// data "de hoje" no fuso do Brasil (a função roda em UTC no Vercel; sem isso "hoje/amanhã" erram perto da meia-noite)
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

// Extrai o objeto JSON mesmo se o modelo escorregar (cercas de código, texto em volta).
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

// Valida e normaliza a resposta do modelo (defesa contra campos faltando/inválidos).
function normalize(p, today) {
  const task = (p && typeof p.task === 'string' && p.task.trim()) ? p.task.trim() : null;

  let date = (typeof p?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) ? p.date : today;
  if (date < today) date = today; // nunca agenda no passado

  let time = null;
  if (typeof p?.time === 'string' && /^\d{1,2}:\d{2}$/.test(p.time)) {
    const [h, m] = p.time.split(':').map(Number);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  let period = PERIODS.includes(p?.period) ? p.period : (time ? periodFromTime(time) : 'morning');

  const dow = new Date(date + 'T12:00:00').getDay();
  return { task, date, weekday: WEEKDAYS[dow], period, time };
}

export default async function handler(req, res) {
  // CORS (o app pode estar em outra origem — GitHub Pages + backend no Vercel)
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
  if (!text) return res.status(400).json({ ok: false, error: 'no-text', message: 'Escreva a tarefa em texto.' });
  if (text.length > 500) return res.status(400).json({ ok: false, error: 'too-long', message: 'Texto muito longo (máx. 500 caracteres).' });

  const today = (typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today)) ? body.today : todayInSaoPaulo();
  const hojeLabel = WEEKDAYS[new Date(today + 'T12:00:00').getDay()];

  const system =
`Você interpreta uma frase curta em português e extrai UMA tarefa de agenda.
Hoje é ${today} (${hojeLabel}). Resolva referências relativas ("hoje", "amanhã", "depois de amanhã", "sexta", "segunda que vem") para uma data concreta a partir de hoje — sempre hoje ou no futuro, nunca no passado.
Período (bloco):
- Com horário explícito: 05:00–11:59 = manhã (morning); 12:00–17:59 = tarde (afternoon); 18:00–04:59 = noite (night).
- Sem horário, infira pelo contexto ("de manhã"=morning, "à tarde"=afternoon, "à noite"/"hoje à noite"=night). Se nada indicar, use morning.
Responda ESTRITAMENTE com um único objeto JSON válido, sem markdown, sem comentários, sem texto antes ou depois, exatamente neste formato:
{"task": <string ou null>, "date": "YYYY-MM-DD", "weekday": "domingo|segunda|terça|quarta|quinta|sexta|sábado", "period": "morning|afternoon|night", "time": "HH:MM" ou null}
"task" é apenas o nome da tarefa, sem a parte de data/horário. Se não houver uma tarefa clara no texto, retorne "task": null.`;

  // Instância local (após checar a env, pra não estourar no import se faltar a chave).
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });

  let message;
  try {
    message = await client.messages.create(
      { model: MODEL, max_tokens: 300, system, messages: [{ role: 'user', content: text }] },
      { timeout: 9000 }, // curto pra não pendurar a função serverless
    );
  } catch (err) {
    // mapeia falhas da API para mensagens claras, sem vazar detalhes internos
    if (err instanceof Anthropic.AuthenticationError) return res.status(502).json({ ok: false, error: 'auth', message: 'Chave de IA inválida no servidor.' });
    if (err instanceof Anthropic.PermissionDeniedError) return res.status(502).json({ ok: false, error: 'permission', message: 'Sem permissão ou saldo para usar a IA.' });
    if (err instanceof Anthropic.RateLimitError) return res.status(503).json({ ok: false, error: 'rate-limit', message: 'IA ocupada no momento. Tente de novo em instantes.' });
    if (err instanceof Anthropic.APIConnectionError) return res.status(504).json({ ok: false, error: 'timeout', message: 'A IA demorou a responder. Tente novamente.' });
    if (err?.status === 400 && /credit|balance|billing|insufficient/i.test(err?.message || '')) {
      return res.status(502).json({ ok: false, error: 'no-credit', message: 'Sem créditos de IA. Verifique o faturamento da conta Anthropic.' });
    }
    console.error('parse-task api error', err?.status, err?.message);
    return res.status(502).json({ ok: false, error: 'ai-failed', message: 'Não consegui interpretar agora. Tente reformular.' });
  }

  if (message.stop_reason === 'refusal') {
    return res.status(422).json({ ok: false, error: 'refusal', message: 'Não consegui processar esse texto.' });
  }

  const raw = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const parsed = extractJson(raw);
  if (!parsed) {
    console.error('parse-task bad ai json:', raw.slice(0, 200));
    return res.status(422).json({ ok: false, error: 'bad-ai-json', message: 'A IA respondeu em formato inesperado. Tente de novo.' });
  }

  const task = normalize(parsed, today);
  if (!task.task) return res.status(422).json({ ok: false, error: 'no-task', message: 'Não identifiquei uma tarefa nesse texto.' });

  return res.status(200).json({ ok: true, task });
}
