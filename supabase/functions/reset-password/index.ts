// DebitHub — Edge Function: reset-password
// Public (no login needed — this IS the "forgot password" flow).
// Validates {email, securityCode} against the profiles table and, if it
// matches, sets a new password via the Admin API. The service_role key
// never leaves this server-side function.
//
// Deploy: paste into Supabase dashboard → Edge Functions → reset-password
// Invoked from the browser with no Authorization header at all — see
// js/data.js users.resetPassword().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  let body: { email?: string; securityCode?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const email = (body.email || '').trim().toLowerCase();
  const securityCode = (body.securityCode || '').trim().toUpperCase();
  const newPassword = body.newPassword || '';
  if (!email || !securityCode || !newPassword) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (newPassword.length < 6) {
    return json({ error: 'err_password_min' }, 400);
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: profile, error: lookupErr } = await adminClient
    .from('profiles')
    .select('id, security_code')
    .eq('email', email)
    .maybeSingle();

  if (lookupErr || !profile) {
    return json({ error: 'err_user_not_found' }, 404);
  }
  if ((profile.security_code || '').toUpperCase() !== securityCode) {
    return json({ error: 'err_security_code_wrong' }, 400);
  }

  const { error: updateErr } = await adminClient.auth.admin.updateUserById(profile.id, { password: newPassword });
  if (updateErr) {
    return json({ error: 'err_generic', detail: updateErr.message }, 500);
  }

  return json({ success: true });
});
