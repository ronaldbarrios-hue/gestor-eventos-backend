/* GESTEK — Integración Mercado Pago.
   Cada organizador conecta SU cuenta MP (marketplace mode no, por simplicidad
   directo con las credenciales del owner). Guardamos sus credenciales en profiles
   y registramos cada transacción para conciliar con webhooks. */

alter table public.profiles
  add column if not exists mp_user_id      text,
  add column if not exists mp_access_token text,
  add column if not exists mp_public_key   text,
  add column if not exists mp_connected_at timestamptz;

/* Tabla para correlacionar pagos con tickets y procesar webhooks idempotentemente */
create table if not exists public.payment_transactions (
  id              uuid primary key default gen_random_uuid(),
  evento_id       uuid not null references public.eventos(id) on delete cascade,
  ticket_id       uuid references public.tickets(id) on delete set null,
  ticket_type_id  uuid references public.ticket_types(id) on delete set null,

  provider        text not null default 'mercadopago',
  /* preference_id devuelto al crear la preferencia (antes del pago) */
  preference_id   text,
  /* payment_id devuelto por el webhook cuando el pago se procesa */
  payment_id      text,
  status          text not null default 'pending',
    -- pending | approved | rejected | refunded | cancelled

  monto           numeric(12,2),
  currency        text default 'COP',

  guest_email     text,
  guest_nombre    text,
  guest_telefono  text,

  raw             jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists payment_tx_evento_idx     on public.payment_transactions (evento_id);
create index if not exists payment_tx_preference_idx on public.payment_transactions (preference_id);
create index if not exists payment_tx_payment_idx    on public.payment_transactions (payment_id);

drop trigger if exists trg_payment_tx_updated on public.payment_transactions;
create trigger trg_payment_tx_updated before update on public.payment_transactions
  for each row execute function public.set_updated_at();

alter table public.payment_transactions enable row level security;

/* Solo el owner del evento ve sus transacciones */
drop policy if exists payment_tx_select_owner on public.payment_transactions;
create policy payment_tx_select_owner on public.payment_transactions
  for select using (
    exists (select 1 from public.eventos e where e.id = payment_transactions.evento_id and e.owner_id = auth.uid())
  );
