# Deploy do push (fase 2) + roteiro de teste no iPhone

O app já funciona 100% offline no GitHub Pages. Para ter **notificação com o app fechado** no iPhone,
é preciso subir o backend de push. Ele fica em **contas pessoais suas**, separado do dashboard/vendas.

> Chaves e segredos ficam no arquivo local `.env` (não vai pro git). Nunca comite `.env`.

---

## Parte A — Subir o backend (uma vez, ~15 min)

### 1. Upstash QStash (agendador) — grátis
1. Crie conta em https://upstash.com (pode logar com o Google/GitHub).
2. No painel, abra **QStash**.
3. Copie o **QSTASH_TOKEN** (começa com `eyJ...`). Guarde.

### 2. Vercel **pessoal** (não o time `tiktok-dashboard`)
1. Entre em https://vercel.com com sua conta **pessoal** (login GitHub `tvpedrinho12-web`).
2. **Add New → Project → Import** o repositório `organizador-semanal`.
   - **Importante:** no seletor de escopo/owner, escolha sua conta **pessoal**, não o time do negócio.
3. Framework Preset: **Other**. Build/Output: deixe vazio (é estático + funções).
4. Em **Environment Variables**, adicione (valores estão no seu `.env` local):

   | Nome | Valor |
   |---|---|
   | `VAPID_PUBLIC` | (do .env) |
   | `VAPID_PRIVATE` | (do .env — **segredo**) |
   | `VAPID_SUBJECT` | `mailto:tvpedrinho12@gmail.com` |
   | `QSTASH_TOKEN` | (o token do passo 1) |
   | `SEND_SECRET` | invente uma senha longa aleatória |

5. **Deploy**. Você recebe uma URL tipo `https://organizador-semanal.vercel.app`.

> Como o app e as funções ficam na mesma URL do Vercel, o `config.js` pode continuar com
> `apiBase: ''` (mesma origem). Se algum dia quiser manter o app no GitHub Pages e só o backend no
> Vercel, coloque a URL do Vercel em `apiBase`.

### 3. Instalar o PWA a partir da URL do Vercel
Para push funcionar no iPhone, instale o app **pela URL do Vercel** (não a do GitHub Pages).

---

## Parte B — Roteiro de teste no iPhone (você roda e me reporta)

Faça na ordem. Anote onde falhar.

### Instalação (passos 2 do plano)
1. Abra a URL do Vercel no **Safari** (tem que ser Safari, não Chrome).
2. Botão **Compartilhar** → **Adicionar à Tela de Início** → Adicionar.
3. Abra pelo **ícone** na tela inicial.
   - ✅ Esperado: abre **em tela cheia, sem a barra de endereço do Safari**.
   - ❓ Me diga: abriu em tela cheia? O ícone ficou certo (quadrado escuro com o "check")?

### Notificações (passo 3) — teste com o app FECHADO
4. No app: aba **Ajustes** → **Ativar** notificações → **Permitir** no popup do iOS.
5. **Lembrete diário:** mude "Lembrete diário" para **2 minutos à frente** do horário atual. Feche o app (deslize pra cima). Espere.
   - ✅ Esperado: chega uma notificação "Bom dia!" no horário.
6. **Por tarefa:** crie uma tarefa com **horário ~3 min à frente** e **"avisar antes" = 1 min**. Feche o app completamente. Espere.
   - ✅ Esperado: ~1 min antes do horário chega a notificação com o nome da tarefa e um botão **Concluir**.
7. **Botão Concluir:** na notificação, toque em **Concluir** (sem abrir o app). Depois abra o app.
   - ✅ Esperado: a tarefa aparece **marcada como feita**.
   - ⚠️ Este é o mais sensível no iOS. Se não funcionar, me avise que a gente decide um fallback.

### Offline (passo 4)
8. Abra o app uma vez. Ative o **Modo Avião**. Abra o app de novo.
   - ✅ Esperado: abre normal, dados aparecem, dá pra marcar tarefas.

### Streak (passo 5)
9. Complete 100% de um dia (todas as tarefas marcadas) → o contador de sequência sobe.
10. No dia seguinte, **não complete** e deixe passar um dia → ao abrir, a sequência zera e aparece a pergunta do motivo.
   - (Já testei essa lógica no navegador e funciona; aqui é só confirmar no aparelho.)

### Persistência (passo 6)
11. Adicione metas/tarefas. **Feche** o app. Espere alguns minutos. Reabra. → dados intactos.
12. **Reinicie o iPhone**. Abra o app. → dados ainda lá.

---

## Limitações de iOS que você já deve saber

- Web Push no iPhone **só** funciona com o PWA **instalado na tela inicial** e iOS **16.4+**.
- O horário da notificação pode ter **pequeno atraso** (o iOS agrupa/adia entregas). Não é cronômetro exato.
- Se você desinstalar o app da tela inicial, a inscrição de push é perdida (é só reativar em Ajustes).
- Armazenamento: PWAs instalados normalmente **não** sofrem a limpeza de 7 dias do Safari, mas se ficar
  muitíssimo tempo sem abrir, o iOS pode liberar espaço. Uso normal não é afetado.

## Como me reportar
Para cada passo (5, 6, 7, 8, 11, 12), me diga: **funcionou / não funcionou** e, se falhou, o que apareceu.
Com isso eu ajusto o que precisar.
