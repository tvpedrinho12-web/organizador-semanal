/* phrases.js — banco fixo de frases para notificações e avisos.
   100% local: arrays no código, sem API nem IA. Tom: cobrança direta, disciplina,
   empurra pra ação — sério, nunca desmotivando de verdade.
   Rotação: sorteia evitando repetir as últimas N frases usadas por categoria
   (histórico curto em localStorage, separado do estado do app pra não gerar resync de push). */
(function (global) {
  'use strict';

  const BANK = {
    // ---- Antes da tarefa (o horário é mostrado à parte) — 25 ----
    taskReminder: [
      'Está no horário. Levanta e faz.',
      'Chegou a hora. Sem enrolação.',
      'Combinado é combinado. Executa agora.',
      'O relógio não espera. Você também não devia.',
      'Menos deliberação, mais ação. Vai.',
      'Isso não vai se fazer sozinho. Assume.',
      'Você marcou esse horário por um motivo. Honra ele.',
      'Adiar agora é dívida pra depois. Faz.',
      'Foco. Uma tarefa, agora, até o fim.',
      'Sem "daqui a pouco". O pouco é agora.',
      'Disciplina é fazer mesmo sem vontade. Começa.',
      'Você no controle, não o impulso. Executa.',
      'A versão que você quer ser faz isso agora.',
      'Tira do papel. O plano só vale se virar ação.',
      'Nada de meia-boca. Faz direito e fecha.',
      'Cada tarefa cumprida é uma promessa mantida.',
      'Para de olhar a tela. Isso aqui é mais importante.',
      'O horário é esse. Prova pra você mesmo que dá.',
      'Bloqueia o resto. Só existe essa tarefa agora.',
      'Resultado vem de constância, não de humor. Vai.',
      'Você já sabe o que fazer. Então faz.',
      'Sem desculpa pronta. Levanta e resolve.',
      'Começa agora e o resto do dia fica mais leve.',
      'Cinco minutos de ação valem mais que uma hora pensando. Começa.',
      'Fecha essa tarefa antes que ela vire peso.',
    ],

    // ---- Lembrete diário (abrir o app / organizar) — 20 ----
    dailyReminder: [
      'Dia novo. Define suas prioridades antes que ele te defina.',
      'Abre o app e desenha o dia. Improviso não constrói nada.',
      'Quem não planeja o dia obedece o dia dos outros.',
      'Antes de começar, decide o que importa hoje.',
      'Sem plano, todo esforço vira dispersão. Organiza-se.',
      'O dia rende quando você manda nele. Começa agora.',
      'Cinco minutos organizando poupam horas depois.',
      'Escolhe suas batalhas de hoje. Depois executa.',
      'Metas na frente, distrações atrás. Abre e ajusta.',
      'Você tem 24 horas como todo mundo. A diferença é o plano.',
      'Não deixa o dia começar no automático. Assume o comando.',
      'Define o alvo agora, ou vai atirar pra todo lado.',
      'Começa o dia decidindo, não reagindo.',
      'O que não está na lista não acontece. Preenche.',
      'Disciplina começa cedo. Organiza antes de agir.',
      'Prioridade não se descobre no meio do caos. Define agora.',
      'Um dia planejado é meio dia vencido.',
      'Sem clareza não há progresso. Abre e clareia.',
      'Hoje é matéria-prima. O que você vai construir?',
      'Toma a frente do seu dia antes que ele tome a sua.',
    ],

    // ---- Quando o streak quebra — 20 ----
    streakBreak: [
      'A sequência caiu. Não discute com o fato — recomeça hoje.',
      'Quebrou. Acontece. O que não pode é virar hábito.',
      'Um dia perdido não apaga o progresso. Voltar, sim.',
      'Caiu a corrente. Reconstrói a partir de agora.',
      'Sem lamento. A próxima sequência começa neste dia.',
      'Você parou. Agora a única pergunta é: recomeça quando?',
      'Zerou o contador, não zerou você. Volta pra linha.',
      'Falhar é dado, desistir é escolha. Não escolhe isso.',
      'A sequência era boa. Prova que consegue de novo.',
      'Perdeu o ritmo. Retomar cedo dói menos que retomar tarde.',
      'Recomeçar no mesmo dia é o que separa quem leva a sério.',
      'O streak quebrou. Sua disciplina não precisa quebrar junto.',
      'Cada recomeço te ensina a cair menos. Recomeça.',
      'Não foi o fim. Foi um lembrete pra manter a guarda.',
      'A régua continua a mesma. Volta a cumprir.',
      'Deixou a peteca cair. Levanta e joga de novo.',
      'Sequência interrompida. Começa a próxima antes de dormir.',
      'O passado já era. O contador de hoje ainda está aberto.',
      'Você sabe o que faltou. Corrige e segue.',
      'Quebra faz parte. Reincidência não. Ajusta agora.',
    ],

    // ---- Quando completa 100% do dia — 20 ----
    dayComplete: [
      'Dia fechado. É assim que se constrói.',
      'Tudo cumprido. Sem desculpas hoje.',
      'Fez o combinado até o fim. Anota essa.',
      'Dia 100%. A constância agradece.',
      'Mais um dia em que você mandou, não obedeceu.',
      'Executou tudo. Isso é disciplina, não sorte.',
      'Fechou a lista. Amanhã se cobra o mesmo.',
      'Dia completo. Repete isso e vira quem você quer ser.',
      'Zero pendências. Esse é o padrão, não a exceção.',
      'Cumpriu o dia. Descansa sabendo que mereceu.',
      'Feito. Agora não estraga o de amanhã.',
      'Dia limpo. Progresso não é barulho, é isso aqui.',
      'Bateu tudo. A régua sobe a partir de agora.',
      'Constância é isso: mais um dia no lugar certo.',
      'Fechou 100%. Um tijolo a mais na sua rotina.',
      'Nenhuma tarefa ficou pra trás. Respeito.',
      'Você fez o que disse que faria. Raro. Mantém.',
      'Dia vencido no detalhe. É o acúmulo que conta.',
      'Lista zerada. Amanhã a página vira, a cobrança não.',
      'Cumpriu por inteiro. Agora transforma isso em hábito.',
    ],

    // ---- Resumo semanal de domingo — 15 ----
    weeklySummary: [
      'Semana encerrada. Olha os números e ajusta o que falhou.',
      'Fecha a semana com honestidade. O que ficou pra trás?',
      'Sete dias passaram. Eles renderam ou escorreram?',
      'Revisão de domingo: sem se enganar, sem se punir.',
      'O que funcionou, repete. O que falhou, corrige.',
      'Semana no retrovisor. A próxima começa na sua decisão.',
      'Números não mentem. Encara o placar da semana.',
      'Antes de recomeçar, entende onde perdeu tempo.',
      'Domingo é balanço, não fuga. Olha pra semana.',
      'Você foi dono da semana ou passageiro dela?',
      'Fecha o ciclo. Aprende com ele e parte pro próximo.',
      'Semana avaliada é semana que ensina. Revisa.',
      'O padrão da semana vira o padrão da sua vida. Cuida dele.',
      'Sem revisão não há evolução. Olha pra trás uma vez.',
      'Encerrou a semana. Define agora como a próxima será melhor.',
    ],

    // ---- Bônus: streak em risco (fim de dia, dia não fechado) — 10 ----
    streakRisk: [
      'O dia está acabando e a lista não. Fecha o que falta.',
      'Sua sequência está em risco. Ainda dá tempo de salvar.',
      'Faltam tarefas e faltam horas. Corre atrás agora.',
      'Não perde hoje por preguiça de fim de dia. Termina.',
      'A noite não é desculpa. Cumpre o que resta.',
      'Streak em risco. Uma última investida resolve.',
      'Você chegou longe. Não joga fora por causa de hoje.',
      'Ainda dá. Levanta e fecha o dia antes que zere.',
      'O contador ainda está de pé. Mantém ele assim.',
      'Últimas horas. Decide: mantém a sequência ou entrega?',
    ],
  };

  const HKEY = 'organizador_phrase_hist';
  function readHist() { try { return JSON.parse(localStorage.getItem(HKEY) || '{}'); } catch { return {}; } }
  function writeHist(h) { try { localStorage.setItem(HKEY, JSON.stringify(h)); } catch { /* quota/full — ignora */ } }

  // Sorteia uma frase da categoria evitando as últimas usadas (sem repetição imediata).
  function pick(cat) {
    const arr = BANK[cat];
    if (!arr || !arr.length) return '';
    if (arr.length === 1) return arr[0];
    const h = readHist();
    const recent = Array.isArray(h[cat]) ? h[cat] : [];
    // evita as últimas N (N = ~metade do banco, no máx. tamanho-1) pra não repetir sequência
    const avoidN = Math.min(recent.length, Math.max(1, Math.floor(arr.length / 2)), arr.length - 1);
    const banned = new Set(recent.slice(-avoidN));
    let pool = [];
    for (let i = 0; i < arr.length; i++) if (!banned.has(i)) pool.push(i);
    if (!pool.length) pool = arr.map((_, i) => i);
    const idx = pool[Math.floor(Math.random() * pool.length)];
    const nextRecent = recent.concat(idx).slice(-Math.min(arr.length - 1, 12));
    h[cat] = nextRecent;
    writeHist(h);
    return arr[idx];
  }

  function count(cat) { return (BANK[cat] || []).length; }
  function total() { return Object.keys(BANK).reduce((n, k) => n + BANK[k].length, 0); }

  global.Phrases = { pick, count, total, BANK };
})(typeof self !== 'undefined' ? self : this);
