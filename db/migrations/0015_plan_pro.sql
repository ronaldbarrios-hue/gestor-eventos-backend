/* GESTEK — Plan Pro pagado vía Mercado Pago (cuenta GESTEK como receptor). */

alter table public.profiles
  add column if not exists plan              text not null default 'free',
    -- free | pro
  add column if not exists plan_expires_at   timestamptz,
  add column if not exists plan_payment_id   text,
  add column if not exists plan_updated_at   timestamptz;

/* Marcador en payment_transactions para distinguir compras de plan vs tickets.
   Para planes ticket_id e evento_id quedan null y guardamos user_id. */
alter table public.payment_transactions
  add column if not exists user_id  uuid references public.profiles(id) on delete set null,
  add column if not exists kind     text not null default 'ticket';
    -- ticket | plan

create index if not exists payment_tx_user_idx on public.payment_transactions (user_id) where user_id is not null;

/* La policy actual de payment_transactions filtra por evento.owner_id, así que
   las filas de plan no las vería el dueño. Agregamos una alternativa para que
   cada user vea sus propias compras de plan. */
drop policy if exists payment_tx_select_self_plan on public.payment_transactions;
create policy payment_tx_select_self_plan on public.payment_transactions
  for select using (
    user_id = auth.uid()
  );
