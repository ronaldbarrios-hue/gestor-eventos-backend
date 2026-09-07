begin;

alter table public.torneos
  add column if not exists modo_calificacion text null,
  add column if not exists modo_rondas       text null;

alter table public.torneos
  add constraint torneos_modo_calificacion_check
  check (modo_calificacion is null or modo_calificacion in ('rubrica', 'puntaje_unico'));

alter table public.torneos
  add constraint torneos_modo_rondas_check
  check (modo_rondas is null or modo_rondas in ('una_ronda', 'eliminatoria'));

comment on column public.torneos.modo_calificacion is
  'rubrica | puntaje_unico — sólo aplica cuando formato = puntaje_jurado.';
comment on column public.torneos.modo_rondas is
  'una_ronda | eliminatoria — sólo aplica cuando formato = puntaje_jurado.';

create table if not exists public.torneo_criterios (
  id             uuid primary key default gen_random_uuid(),
  torneo_id      uuid not null references public.torneos(id) on delete cascade,
  nombre         text not null,
  puntaje_maximo numeric(6,2) not null default 10,
  orden          int not null default 0,
  created_at     timestamptz not null default now(),
  constraint torneo_criterios_puntaje_maximo_check check (puntaje_maximo > 0)
);
create index if not exists torneo_criterios_torneo_id_idx on public.torneo_criterios(torneo_id);

create table if not exists public.torneo_rondas (
  id          uuid primary key default gen_random_uuid(),
  torneo_id   uuid not null references public.torneos(id) on delete cascade,
  nombre      text not null,
  orden       int not null default 0,
  avanzan     int null,
  estado      text not null default 'pendiente',
  created_at  timestamptz not null default now(),
  constraint torneo_rondas_avanzan_check check (avanzan is null or avanzan > 0),
  constraint torneo_rondas_estado_check check (estado in ('pendiente', 'abierta', 'cerrada'))
);
create index if not exists torneo_rondas_torneo_id_idx on public.torneo_rondas(torneo_id);

create table if not exists public.torneo_ronda_participantes (
  ronda_id  uuid not null references public.torneo_rondas(id) on delete cascade,
  equipo_id uuid not null references public.torneo_equipos(id) on delete cascade,
  primary key (ronda_id, equipo_id)
);

create table if not exists public.torneo_jurados (
  torneo_id  uuid not null references public.torneos(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (torneo_id, user_id)
);

create table if not exists public.torneo_calificaciones (
  id          uuid primary key default gen_random_uuid(),
  ronda_id    uuid not null references public.torneo_rondas(id) on delete cascade,
  criterio_id uuid not null references public.torneo_criterios(id) on delete cascade,
  equipo_id   uuid not null references public.torneo_equipos(id) on delete cascade,
  jurado_id   uuid not null references auth.users(id) on delete cascade,
  puntaje     numeric(6,2) not null,
  comentario  text null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint torneo_calificaciones_puntaje_check check (puntaje >= 0),
  constraint torneo_calificaciones_unica unique (ronda_id, criterio_id, equipo_id, jurado_id)
);
create index if not exists torneo_calificaciones_ronda_idx  on public.torneo_calificaciones(ronda_id);
create index if not exists torneo_calificaciones_equipo_idx on public.torneo_calificaciones(equipo_id);
create index if not exists torneo_calificaciones_jurado_idx on public.torneo_calificaciones(jurado_id);

alter table public.torneo_criterios           enable row level security;
alter table public.torneo_rondas              enable row level security;
alter table public.torneo_ronda_participantes enable row level security;
alter table public.torneo_jurados             enable row level security;
alter table public.torneo_calificaciones      enable row level security;

commit;
