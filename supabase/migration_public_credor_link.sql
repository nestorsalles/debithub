-- ============================================================
-- DebitHub — migration: personalized public creditor link
-- Run once in the Supabase SQL Editor, on the database that already
-- has schema.sql applied. Safe to re-run (every step is idempotent).
--
-- Result: a share link like debithub.com.br/credor/joao-silva/100004
-- The "joao-silva" part is just the credor's name for readability;
-- the number is what's actually looked up, so two different credores
-- named "João Silva" get two different, non-colliding links.
-- ============================================================

-- 1) Numeric public code: Postgres assigns it automatically (identity
--    column), starting at 100000, and back-fills any existing rows.
alter table public.credores add column if not exists public_code bigint generated always as identity (start with 100000);

do $$ begin
  alter table public.credores add constraint credores_public_code_key unique (public_code);
exception when duplicate_object then null;
end $$;

-- 2) The public lookup function, keyed on public_code (not slug).
create or replace function public.get_public_credor(p_code bigint) returns jsonb
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

-- 3) Drop the old slug-keyed version of the function, if it was created
--    by an earlier run of this feature (harmless to run even if it never existed).
drop function if exists public.get_public_credor(text);
