-- ============================================================
-- DebitHub — Supabase schema (run once, in the SQL Editor)
-- Postgres + Auth + Row Level Security
-- ============================================================

-- ── plans ──────────────────────────────────────────────────
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  prices jsonb not null default '{"BRL":0,"USD":0,"EUR":0}'::jsonb,
  period text not null default 'monthly'
    check (period in ('monthly','quarterly','semiannual','annual','unlimited')),
  active boolean not null default true,
  "order" int not null default 99,
  created_at timestamptz not null default now()
);

-- ── profiles (1:1 with auth.users) ────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  phone text,
  cpf text,
  security_code text,
  country text not null default 'BR',
  city text,
  state text,
  plan_id uuid references public.plans(id),
  payment_method text,
  currency text not null default 'BRL',
  role text not null default 'user' check (role in ('user','admin')),
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  pending_since timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ── credores ───────────────────────────────────────────────
-- The public share link is debithub.com.br/credor/<slug>/<public_code>.
-- slug is just a readable name (not unique — two "João Silva"s can share
-- one) and public_code is the real identifier: an auto-numbered, globally
-- unique column that disambiguates them and stays stable across renames.
create table public.credores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  slug text not null,
  public_code bigint generated always as identity (start with 100000) unique,
  city text,
  state text,
  phone text,
  created_at timestamptz not null default now()
);

-- ── debitos ────────────────────────────────────────────────
create table public.debitos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  creditor_id uuid not null references public.credores(id) on delete cascade,
  description text not null,
  date date not null,
  amount numeric not null,
  currency text not null default 'BRL',
  category text,
  type text not null default 'unique' check (type in ('unique','installment','recurring')),
  installments int not null default 1,
  installment_amount numeric not null default 0,
  status text not null default 'active' check (status in ('active','partial','paid')),
  created_at timestamptz not null default now()
);

-- ── pagamentos (debt payments between the app's users and their creditors) ──
create table public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  creditor_id uuid not null references public.credores(id) on delete cascade,
  debit_id uuid not null references public.debitos(id) on delete cascade,
  amount numeric not null,
  date date not null,
  note text,
  created_at timestamptz not null default now()
);

-- ── billing (admin-only: subscription payments TO the platform) ──
create table public.billing (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  method text not null check (method in ('pix','card','boleto','bonus')),
  plan text,
  amount numeric not null default 0,
  date date not null,
  note text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- is_admin() — security definer, avoids RLS self-recursion on profiles
-- ============================================================
create function public.is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ============================================================
-- New-signup trigger: auth.users -> profiles
-- role/status are ALWAYS hard-coded here, never taken from
-- client-supplied signup metadata (that data is client-writable).
-- ============================================================
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, phone, cpf, security_code, country, city, state, plan_id, payment_method, currency, role, status, pending_since)
  values (
    new.id, new.email,
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'cpf',
    upper(new.raw_user_meta_data->>'security_code'),
    coalesce(new.raw_user_meta_data->>'country', 'BR'),
    new.raw_user_meta_data->>'city',
    new.raw_user_meta_data->>'state',
    nullif(new.raw_user_meta_data->>'plan_id', '')::uuid,
    new.raw_user_meta_data->>'payment_method',
    coalesce(new.raw_user_meta_data->>'currency', 'BRL'),
    'user', 'pending', now()
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Guard trigger on profiles: a non-admin can never change their
-- own role, and can only move status pending -> suspended
-- (the existing 24h-auto-suspend-if-not-approved sweep). Any
-- other role/status/pending_since change requires is_admin().
-- auth.uid() IS NULL means a direct/service-role DB connection
-- (e.g. the one-time SQL-editor admin bootstrap below) — trusted.
-- ============================================================
create function public.profiles_guard_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.role is distinct from old.role then
    raise exception 'cannot change role';
  end if;
  if new.status is distinct from old.status then
    if not (old.status = 'pending' and new.status = 'suspended') then
      raise exception 'cannot change status';
    end if;
  end if;
  if new.pending_since is distinct from old.pending_since then
    raise exception 'cannot change pending_since';
  end if;
  return new;
end;
$$;

create trigger trg_profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard_update();

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles   enable row level security;
alter table public.plans      enable row level security;
alter table public.credores   enable row level security;
alter table public.debitos    enable row level security;
alter table public.pagamentos enable row level security;
alter table public.billing    enable row level security;

-- profiles: own row, or admin
create policy profiles_select on public.profiles for select
  using (auth.uid() = id or public.is_admin());
create policy profiles_update on public.profiles for update
  using (auth.uid() = id or public.is_admin());
create policy profiles_delete on public.profiles for delete
  using (public.is_admin());
-- no insert policy: rows are only created by handle_new_user() (security definer)

-- plans: readable by anyone (incl. anon, for the pre-login registration
-- plan-picker), writable only by admin
create policy plans_select on public.plans for select
  using (true);
create policy plans_write_insert on public.plans for insert
  with check (public.is_admin());
create policy plans_write_update on public.plans for update
  using (public.is_admin());
create policy plans_write_delete on public.plans for delete
  using (public.is_admin());

-- credores / debitos / pagamentos: owner or admin
create policy credores_all on public.credores for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
create policy debitos_all on public.debitos for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
create policy pagamentos_all on public.pagamentos for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- billing: admin only, never the account owner
create policy billing_admin_only on public.billing for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- Public creditor page (debithub.com.br/credor/<slug>/<public_code>) —
-- no login. Rather than opening a permissive RLS "select" policy on
-- credores/debitos/pagamentos (which would let anon list every row in
-- those tables, not just the one the code points at), this function
-- runs as security definer and hand-picks exactly the fields the public
-- page needs for ONE credor, looked up by its unique public_code (the
-- slug in the URL is decorative and is never used for the lookup).
-- ============================================================
create function public.get_public_credor(p_code bigint) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_credor public.credores%rowtype;
  v_debtor_name text;
  result jsonb;
begin
  select * into v_credor from public.credores where public_code = p_code;
  if not found then
    return null;
  end if;

  select name into v_debtor_name from public.profiles where id = v_credor.user_id;

  select jsonb_build_object(
    'credor', jsonb_build_object('name', v_credor.name, 'city', v_credor.city, 'state', v_credor.state, 'phone', v_credor.phone),
    'debtor', jsonb_build_object('name', coalesce(v_debtor_name, '')),
    'debits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'description', d.description, 'date', d.date, 'amount', d.amount,
        'currency', d.currency, 'category', d.category, 'type', d.type,
        'installments', d.installments, 'installmentAmount', d.installment_amount, 'status', d.status
      ))
      from public.debitos d where d.creditor_id = v_credor.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'debitId', p.debit_id, 'amount', p.amount, 'date', p.date, 'note', p.note
      ))
      from public.pagamentos p where p.debit_id in (select id from public.debitos where creditor_id = v_credor.id)
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_public_credor(bigint) to anon, authenticated;

-- ============================================================
-- One-time setup, AFTER running this file:
--
-- 1) Sign up normally once through the site itself (you'll get
--    role='user', status='pending' via the trigger above).
-- 2) Find your new user's id:
--      select id, email from public.profiles;
-- 3) Promote it to admin (works because of the auth.uid() IS NULL
--    carve-out in profiles_guard_update — this runs as the SQL
--    Editor's direct Postgres connection, not as your own session):
--      update public.profiles set role = 'admin', status = 'active'
--      where id = '<paste-the-uuid-here>';
-- ============================================================
