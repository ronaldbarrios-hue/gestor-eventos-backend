/* GESTEK Event OS — Schema inicial
   Aplicar en Supabase SQL Editor del proyecto destino.
   Idempotente con IF NOT EXISTS donde aplica.

   Convenciones:
   - PK   : uuid generado por gen_random_uuid()
   - FK   : on delete cascade donde tiene sentido lógico
   - RLS  : activado en todas las tablas; políticas se definen al final
   - time : timestamptz, default now()
*/

create extension if not exists "pgcrypto";

/* ──────────────────────────────────────────────────────────────
   1. PROFILES (extiende auth.users)
   ────────────────────────────────────────────────────────────── */
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  nombre      text not null,
  handle      text unique,                         -- ej: "juan.medina" — para URLs públicas
  avatar_url  text,
  telefono    text,
  ciudad      text,
  empresa     text,
  ocupacion   text,
  rol         text not null default 'organizador', -- organizador | asistente | admin_global
  puntos      integer not null default 0,
  nivel       text not null default 'bronze',      -- bronze | silver | gold | platinum
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_handle_idx on public.profiles (handle);

/* Trigger: cuando se crea un auth.users, insertar profile con metadata */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nombre, rol, telefono, ciudad, empresa, ocupacion, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', new.email),
    coalesce(new.raw_user_meta_data->>'rol', 'organizador'),
    new.raw_user_meta_data->>'telefono',
    new.raw_user_meta_data->>'ciudad',
    new.raw_user_meta_data->>'empresa',
    new.raw_user_meta_data->>'ocupacion',
    new.raw_user_meta_data->>'foto'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/* ──────────────────────────────────────────────────────────────
   2. CATEGORIAS (catálogo simple)
   ────────────────────────────────────────────────────────────── */
create table if not exists public.categorias (
  id    uuid primary key default gen_random_uuid(),
  slug  text unique not null,
  nombre text not null
);

insert into public.categorias (slug, nombre) values
  ('tecnologia',  'Tecnología'),
  ('negocios',    'Negocios'),
  ('marketing',   'Marketing'),
  ('diseno',      'Diseño'),
  ('educacion',   'Educación'),
  ('musica',      'Música'),
  ('deportes',    'Deportes'),
  ('cultura',     'Cultura'),
  ('otros',       'Otros')
on conflict (slug) do nothing;

/* ──────────────────────────────────────────────────────────────
   3. EVENTOS
   slug es único globalmente porque la ruta es /explorar/[slug].
   ────────────────────────────────────────────────────────────── */
create table if not exists public.eventos (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  categoria_id  uuid references public.categorias(id),

  titulo        text not null,
  slug          text unique not null,
  descripcion   text,
  cover_url     text,

  estado        text not null default 'borrador',   -- borrador | publicado | cancelado | finalizado
  modalidad     text not null default 'fisico',     -- fisico | virtual | hibrido

  fecha_inicio  timestamptz not null,
  fecha_fin     timestamptz,
  timezone      text default 'America/Bogota',

  /* Ubicación física */
  location_nombre text,
  location_direccion text,
  lat            double precision,
  lng            double precision,
  /* Virtual */
  url_virtual    text,

  /* Editor visual drag&drop (Fase B) */
  page_json      jsonb not null default '{"blocks":[]}'::jsonb,

  /* Negocio */
  currency       text not null default 'COP',
  edad_minima    integer,
  aforo_total    integer,
  aforo_vendido  integer not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz,
  deleted_at    timestamptz
);

create index if not exists eventos_owner_idx     on public.eventos (owner_id);
create index if not exists eventos_estado_idx    on public.eventos (estado) where deleted_at is null;
create index if not exists eventos_fecha_idx     on public.eventos (fecha_inicio);
create index if not exists eventos_categoria_idx on public.eventos (categoria_id);

/* ──────────────────────────────────────────────────────────────
   4. TIPOS DE TICKET
   ────────────────────────────────────────────────────────────── */
create table if not exists public.ticket_types (
  id              uuid primary key default gen_random_uuid(),
  evento_id       uuid not null references public.eventos(id) on delete cascade,
  nombre          text not null,                          -- "General", "VIP", "Early Bird"
  descripcion     text,
  precio          numeric(12,2) not null default 0,
  currency        text not null default 'COP',
  cupo            integer,                                -- null = ilimitado
  vendidos        integer not null default 0,

  early_bird_precio numeric(12,2),
  early_bird_hasta  timestamptz,
  venta_hasta       timestamptz,

  zonas_acceso     text[] default '{}',                   -- ["general","vip","backstage"]
  orden            integer not null default 0,
  activo           boolean not null default true,

  created_at      timestamptz not null default now()
);

create index if not exists ticket_types_evento_idx on public.ticket_types (evento_id);

/* ──────────────────────────────────────────────────────────────
   5. TICKETS (boletas individuales emitidas)
   ────────────────────────────────────────────────────────────── */
create table if not exists public.tickets (
  id             uuid primary key default gen_random_uuid(),
  ticket_type_id uuid not null references public.ticket_types(id),
  evento_id      uuid not null references public.eventos(id) on delete cascade,
  user_id        uuid references public.profiles(id),       -- null = invitado sin cuenta

  /* Datos del comprador si no tiene cuenta */
  guest_email    text,
  guest_nombre   text,

  qr_token       text unique,                               -- JWT firmado (se genera al emitir)
  codigo         text unique,                               -- código alfanumérico corto fallback

  estado         text not null default 'emitido',           -- emitido | pagado | usado | reembolsado | invalido
  pagado_at      timestamptz,
  checked_in_at  timestamptz,
  zona_usada     text,

  discount_code_id uuid,
  precio_pagado    numeric(12,2),

  created_at     timestamptz not null default now()
);

create index if not exists tickets_evento_idx  on public.tickets (evento_id);
create index if not exists tickets_user_idx    on public.tickets (user_id);
create index if not exists tickets_estado_idx  on public.tickets (estado);

/* ──────────────────────────────────────────────────────────────
   6. CÓDIGOS DE DESCUENTO
   ────────────────────────────────────────────────────────────── */
create table if not exists public.discount_codes (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references public.eventos(id) on delete cascade,
  codigo        text not null,
  tipo          text not null,                  -- percent | fixed
  valor         numeric(12,2) not null,
  max_usos      integer,
  usos          integer not null default 0,
  expira_at     timestamptz,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (evento_id, codigo)
);

alter table public.tickets
  add constraint tickets_discount_fk
  foreign key (discount_code_id) references public.discount_codes(id) on delete set null
  not valid;

/* ──────────────────────────────────────────────────────────────
   7. AGENDA / SPEAKERS / SPONSORS
   ────────────────────────────────────────────────────────────── */
create table if not exists public.speakers (
  id           uuid primary key default gen_random_uuid(),
  evento_id    uuid not null references public.eventos(id) on delete cascade,
  nombre       text not null,
  bio          text,
  foto_url     text,
  empresa      text,
  social_links jsonb default '{}'::jsonb,
  orden        integer not null default 0
);

create table if not exists public.agenda_sessions (
  id           uuid primary key default gen_random_uuid(),
  evento_id    uuid not null references public.eventos(id) on delete cascade,
  track        text default 'principal',
  titulo       text not null,
  descripcion  text,
  inicio       timestamptz not null,
  fin          timestamptz,
  ubicacion    text,
  speaker_id   uuid references public.speakers(id) on delete set null,
  orden        integer not null default 0
);

create index if not exists speakers_evento_idx on public.speakers (evento_id);
create index if not exists agenda_evento_idx   on public.agenda_sessions (evento_id);

create table if not exists public.sponsors (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.eventos(id) on delete cascade,
  nombre     text not null,
  logo_url   text,
  tier       text default 'silver',         -- gold | silver | bronze
  url        text,
  orden      integer not null default 0
);

/* ──────────────────────────────────────────────────────────────
   8. CHAT (Fase E)
   ────────────────────────────────────────────────────────────── */
create table if not exists public.chat_channels (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  nombre      text not null,
  tipo        text not null default 'general',  -- general | staff | vip | org
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.chat_channels(id) on delete cascade,
  user_id      uuid not null references public.profiles(id),
  contenido    text not null,
  file_url     text,
  created_at   timestamptz not null default now()
);

create index if not exists chat_messages_channel_idx on public.chat_messages (channel_id, created_at);

/* ──────────────────────────────────────────────────────────────
   9. GAMIFICACIÓN (Fase F)
   ────────────────────────────────────────────────────────────── */
create table if not exists public.points_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  evento_id   uuid references public.eventos(id) on delete set null,
  accion      text not null,                  -- checkin | early_bird | referral | survey | mission
  puntos      integer not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.user_badges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  badge_slug  text not null,
  evento_id   uuid references public.eventos(id) on delete set null,
  earned_at   timestamptz not null default now(),
  unique (user_id, badge_slug, evento_id)
);

create table if not exists public.missions (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  titulo          text not null,
  descripcion     text,
  condition_type  text not null,         -- attend_n | invite_n | survey_n
  condition_value integer not null,
  reward_puntos   integer not null default 0,
  badge_slug      text,
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists public.referral_codes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  evento_id       uuid references public.eventos(id) on delete cascade,
  codigo          text unique not null,
  usos            integer not null default 0,
  puntos_por_uso  integer not null default 0,
  created_at      timestamptz not null default now()
);

/* ──────────────────────────────────────────────────────────────
   10. NOTIFICACIONES (in-app)
   ────────────────────────────────────────────────────────────── */
create table if not exists public.notificaciones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  evento_id   uuid references public.eventos(id) on delete cascade,
  tipo        text not null,            -- info | success | warning | reminder
  titulo      text not null,
  cuerpo      text,
  leida       boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists notif_user_idx on public.notificaciones (user_id, leida, created_at desc);

/* ──────────────────────────────────────────────────────────────
   11. updated_at automático
   ────────────────────────────────────────────────────────────── */
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_profiles_updated  on public.profiles;
create trigger trg_profiles_updated  before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists trg_eventos_updated   on public.eventos;
create trigger trg_eventos_updated   before update on public.eventos  for each row execute function public.set_updated_at();

/* ──────────────────────────────────────────────────────────────
   12. RLS — Row Level Security
   Política base: el dueño del evento gestiona todo lo suyo.
   El público lee solo eventos publicados (estado='publicado', deleted_at is null).
   El backend con service_role pasa por encima de RLS.
   ────────────────────────────────────────────────────────────── */
alter table public.profiles        enable row level security;
alter table public.eventos         enable row level security;
alter table public.ticket_types    enable row level security;
alter table public.tickets         enable row level security;
alter table public.discount_codes  enable row level security;
alter table public.speakers        enable row level security;
alter table public.agenda_sessions enable row level security;
alter table public.sponsors        enable row level security;
alter table public.chat_channels   enable row level security;
alter table public.chat_messages   enable row level security;
alter table public.points_log      enable row level security;
alter table public.user_badges     enable row level security;
alter table public.missions        enable row level security;
alter table public.referral_codes  enable row level security;
alter table public.notificaciones  enable row level security;
alter table public.categorias      enable row level security;

/* Categorías: lectura pública */
drop policy if exists categorias_select on public.categorias;
create policy categorias_select on public.categorias for select using (true);

/* Profiles: cada uno lee y actualiza el suyo; lectura pública del handle/avatar */
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles for select using (auth.uid() = id or true);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update using (auth.uid() = id);

/* Eventos:
   - SELECT público: solo publicados y no borrados
   - SELECT dueño: todos los suyos
   - INSERT/UPDATE/DELETE: solo dueño */
drop policy if exists eventos_select_publico on public.eventos;
create policy eventos_select_publico on public.eventos
  for select using (estado = 'publicado' and deleted_at is null);
drop policy if exists eventos_select_owner on public.eventos;
create policy eventos_select_owner on public.eventos
  for select using (auth.uid() = owner_id);
drop policy if exists eventos_insert_owner on public.eventos;
create policy eventos_insert_owner on public.eventos
  for insert with check (auth.uid() = owner_id);
drop policy if exists eventos_update_owner on public.eventos;
create policy eventos_update_owner on public.eventos
  for update using (auth.uid() = owner_id);
drop policy if exists eventos_delete_owner on public.eventos;
create policy eventos_delete_owner on public.eventos
  for delete using (auth.uid() = owner_id);

/* Tickets: el dueño del evento ve todos; el usuario ve los suyos */
drop policy if exists tickets_select_own on public.tickets;
create policy tickets_select_own on public.tickets
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.eventos e where e.id = tickets.evento_id and e.owner_id = auth.uid())
  );

/* Tipos de ticket: lectura pública si el evento está publicado, mutación solo dueño */
drop policy if exists ticket_types_select on public.ticket_types;
create policy ticket_types_select on public.ticket_types
  for select using (
    exists (
      select 1 from public.eventos e
      where e.id = ticket_types.evento_id
        and ((e.estado = 'publicado' and e.deleted_at is null) or e.owner_id = auth.uid())
    )
  );
drop policy if exists ticket_types_write_owner on public.ticket_types;
create policy ticket_types_write_owner on public.ticket_types
  for all using (
    exists (select 1 from public.eventos e where e.id = ticket_types.evento_id and e.owner_id = auth.uid())
  );

/* Speakers / Agenda / Sponsors: lectura pública si publicado, write solo dueño */
do $$
declare t text;
begin
  for t in select unnest(array['speakers','agenda_sessions','sponsors','discount_codes']) loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format($p$
      create policy %1$s_select on public.%1$s
      for select using (
        exists (
          select 1 from public.eventos e
          where e.id = %1$s.evento_id
            and ((e.estado = 'publicado' and e.deleted_at is null) or e.owner_id = auth.uid())
        )
      )
    $p$, t);
    execute format('drop policy if exists %1$s_write_owner on public.%1$s', t);
    execute format($p$
      create policy %1$s_write_owner on public.%1$s
      for all using (
        exists (select 1 from public.eventos e where e.id = %1$s.evento_id and e.owner_id = auth.uid())
      )
    $p$, t);
  end loop;
end$$;

/* Chat: solo participantes con ticket válido o el dueño del evento */
drop policy if exists chat_channels_select on public.chat_channels;
create policy chat_channels_select on public.chat_channels
  for select using (
    exists (select 1 from public.eventos e where e.id = chat_channels.evento_id and e.owner_id = auth.uid())
    or exists (select 1 from public.tickets t where t.evento_id = chat_channels.evento_id and t.user_id = auth.uid() and t.estado in ('pagado','usado'))
  );

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select using (
    exists (
      select 1 from public.chat_channels c
      join public.eventos e on e.id = c.evento_id
      where c.id = chat_messages.channel_id
        and (e.owner_id = auth.uid()
             or exists (select 1 from public.tickets t where t.evento_id = e.id and t.user_id = auth.uid() and t.estado in ('pagado','usado')))
    )
  );
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert with check (auth.uid() = user_id);

/* Notificaciones: solo el dueño */
drop policy if exists notif_select_self on public.notificaciones;
create policy notif_select_self on public.notificaciones for select using (auth.uid() = user_id);
drop policy if exists notif_update_self on public.notificaciones;
create policy notif_update_self on public.notificaciones for update using (auth.uid() = user_id);

/* Gamificación: lectura propia */
drop policy if exists points_log_self on public.points_log;
create policy points_log_self on public.points_log for select using (auth.uid() = user_id);
drop policy if exists user_badges_self on public.user_badges;
create policy user_badges_self on public.user_badges for select using (auth.uid() = user_id);
drop policy if exists referral_codes_self on public.referral_codes;
create policy referral_codes_self on public.referral_codes for all using (auth.uid() = user_id);
drop policy if exists missions_owner on public.missions;
create policy missions_owner on public.missions for all using (auth.uid() = owner_id);

/* ──────────────────────────────────────────────────────────────
   FIN.
   ────────────────────────────────────────────────────────────── */
