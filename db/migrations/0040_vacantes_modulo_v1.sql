-- 0040 · Módulo "Explorar vacantes disponibles" (bolsa de empleo de eventos) v1
-- YA APLICADA en producción vía Supabase MCP (yopontbwgdybfsniqawz). Idempotente.
-- Incluye la columna vacantes.event_rol_id (migración vacantes_event_rol_id).

create table if not exists public.catalogo_roles (
  id uuid primary key default gen_random_uuid(),
  nombre text not null, slug text not null,
  global boolean not null default true,
  owner_id uuid references public.profiles(id) on delete cascade,
  orden int default 0, created_at timestamptz default now()
);
create unique index if not exists catalogo_roles_slug_global_uidx on public.catalogo_roles(slug) where global = true;

create table if not exists public.perfil_talento (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  titular text, bio text, habilidades text[] default '{}',
  experiencia jsonb default '[]'::jsonb, disponibilidad jsonb default '{}'::jsonb,
  ciudad text, pais text default 'Colombia', telefono text,
  foto_url text, portfolio_url text, redes jsonb default '{}'::jsonb,
  publicado boolean not null default false,
  verificacion_estado text not null default 'ninguna', verificacion_ref text, verificado_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists perfil_talento_publicado_idx on public.perfil_talento(publicado) where publicado = true;
create index if not exists perfil_talento_ciudad_idx on public.perfil_talento(ciudad);

create table if not exists public.vacantes (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete set null,
  titulo text not null, descripcion text,
  rol_id uuid references public.catalogo_roles(id) on delete set null, rol_texto text,
  event_rol_id uuid references public.event_roles(id) on delete set null,
  requisitos jsonb default '{}'::jsonb, preguntas jsonb default '[]'::jsonb,
  pago_monto numeric not null default 0, pago_moneda text not null default 'COP', pago_periodo text default 'evento',
  comision_pct numeric not null default 0.05,
  ciudad text, modalidad text default 'presencial',
  fecha_inicio timestamptz, fecha_fin timestamptz, cupos int not null default 1,
  estado text not null default 'abierta', destacada_hasta timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists vacantes_estado_idx on public.vacantes(estado);
create index if not exists vacantes_evento_idx on public.vacantes(evento_id);
create index if not exists vacantes_ciudad_idx on public.vacantes(ciudad);

create table if not exists public.postulaciones (
  id uuid primary key default gen_random_uuid(),
  vacante_id uuid not null references public.vacantes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  perfil_snapshot jsonb default '{}'::jsonb, respuestas jsonb default '{}'::jsonb,
  etapa text not null default 'postulado', entrevista jsonb, monto_contrato numeric, mensaje text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (vacante_id, user_id)
);
create index if not exists postulaciones_vacante_idx on public.postulaciones(vacante_id);
create index if not exists postulaciones_user_idx on public.postulaciones(user_id);

create table if not exists public.talento_resenas (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid references public.eventos(id) on delete cascade,
  vacante_id uuid references public.vacantes(id) on delete set null,
  postulacion_id uuid references public.postulaciones(id) on delete cascade,
  de_user_id uuid not null references public.profiles(id) on delete cascade,
  para_user_id uuid not null references public.profiles(id) on delete cascade,
  rol_de text not null, estrellas int not null check (estrellas between 1 and 5), comentario text,
  created_at timestamptz default now(), unique (postulacion_id, de_user_id)
);
create index if not exists talento_resenas_para_idx on public.talento_resenas(para_user_id);

create table if not exists public.cobros_vacantes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  evento_id uuid references public.eventos(id) on delete set null,
  vacante_id uuid references public.vacantes(id) on delete set null,
  postulacion_id uuid references public.postulaciones(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  monto numeric not null default 0, moneda text not null default 'COP',
  estado text not null default 'pendiente', proveedor_ref text, created_at timestamptz default now()
);
create index if not exists cobros_vacantes_owner_idx on public.cobros_vacantes(owner_id);

alter table public.catalogo_roles  enable row level security;
alter table public.perfil_talento  enable row level security;
alter table public.vacantes         enable row level security;
alter table public.postulaciones    enable row level security;
alter table public.talento_resenas  enable row level security;
alter table public.cobros_vacantes  enable row level security;
