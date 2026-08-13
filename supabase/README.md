# Ritmo — Supabase (Fase 3)

Projeto: `bbcyzuvuqsftkoqcfeka` · URL `https://bbcyzuvuqsftkoqcfeka.supabase.co`

## Como aplicar a migration

1. Abra o **Supabase → SQL Editor → New query**.
2. Cole todo o conteúdo de `migrations/0001_init.sql`.
3. Clique **Run**. Deve terminar com "Success". É idempotente (pode rodar de novo).
4. Confira em **Table Editor**: devem aparecer `profiles`, `tasks`, `task_recurrences`,
   `goals`, `transactions`, `bills`, `finance_goals`, `user_settings`,
   `assistant_actions`, `ai_usage`, `finance_reports`, `push_subscriptions`, `app_config`.
5. Em **Authentication → Policies**: todas as tabelas devem estar com **RLS ativo**.

## Admin principal

`app_config.admin_email = tvpedrinho12@gmail.com`. Quando essa conta se cadastrar,
o profile nasce `role=admin`, `status=approved` automaticamente. Todos os outros
nascem `role=user`, `status=pending` (aguardando aprovação).

## Auth — o que já está e o que falta configurar (painel do Supabase)

- **E-mail/senha:** já habilitado. Como `mailer_autoconfirm=false`, o usuário
  precisa confirmar o e-mail. Em **Authentication → URL Configuration**, defina o
  **Site URL** = `https://organizador-semanal-chi.vercel.app` e adicione as
  **Redirect URLs** do app (mesma URL) para o link de confirmação/recuperação voltar certo.
- **Google:** habilitar em **Authentication → Providers → Google** (precisa de OAuth
  Client no Google Cloud — Client ID + Secret + redirect
  `https://bbcyzuvuqsftkoqcfeka.supabase.co/auth/v1/callback`). Ainda **desligado**.
- **Apple:** habilitar em **Providers → Apple** (exige **Apple Developer pago**,
  Services ID + key). Ainda **desligado**. Deixo o botão estruturado no app.

## Variáveis de ambiente

| Nome | Onde | Segredo? | Valor |
|---|---|---|---|
| `SUPABASE_URL` | Vercel + `config.js` (público) | não | `https://bbcyzuvuqsftkoqcfeka.supabase.co` |
| `SUPABASE_ANON_KEY` | Vercel + `config.js` (público) | não | `sb_publishable_wCPbEL…` |
| `SUPABASE_SECRET_KEY` | **só Vercel** | **sim** | `sb_secret_…` (backend/service role) |
| `ADMIN_EMAIL` | Vercel + `app_config` (SQL) | não | `tvpedrinho12@gmail.com` |
