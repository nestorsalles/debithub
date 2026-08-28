/* ============================================================
   DebitHub — Supabase client configuration
   The publishable key (Supabase's current name for what used to be
   called the "anon key") is safe to expose in the browser by design
   — Row Level Security is what actually protects the data. Never put
   the secret/service_role key here or anywhere in the frontend.

   This is a static site with no build step, so there's no .env
   loading mechanism — these values are just plain JS constants.
   ============================================================ */

window.DH = window.DH || {};

const SUPABASE_URL = 'https://hdypqsjmfgqmcrakftnt.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_1WpbsroCqlSBCQr3SrF9Dg_CXJJj3Px';

/* The Supabase SDK itself loads from a CDN (see the <script> tag right before
   this file). If that request is blocked or fails on a given host/network —
   a firewall, an ad-blocker, a flaky edge — `supabase` never becomes a global,
   and calling .createClient() on it throws a plain ReferenceError. Since this
   is the very first inline script every page runs, an uncaught error here
   stops every script tag after it from running too: icons, i18n, the whole
   app, and — most visibly — the login/register form wiring. That looks
   exactly like "the code is broken", when the real cause is one blocked
   script tag. Fail loudly instead of silently here so it's obvious what
   actually happened. */
if (typeof supabase === 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0a0d12;color:#eef1f6;display:flex;align-items:center;justify-content:center;padding:2rem;font-family:system-ui,sans-serif;text-align:center;';
    box.innerHTML = '<div style="max-width:420px;"><h2 style="margin-bottom:.75rem;">Não foi possível carregar o DebitHub</h2><p style="opacity:.8;font-size:.9rem;">O script do Supabase (necessário para login e dados) não carregou. Verifique sua conexão ou tente novamente — se o problema persistir, pode ser um bloqueador de anúncios/firewall impedindo o carregamento de cdn.jsdelivr.net.</p></div>';
    document.body.appendChild(box);
  });
  throw new Error('Supabase SDK failed to load from the CDN — see js/supabase-client.js');
}

DH.sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/* Base URL for invoking Edge Functions (e.g. delete-user). */
DH.functionsUrl = (name) => `${SUPABASE_URL}/functions/v1/${name}`;
