-- Puntos y premios POR EXPOSITOR: cada empresa tiene su propia cartera.
-- expositor_id NULL = del ORGANIZADOR (comportamiento actual). No-NULL = de ese
-- expositor. Así un asistente no farmea en un stand y canjea en otro.
-- YA APLICADA en producción (Supabase).

alter table public.evento_motivos
  add column if not exists expositor_id uuid references public.networking_expositores(id) on delete cascade;

alter table public.ticket_interacciones
  add column if not exists expositor_id uuid references public.networking_expositores(id) on delete set null;
alter table public.ticket_interacciones alter column operador_id drop not null;

alter table public.recompensas
  add column if not exists expositor_id uuid references public.networking_expositores(id) on delete cascade;

alter table public.canjes
  add column if not exists expositor_id uuid references public.networking_expositores(id) on delete set null;

create index if not exists idx_motivos_expositor       on public.evento_motivos(expositor_id);
create index if not exists idx_interacciones_expositor on public.ticket_interacciones(expositor_id, ticket_id);
create index if not exists idx_recompensas_expositor   on public.recompensas(expositor_id);
create index if not exists idx_canjes_expositor        on public.canjes(ticket_id, expositor_id);

comment on column public.ticket_interacciones.expositor_id is 'Quién otorgó: NULL = staff del organizador; si no, el expositor. Su cartera es aparte.';
comment on column public.evento_motivos.expositor_id is 'NULL = motivo del evento (staff); si no, motivo propio del expositor.';
