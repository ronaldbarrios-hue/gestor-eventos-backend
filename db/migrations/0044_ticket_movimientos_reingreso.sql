-- 0044 · Reingreso: registro de entradas/salidas de una boleta. YA APLICADA. Idempotente.
create table if not exists public.ticket_movimientos (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  evento_id uuid not null references public.eventos(id) on delete cascade,
  tipo text not null, acceso text,
  operador_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists ticket_movimientos_evento_idx on public.ticket_movimientos(evento_id);
create index if not exists ticket_movimientos_ticket_idx on public.ticket_movimientos(ticket_id);
alter table public.ticket_movimientos enable row level security;
