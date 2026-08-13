// supabase.js — cliente Supabase + autenticação (sem build; expõe globais).
// Carregar DEPOIS de config.js e do UMD @supabase/supabase-js.
(function () {
  var cfg = window.SUPABASE_CONFIG || {};
  if (!window.supabase || !cfg.url || !cfg.anonKey) {
    console.error('[Ritmo] Supabase não configurado (falta lib UMD ou SUPABASE_CONFIG).');
    return;
  }

  var client = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'ritmo-auth'
    }
  });
  window.sb = client;

  var STATUS_KEY = 'ritmo_status'; // cache p/ tolerância offline do guard

  async function currentProfile() {
    var res = await client.auth.getUser();
    var user = res && res.data ? res.data.user : null;
    if (!user) return null;
    var q = await client.from('profiles').select('*').eq('id', user.id).single();
    if (q.error) {
      // Sem profile ainda (trigger em corrida) ou erro de rede: trata como pendente.
      return { id: user.id, email: user.email, status: 'pending', role: 'user', _error: q.error.message };
    }
    try { localStorage.setItem(STATUS_KEY, q.data.status); } catch (e) {}
    return q.data;
  }

  window.RitmoAuth = {
    client: client,
    signInEmail: function (email, password) {
      return client.auth.signInWithPassword({ email: email, password: password });
    },
    signUpEmail: function (email, password, name) {
      return client.auth.signUp({
        email: email,
        password: password,
        options: { data: { name: name || '' }, emailRedirectTo: location.origin + '/login.html' }
      });
    },
    oauth: function (provider) {
      return client.auth.signInWithOAuth({
        provider: provider,
        options: { redirectTo: location.origin + '/login.html' }
      });
    },
    resetPassword: function (email) {
      return client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/login.html' });
    },
    updatePassword: function (newPassword) {
      return client.auth.updateUser({ password: newPassword });
    },
    signOut: async function () {
      try { localStorage.removeItem(STATUS_KEY); } catch (e) {}
      return client.auth.signOut();
    },
    getSession: function () { return client.auth.getSession(); },
    profile: currentProfile,
    onChange: function (cb) { return client.auth.onAuthStateChange(cb); },
    touchLastSeen: async function () {
      try {
        var res = await client.auth.getUser();
        var user = res && res.data ? res.data.user : null;
        if (user) {
          await client.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id);
        }
      } catch (e) {}
    }
  };

  // Guard para páginas protegidas (index.html).
  // Retorna o profile se aprovado; senão redireciona para login e retorna false.
  // Tolerância offline: se a rede falhar mas houver sessão + status 'approved' em cache, libera.
  window.RitmoGuard = async function () {
    var s = await client.auth.getSession();
    var session = s && s.data ? s.data.session : null;
    if (!session) { location.replace('login.html'); return false; }

    try {
      var p = await currentProfile();
      if (p && p.status === 'approved') {
        window.RitmoAuth.touchLastSeen();
        return p;
      }
      location.replace('login.html');
      return false;
    } catch (e) {
      // offline / erro de rede: cai no cache
      var cached = null;
      try { cached = localStorage.getItem(STATUS_KEY); } catch (_) {}
      if (cached === 'approved') return { status: 'approved', _offline: true };
      location.replace('login.html');
      return false;
    }
  };
})();
