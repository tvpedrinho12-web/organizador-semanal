# Ritimo (PWA)

Ritimo — assistente pessoal de organização e finanças por voz e texto, **100% local**, sem login, sem backend, sem custo. Instalável na tela inicial do iPhone.

## O que faz

- **Dia atual** com abas para os 7 dias da semana (Seg–Dom).
- **Metas da semana**: lista única e igual em todos os dias, editável a qualquer momento. Cada meta pode ser simples (feito/não feito) ou com contador (ex: `2/5`).
- **Checklist do dia** dividido em **Manhã / Tarde / Noite**. Cada item tem horário opcional e pode ser **duplicado para vários dias** de uma vez.
- **Streak**: contador de dias seguidos com o checklist 100% completo (ex: `12/30`). Zera se passar um dia sem completar tudo. Ao quebrar, pergunta o motivo (opcional). Metas não entram nesse cálculo.
- **Estatísticas**: % por dia e por semana, histórico dos últimos 30 dias e resumo semanal (destacado aos domingos).
- **Notificações** (lembrete diário + aviso antes de cada tarefa, com botão "Concluir"). Ver limitação do iOS abaixo.
- Dark mode fixo, minimalista. CRUD completo de metas e tarefas.

## Dados

Tudo fica só neste aparelho (IndexedDB). Sem sincronização, sem backup, sem export. Limpar os dados do navegador apaga o histórico.

## Rodar localmente

Precisa ser servido por HTTP (o service worker não roda via `file://`):

```bash
cd organizador-semanal
python -m http.server 5178
```

Abra `http://localhost:5178`.

## Publicar de graça

- **Vercel**: arraste a pasta ou conecte o repo. É estático, sem build. Framework preset: *Other*.
- **GitHub Pages**: suba os arquivos e habilite Pages na branch. Como tudo usa caminhos relativos (`./`), funciona em subpasta (`usuario.github.io/repo/`).

## Instalar no iPhone

1. Abra o site no **Safari**.
2. Compartilhar → **Adicionar à Tela de Início**.
3. Abra pelo ícone (modo standalone) e, em Ajustes do app, toque em **Ativar** notificações.

### Notificações no iOS

No iPhone, Web Push só funciona com o **PWA instalado na tela inicial** (iOS 16.4+) **e** com um **servidor** enviando o push.

- **Fase 1 (local):** sem backend, as notificações só disparam com o app aberto/recente.
- **Fase 2 (push real):** implementada — backend grátis em **Vercel Functions + Upstash QStash + VAPID**
  (`api/send.js`, `api/schedule.js`, `push.js`, `config.js`). Dispara o lembrete diário e os avisos por
  tarefa **mesmo com o app fechado**, com botão **Concluir** na notificação. O app cai no modo local
  automaticamente se o backend não estiver configurado.
- Passo a passo de deploy e teste no iPhone: veja **[DEPLOY.md](DEPLOY.md)**.

Segredos (chave VAPID privada, token QStash) ficam em `.env` (fora do git) e nas Environment Variables do Vercel.

## Estrutura

```
index.html      # shell do app
styles.css      # dark minimalista
app.js          # lógica (estado, render, streak, stats, notificações)
db.js           # IndexedDB (fonte única de dados)
sw.js           # cache offline + ação "Concluir" + gancho de push
manifest.webmanifest
icons/          # ícones PWA (gerados por scripts/gen-icons.js)
```
