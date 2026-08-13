// api/finance-report.js — Conselheiro financeiro semanal do Ritmo (Etapa 9).
// Lê o estado do usuário (tabela user_state) via SERVICE ROLE, calcula os números
// da semana e gera uma análise com a Claude (com fallback local). Salva em finance_reports.
// Protegido por SEND_SECRET. Roda pelo QStash (domingo 22h) ou manualmente ({ test:true }).
// Segredos (SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY, SEND_SECRET) ficam SÓ no servidor.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';
const TZ = 'America/Sao_Paulo';

function ymdInTZ(date) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function addDays(ymd, n) { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function brl(n) { return 'R$ ' + (Math.round(n * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function inRange(d, a, b) { return typeof d === 'string' && d >= a && d <= b; }

function computeFinance(fin, today) {
  fin = fin || {};
  const tx = Array.isArray(fin.tx) ? fin.tx : [];
  const bills = Array.isArray(fin.bills) ? fin.bills : [];
  const goals = Array.isArray(fin.goals) ? fin.goals : [];
  const wStart = addDays(today, -6), pStart = addDays(today, -13), pEnd = addDays(today, -7);
  const amt = (t) => (typeof t.amount === 'number' ? t.amount : parseFloat(t.amount) || 0);

  let incWeek = 0, expWeek = 0, incPrev = 0, expPrev = 0, incAll = 0, expAll = 0;
  const cats = {};
  for (const t of tx) {
    const a = amt(t); const isInc = t.type === 'income';
    if (isInc) incAll += a; else expAll += a;
    if (inRange(t.date, wStart, today)) { if (isInc) incWeek += a; else { expWeek += a; const c = t.category || 'Outros'; cats[c] = (cats[c] || 0) + a; } }
    if (inRange(t.date, pStart, pEnd)) { if (isInc) incPrev += a; else expPrev += a; }
  }
  const unpaidBills = bills.filter((b) => !b.paid);
  const billsFuture = unpaidBills.reduce((s, b) => s + (typeof b.amount === 'number' ? b.amount : parseFloat(b.amount) || 0), 0);
  const upcoming = unpaidBills
    .filter((b) => b.dueDate && b.dueDate >= today && b.dueDate <= addDays(today, 7))
    .map((b) => ({ text: b.text, amount: b.amount, dueDate: b.dueDate }));

  const saldoAtual = incAll - expAll;             // só realizado
  const saldoPrevisto = saldoAtual - billsFuture; // menos contas ainda não pagas
  const savedWeek = incWeek - expWeek;
  const savedPct = incWeek > 0 ? Math.round((savedWeek / incWeek) * 100) : null;
  const topCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => ({ cat: k, amount: v }));

  return {
    period_start: wStart, period_end: today,
    incWeek, expWeek, savedWeek, savedPct,
    incPrev, expPrev,
    saldoAtual, saldoPrevisto, billsFuture,
    upcoming, topCats,
    goals: goals.map((g) => ({ text: g.text, target: g.targetAmount, current: g.currentAmount })),
    hasData: tx.length > 0 || bills.length > 0,
  };
}

function localSummary(n) {
  const parts = [];
  parts.push(`Esta semana entraram ${brl(n.incWeek)} e saíram ${brl(n.expWeek)}.`);
  if (n.savedPct != null) parts.push(`Você preservou cerca de ${n.savedPct}% das entradas.`);
  parts.push(`Saldo atual ${brl(n.saldoAtual)}; com as contas previstas, ${brl(n.saldoPrevisto)}.`);
  if (n.topCats.length) parts.push(`Maior gasto: ${n.topCats[0].cat} (${brl(n.topCats[0].amount)}).`);
  let sug = 'Sugestão: separe uma parte das entradas assim que elas caem, antes de gastar.';
  if (n.saldoPrevisto < n.saldoAtual) sug = `Sugestão: reserve ${brl(Math.max(0, n.saldoAtual - n.billsFuture) * 0.1)} agora e segure gastos não essenciais até as contas previstas (${brl(n.billsFuture)}) serem pagas.`;
  return parts.join(' ') + '\n\n' + sug;
}

async function generateAdvice(n) {
  if (!process.env.ANTHROPIC_API_KEY) return { content: localSummary(n), source: 'local' };
  const data = {
    entradas_semana: n.incWeek, gastos_semana: n.expWeek, guardou_semana: n.savedWeek, guardou_pct: n.savedPct,
    entradas_semana_passada: n.incPrev, gastos_semana_passada: n.expPrev,
    saldo_atual: n.saldoAtual, saldo_previsto: n.saldoPrevisto, contas_previstas_total: n.billsFuture,
    contas_proximas: n.upcoming, maiores_categorias: n.topCats, metas: n.goals,
  };
  const system = `Você é o conselheiro financeiro do app Ritmo (pt-BR). O objetivo do usuário é GUARDAR DINHEIRO. Analise os números REAIS da semana e escreva uma análise curta (3-5 frases) + UMA sugestão concreta. Seja específico e baseado nos números; nada de frases genéricas como "gaste menos" ou "economize mais". Valores em reais. Formato: um parágrafo de análise, depois uma linha em branco, depois "Sugestão: ..." com uma ação prática e mensurável. Não invente números além dos fornecidos.`;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });
    const msg = await client.messages.create(
      { model: MODEL, max_tokens: 380, system, messages: [{ role: 'user', content: 'Números da semana (JSON):\n' + JSON.stringify(data) }] },
      { timeout: 9000 },
    );
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (text) return { content: text, source: 'claude' };
  } catch (e) { /* cai no fallback */ }
  return { content: localSummary(n), source: 'local' };
}

async function sbFetch(path, opts = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/' + path, {
    ...opts,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const txt = await r.text();
  let json = null; try { json = txt ? JSON.parse(txt) : null; } catch {}
  return { ok: r.ok, status: r.status, json, txt };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-report-secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'server-not-configured', message: 'Faltam SUPABASE_URL e/ou SUPABASE_SECRET_KEY no servidor.' });

  let body; try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch { body = {}; }
  const secret = req.headers['x-report-secret'] || body.secret;
  if (process.env.SEND_SECRET && secret !== process.env.SEND_SECRET) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const today = ymdInTZ(new Date());

  // Alvos: um usuário específico (teste) ou todos os aprovados.
  let targets = [];
  if (body.userId) {
    targets = [{ id: body.userId }];
  } else {
    const prof = await sbFetch('profiles?select=id,name&status=eq.approved');
    if (!prof.ok) return res.status(502).json({ ok: false, error: 'profiles-failed', status: prof.status, detail: prof.txt });
    targets = prof.json || [];
  }

  const results = [];
  for (const u of targets) {
    const st = await sbFetch('user_state?select=data&user_id=eq.' + encodeURIComponent(u.id));
    const stateRow = (st.json && st.json[0]) ? st.json[0].data : null;
    const fin = stateRow && stateRow.finance ? stateRow.finance : {};
    const numbers = computeFinance(fin, today);
    const advice = await generateAdvice(numbers);

    const row = {
      user_id: u.id,
      period_start: numbers.period_start,
      period_end: numbers.period_end,
      content: advice.content,
      data: numbers,
    };
    // upsert por (user_id, period_end) evitaria duplicar; aqui inserimos sempre (histórico).
    const ins = await sbFetch('finance_reports', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
    results.push({ user_id: u.id, saved: ins.ok, source: advice.source, hasData: numbers.hasData, status: ins.status, error: ins.ok ? null : ins.txt });
  }

  return res.status(200).json({ ok: true, date: today, count: results.length, results, test: !!body.test });
}
