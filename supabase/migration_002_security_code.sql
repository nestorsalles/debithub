-- ============================================================
-- DebitHub — migration: switch "forgot password" back to a
-- security code (instead of the e-mail link flow).
-- Run once in the SQL Editor, on a project that already ran
-- schema.sql. Safe to run even if some parts already exist.
-- ============================================================

alter table public.profiles add column if not exists security_code text;

create or replace function public.handle_new_user() returns trigger
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
