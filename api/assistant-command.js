// api/assistant-command.js — o cérebro do assistente global da Fase 2.
// Recebe uma frase livre em português e devolve UMA intenção estruturada (tarefas, finanças, ajustes ou consulta).
// NÃO executa nada: o app (cliente) é quem aplica, pedindo confirmação nas ações maiores.
// A chave ANTHROPIC_API_KEY fica SÓ no servidor. Falhas sempre voltam como { ok:false, error, message } — nunca derruba a UI.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const PERIODS = ['morning', 'afternoon', 'night'];
const INTENTS = [
  'create_task', 'move_task', 'delete_task', 'create_goal', 'query_today', 'query_tomorrow', 'organize_day',
  'create_expense', 'create_income', 'create_bill', 'create_finance_goal', 'query_finance_summary',
  'change_theme_color', 'toggle_setting', 'unknown',
];
const SETTINGS = ['voice', 'suggestions', 'short_answers', 'bill_reminders', 'finance_hoje'];
const COLORS = ['roxo', 'azul', 'verde'];

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function periodFromTime(hhmm) { const h = Number(hhmm.split(':')[0]); if (h >= 5 && h < 12) return 'morning'; if (h >= 12 && h < 18) return 'afternoon'; return 'night'; }
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
function normDate(v, today) { return (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null; }
function normTime(v) {
  if (typeof v !== 'string' || !/^\d{1,2}:\d{2}$/.test(v)) return null;
  const [h, m] = v.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function normAmount(v) {
  if (typeof v === 'number' && isFinite(v)) return v > 0 ? Math.round(v * 100) / 100 : 0;
  if (typeof v === 'string') { const n = parseFloat(v.replace(/\./g, '').replace(',', '.')); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; }
  return 0;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method', message: 'Use POST.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ ok: false, error: 'server-not-configured', message: 'IA indisponível: falta ANTHROPIC_API_KEY no servidor.' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ ok: false, error: 'bad-json', message: 'Corpo da requisição inválido.' }); }

  const text = (body && typeof body.text === 'string') ? body.text.trim() : '';
  if (!text) return res.status(400).json({ ok: false, error: 'no-text', message: 'Fale ou escreva algo.' });
  if (text.length > 600) return res.status(400).json({ ok: false, error: 'too-long', message: 'Texto muito longo.' });

  const today = normDate(body.today) || todayInSaoPaulo();
  const now = normTime(body.now);
  const hojeLabel = WEEKDAYS[new Date(today + 'T12:00:00').getDay()];

  const system =
`Você é o assistente de um app pessoal de organização e finanças (em português do Brasil). Interprete a frase do usuário e devolva UMA intenção estruturada. NÃO converse; só classifique e extraia dados.
Hoje é ${today} (${hojeLabel})${now ? `, agora são ${now}` : ''}. Resolva datas relativas ("hoje", "amanhã", "sexta", "dia 15") para AAAA-MM-DD, sempre hoje ou no futuro.
Períodos: morning (05:00–11:59), afternoon (12:00–17:59), night (18:00–04:59).
Valores em dinheiro: devolva "amount" como NÚMERO puro em reais (ex: 42 para "R$ 42", 1200 para "mil e duzentos"), sem símbolo, sem separador de milhar.

Intenções possíveis e seus campos:
- create_task: { task, date, period, time(ou null) } — criar tarefa/compromisso.
- move_task: { query, to } — mover uma tarefa existente (query = nome dela, to = data destino).
- delete_task: { query } — apagar uma tarefa.
- create_goal: { text, goalType("bool" ou "counter"), target(int ou null) } — meta da semana (não financeira).
- query_today: {} — "o que tenho hoje / o que falta".
- query_tomorrow: {} — "o que tenho amanhã".
- organize_day: {} — "organize meu dia", "reorganiza minhas tarefas".
- create_expense: { text, amount, category(ou null), date } — registrar um gasto.
- create_income: { text, amount, date } — registrar uma entrada/receita.
- create_bill: { text, amount, dueDate(ou null), remindBeforeDays(int, padrão 1) } — cadastrar uma conta a pagar.
- create_finance_goal: { text, targetAmount, currentAmount(ou 0) } — meta financeira (guardar dinheiro).
- query_finance_summary: {} — "quanto gastei/entrou/sobrou esse mês".
- change_theme_color: { color("roxo"|"azul"|"verde") } — trocar a cor do app.
- toggle_setting: { setting("voice"|"suggestions"|"short_answers"|"bill_reminders"|"finance_hoje"), value(true/false) } — ligar/desligar um ajuste.
- unknown: { message } — se não der pra mapear; message = frase curta e humana pedindo pra reformular.

Regras:
- Escolha a intenção MAIS provável. "task"/"text" devem conter só o nome, sem data/valor embutidos.
- Gasto = saída de dinheiro; entrada/recebi/salário/venda = income; conta a pagar com vencimento = create_bill.
Responda ESTRITAMENTE com um único objeto JSON válido, sem markdown, no formato: {"intent": "<uma das intenções>", ...campos...}.`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });
  let message;
  try {
    message = await client.messages.create(
      { model: MODEL, max_tokens: 400, system, messages: [{ role: 'user', content: text }] },
      { timeout: 10000 },
    );
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return res.status(502).json({ ok: false, error: 'auth', message: 'Chave de IA inválida no servidor.' });
    if (err instanceof Anthropic.PermissionDeniedError) return res.status(502).json({ ok: false, error: 'permission', message: 'Sem permissão ou saldo para usar a IA.' });
    if (err instanceof Anthropic.RateLimitError) return res.status(503).json({ ok: false, error: 'rate-limit', message: 'Assistente ocupado. Tente de novo em instantes.' });
    if (err instanceof Anthropic.APIConnectionError) return res.status(504).json({ ok: false, error: 'timeout', message: 'A IA demorou a responder. Tente de novo.' });
    if (err?.status === 400 && /credit|balance|billing|insufficient/i.test(err?.message || '')) return res.status(502).json({ ok: false, error: 'no-credit', message: 'Sem créditos de IA. Verifique o faturamento da conta Anthropic.' });
    console.error('assistant-command api error', err?.status, err?.message);
    return res.status(502).json({ ok: false, error: 'ai-failed', message: 'Não consegui entender agora. Tente de novo.' });
  }
  if (message.stop_reason === 'refusal') return res.status(422).json({ ok: false, error: 'refusal', message: 'Não consegui processar isso.' });

  const raw = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const p = extractJson(raw);
  if (!p || !INTENTS.includes(p.intent)) {
    console.error('assistant-command bad ai json:', raw.slice(0, 200));
    return res.status(200).json({ ok: true, intent: 'unknown', message: 'Não entendi. Tente falar de outro jeito.' });
  }

  // normalização por intenção (defesa contra campos inválidos)
  const out = { ok: true, intent: p.intent };
  switch (p.intent) {
    case 'create_task': {
      const task = (typeof p.task === 'string' && p.task.trim()) ? p.task.trim().slice(0, 120) : null;
      if (!task) return res.status(200).json({ ok: true, intent: 'unknown', message: 'Qual é a tarefa?' });
      out.task = task;
      out.time = normTime(p.time);
      out.date = normDate(p.date) && p.date >= today ? p.date : today;
      out.period = PERIODS.includes(p.period) ? p.period : (out.time ? periodFromTime(out.time) : 'morning');
      break;
    }
    case 'move_task': out.query = String(p.query || p.task || '').slice(0, 120); out.to = normDate(p.to) || null; break;
    case 'delete_task': out.query = String(p.query || p.task || '').slice(0, 120); break;
    case 'create_goal':
      out.text = String(p.text || p.task || '').trim().slice(0, 120) || null;
      out.goalType = p.goalType === 'counter' ? 'counter' : 'bool';
      out.target = out.goalType === 'counter' ? Math.max(1, parseInt(p.target, 10) || 1) : null;
      if (!out.text) return res.status(200).json({ ok: true, intent: 'unknown', message: 'Qual é a meta?' });
      break;
    case 'create_expense':
    case 'create_income':
      out.amount = normAmount(p.amount);
      out.text = String(p.text || p.task || '').trim().slice(0, 80);
      out.date = normDate(p.date) || today;
      if (p.intent === 'create_expense') out.category = (typeof p.category === 'string' && p.category.trim()) ? p.category.trim().slice(0, 40) : null;
      if (!out.amount) return res.status(200).json({ ok: true, intent: 'unknown', message: 'Qual foi o valor?' });
      break;
    case 'create_bill':
      out.amount = normAmount(p.amount);
      out.text = String(p.text || p.task || 'Conta').trim().slice(0, 80);
      out.dueDate = normDate(p.dueDate);
      out.remindBeforeDays = Number.isFinite(p.remindBeforeDays) ? Math.max(0, Math.min(30, Math.round(p.remindBeforeDays))) : 1;
      break;
    case 'create_finance_goal':
      out.targetAmount = normAmount(p.targetAmount || p.amount);
      out.text = String(p.text || p.task || 'Meta').trim().slice(0, 80);
      out.currentAmount = normAmount(p.currentAmount);
      if (!out.targetAmount) return res.status(200).json({ ok: true, intent: 'unknown', message: 'Qual o valor da meta?' });
      break;
    case 'change_theme_color': {
      const c = String(p.color || '').toLowerCase();
      out.color = COLORS.includes(c) ? c : (c.includes('rox') || c.includes('purp') ? 'roxo' : c.includes('az') || c.includes('blue') ? 'azul' : c.includes('verd') || c.includes('green') || c.includes('jade') ? 'verde' : null);
      if (!out.color) return res.status(200).json({ ok: true, intent: 'unknown', message: 'Conheço só roxo, azul e verde.' });
      break;
    }
    case 'toggle_setting':
      out.setting = SETTINGS.includes(p.setting) ? p.setting : null;
      out.value = !!p.value;
      if (!out.setting) return res.status(200).json({ ok: true, intent: 'unknown', message: 'Não sei mudar esse ajuste.' });
      break;
    case 'unknown':
      out.message = (typeof p.message === 'string' && p.message.trim()) ? p.message.trim().slice(0, 160) : 'Não entendi. Tente de outro jeito.';
      break;
    // query_today / query_tomorrow / query_finance_summary / organize_day: sem campos extras
  }
  return res.status(200).json(out);
}
