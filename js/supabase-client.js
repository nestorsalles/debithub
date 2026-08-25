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

DH.sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/* Base URL for invoking Edge Functions (e.g. delete-user). */
DH.functionsUrl = (name) => `${SUPABASE_URL}/functions/v1/${name}`;
