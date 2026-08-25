-- ============================================================
-- DebitHub — default plans (run once, after schema.sql)
-- Values match the previous localStorage defaults exactly
-- (js/data.js plans.seedDefaults()/reconcileDefaults()).
-- ============================================================
insert into public.plans (name, prices, period, active, "order") values
  ('Teste',      '{"BRL":0,  "USD":0,   "EUR":0}'::jsonb,  'unlimited', true, 0),
  ('Mensal',     '{"BRL":29, "USD":5.9, "EUR":5.5}'::jsonb, 'monthly',   true, 1),
  ('Trimestral', '{"BRL":81, "USD":16,  "EUR":15}'::jsonb,  'quarterly', true, 2),
  ('Semestral',  '{"BRL":157,"USD":31,  "EUR":29}'::jsonb,  'semiannual',true, 3),
  ('Anual',      '{"BRL":299,"USD":59,  "EUR":55}'::jsonb,  'annual',    true, 4);
