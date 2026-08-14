-- 0073 — OAuth 2.1 para que GESTEK sea un conector en claude.ai
--
-- El servidor MCP autenticaba con los tokens gtk_live_ que ya existían, y eso
-- basta en Claude Code y Claude Desktop, donde se puede poner una cabecera a
-- mano. Pero el conector personalizado de claude.ai NO tiene campo para un
-- token Bearer: su formulario pide Authorization URL, Token URL, Client ID y
-- Client Secret. Sin OAuth, desde la web y el móvil no se puede conectar.
--
-- Estas tres tablas son el mínimo del flujo:
--
--   oauth_clients : quién pide acceso. Claude se registra solo (RFC 7591), sin
--                   que nadie cree credenciales a mano.
--   oauth_codes   : el código de autorización. Vida corta y un solo uso.
--   oauth_tokens  : el acceso y su refresco. Sólo se guarda el hash, igual que
--                   con los api_tokens: si alguien lee la tabla, no puede
--                   suplantar a nadie.
--
-- PKCE es obligatorio (OAuth 2.1 lo exige y MCP también): sin `code_challenge`
-- un código robado en el redirect se puede canjear. Por eso la columna es NOT
-- NULL — no se deja la puerta abierta «por compatibilidad».

begin;

-- ── Clientes ────────────────────────────────────────────────────────────

create table if not exists public.oauth_clients (
  client_id      text primary key,
  -- Los clientes públicos (Claude usa PKCE) no tienen secreto. Se guarda el
  -- hash sólo si alguna vez se registra uno confidencial.
  secret_hash    text,
  nombre         text not null,
  redirect_uris  text[] not null,
  created_at     timestamptz not null default now(),
  ultimo_uso_at  timestamptz
);

comment on table public.oauth_clients is
  'Clientes OAuth registrados dinámicamente (RFC 7591). Claude se registra solo al añadir el conector.';
comment on column public.oauth_clients.redirect_uris is
  'Se comprueba coincidencia EXACTA al autorizar. Sin eso, un redirect_uri libre es un redirect abierto.';

-- ── Códigos de autorización ─────────────────────────────────────────────

create table if not exists public.oauth_codes (
  code_hash      text primary key,
  client_id      text not null references public.oauth_clients(client_id) on delete cascade,
  owner_id       uuid not null references auth.users(id) on delete cascade,
  redirect_uri   text not null,
  -- PKCE, obligatorio. `metodo` se guarda para rechazar `plain`.
  code_challenge text not null,
  challenge_metodo text not null default 'S256',
  scope          text,
  expira_at      timestamptz not null,
  usado_at       timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_oauth_codes_expira on public.oauth_codes (expira_at);

comment on column public.oauth_codes.usado_at is
  'Un código es de un solo uso. Marcarlo en vez de borrarlo permite detectar un intento de reutilización, que es señal de robo.';

-- ── Tokens ──────────────────────────────────────────────────────────────

create table if not exists public.oauth_tokens (
  id             uuid primary key default gen_random_uuid(),
  token_hash     text not null unique,
  refresh_hash   text unique,
  client_id      text not null references public.oauth_clients(client_id) on delete cascade,
  owner_id       uuid not null references auth.users(id) on delete cascade,
  scope          text,
  expira_at      timestamptz not null,
  revocado       boolean not null default false,
  ultimo_uso_at  timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_oauth_tokens_owner on public.oauth_tokens (owner_id, revocado);
create index if not exists idx_oauth_tokens_expira on public.oauth_tokens (expira_at) where not revocado;

comment on table public.oauth_tokens is
  'Tokens de acceso y refresco del conector. Sólo el hash: leer la tabla no permite suplantar a nadie.';

-- ── Limpieza ────────────────────────────────────────────────────────────
--
-- Los códigos caducan en minutos y los tokens en horas; sin barrer, estas dos
-- tablas crecen para siempre. Se hace por consulta y no con pg_cron a
-- propósito: pg_cron es justamente una de las piezas de las que queremos
-- depender menos (ver MIGRACION-SUPABASE.md), y esto lo puede llamar el
-- backend en el mismo ciclo que ya corre cada quince minutos.

create or replace function public.oauth_barrer()
returns void
language sql
as $$
  delete from public.oauth_codes  where expira_at < now() - interval '1 day';
  delete from public.oauth_tokens where expira_at < now() - interval '30 days' and revocado;
$$;

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes   enable row level security;
alter table public.oauth_tokens  enable row level security;

commit;
