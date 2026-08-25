// DebitHub — Edge Function: delete-user
// Admin-only. Deletes an auth.users row (and, via ON DELETE CASCADE,
// its profile + all credores/debitos/pagamentos/billing) for good.
// The service_role key never leaves this server-side function.
//
// Deploy (Supabase CLI): supabase functions deploy delete-user
// Invoke from the browser with the admin's own session access_token
// in the Authorization header — see js/data.js users.delete().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Browsers preflight any cross-origin request that carries a custom
// Authorization header with an OPTIONS request — without these headers
// the browser blocks the real request before it ever reaches this function
// (shows up client-side as a generic "Failed to fetch").
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

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace('Bearer ', '');
  if (!jwt) {
    return json({ error: 'missing_auth' }, 401);
  }

  // Verify the caller's identity using their own JWT (anon key + user token).
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: 'invalid_session' }, 401);
  }

  // Admin client (service role) to check the caller's own role and perform the delete.
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: callerProfile, error: profileErr } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();

  if (profileErr || callerProfile?.role !== 'admin') {
    return json({ error: 'forbidden' }, 403);
  }

  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!body.userId) {
    return json({ error: 'missing_user_id' }, 400);
  }
  if (body.userId === userData.user.id) {
    return json({ error: 'cannot_delete_self' }, 400);
  }

  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(body.userId);
  if (deleteErr) {
    return json({ error: 'delete_failed', detail: deleteErr.message }, 500);
  }

  return json({ success: true });
});
