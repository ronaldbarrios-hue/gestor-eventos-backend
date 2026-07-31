-- 0049 · Wompi (pasarela colombiana). YA APLICADA. Idempotente.
alter table public.profiles
  add column if not exists wompi_public_key text,
  add column if not exists wompi_private_key text,
  add column if not exists wompi_events_secret text,
  add column if not exists wompi_integrity_secret text,
  add column if not exists wompi_connected_at timestamptz;
alter table public.payment_transactions
  add column if not exists gateway text default 'mercadopago',
  add column if not exists referencia text;
create index if not exists payment_transactions_referencia_idx on public.payment_transactions(referencia);
