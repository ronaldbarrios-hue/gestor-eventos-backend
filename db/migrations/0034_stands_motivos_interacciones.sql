-- Gamificación híbrida físico/virtual: la escarapela impresa lleva el QR del
-- ticket; en cada stand se escanea y se registra un MOTIVO (suma puntos, o deja
-- constancia de una queja/llamado de atención). Los puntos cuelgan del TICKET,
-- no de una cuenta (points_log.user_id es NOT NULL y tickets.user_id es nullable).
-- YA APLICADA en producción (Supabase).

create table if not exists public.evento_motivos (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  nombre      text not null,
  descripcion text,
  tipo        text not null default 'positivo' check (tipo in ('positivo','negativo')),
  puntos      integer not null default 0,
  color       text,
  icono       text,
  activo      boolean not null default true,
  orden       integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.ticket_interacciones (
  id           uuid primary key default gen_random_uuid(),
  evento_id    uuid not null references public.eventos(id) on delete cascade,
  ticket_id    uuid not null references public.tickets(id) on delete cascade,
  motivo_id    uuid references public.evento_motivos(id) on delete set null,
  tipo         text not null default 'positivo' check (tipo in ('positivo','negativo')),
  puntos       integer not null default 0,
  motivo_texto text,
  nota         text,
  lugar        text,
  operador_id  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_motivos_evento       on public.evento_motivos(evento_id, orden);
create index if not exists idx_interacciones_ticket on public.ticket_interacciones(ticket_id, created_at desc);
create index if not exists idx_interacciones_evento on public.ticket_interacciones(evento_id, created_at desc);

-- Misma convención que el resto: RLS activo y sin políticas; el acceso va por
-- el backend con service_role.
alter table public.evento_motivos       enable row level security;
alter table public.ticket_interacciones enable row level security;

comment on table public.evento_motivos is 'Catálogo de motivos de escaneo en stands: suman o restan puntos.';
comment on table public.ticket_interacciones is 'Cada escaneo de la escarapela en un stand, con su motivo y puntos.';
