-- 0046 · Alertas en vivo del evento. YA APLICADA. Idempotente.
create table if not exists public.evento_alertas (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  tipo text not null default 'general', nivel text not null default 'info',
  mensaje text not null, zona text, resuelta boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists evento_alertas_evento_idx on public.evento_alertas(evento_id, resuelta);
alter table public.evento_alertas enable row level security;
