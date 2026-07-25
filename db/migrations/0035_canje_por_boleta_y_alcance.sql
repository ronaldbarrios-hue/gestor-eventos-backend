-- Tarjeta ÚNICA: el mismo QR de la escarapela sirve para entrar y canjear. Los
-- puntos no pueden ser globales o se redimirían en un evento los ganados en
-- otro; el alcance (evento|organizador) vive en page_json.puntos.alcance.
-- YA APLICADA en producción (Supabase).

-- Una recompensa puede ser de UN evento (null = de la empresa).
alter table public.recompensas
  add column if not exists evento_id uuid references public.eventos(id) on delete cascade;

-- El canje puede colgar de una BOLETA (asistente sin cuenta).
alter table public.canjes
  add column if not exists ticket_id uuid references public.tickets(id) on delete set null,
  add column if not exists evento_id uuid references public.eventos(id) on delete set null,
  add column if not exists entregado_at timestamptz;

alter table public.canjes alter column user_id drop not null;

alter table public.canjes drop constraint if exists canjes_dueno_check;
alter table public.canjes add constraint canjes_dueno_check
  check (user_id is not null or ticket_id is not null);

create index if not exists idx_recompensas_evento on public.recompensas(evento_id);
create index if not exists idx_canjes_ticket      on public.canjes(ticket_id);
create index if not exists idx_canjes_evento      on public.canjes(evento_id);

comment on column public.recompensas.evento_id is 'NULL = recompensa de la empresa; si no, solo canjeable en ese evento.';
comment on column public.canjes.ticket_id is 'Canje hecho contra una boleta (asistente sin cuenta).';
