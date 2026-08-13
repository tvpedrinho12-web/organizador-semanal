// config.js — configuração pública do cliente (pode ir para o git; NÃO contém segredos).
window.PUSH_CONFIG = {
  // Chave PÚBLICA VAPID. A privada fica só no servidor (env VAPID_PRIVATE).
  vapidPublic: 'BCbdNQoyoLquQV8W3HWeAl3_yIuFMHnAa5gBSi_36LtO5LHcPG45GVdC8D4kF-ETEt0YNNaHxGg-Zlmy7yc8Wig',

  // Base da API de push.
  //  - '' (vazio)  => mesma origem: usa /api/... (caso o app esteja hospedado no Vercel).
  //  - URL do Vercel => se o app está no GitHub Pages e o backend no Vercel,
  //    coloque aqui, ex.: 'https://organizador-semanal.vercel.app'
  apiBase: ''
};

// Supabase — configuração PÚBLICA do cliente (URL + chave publishable).
// A chave secreta (sb_secret_...) fica SÓ no Vercel, nunca aqui.
window.SUPABASE_CONFIG = {
  url: 'https://bbcyzuvuqsftkoqcfeka.supabase.co',
  anonKey: 'sb_publishable_wCPbELiX1QRXwOZt1QaJwQ_PxUYXSuT'
};
