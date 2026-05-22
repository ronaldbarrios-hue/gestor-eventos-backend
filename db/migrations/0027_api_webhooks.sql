/* GESTEK — API pública + Webhooks salientes (feature plan Pro).

   - api_tokens     : tokens Bearer del organizador. Guardamos solo el hash.
   - webhooks       : endpoints del organizador suscritos a tipos de evento.
   - webhook_deliveries : log de entregas (para debug + reintentos).
*/

create table if not exists public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  nombre       text not null,
  token_hash   text not null,                 -- sha256 del token completo
  prefix       text not null,                 -- primeros chars visibles (gtk_live_ab12…)
  scopes       text[] not null default array['read'],
  last_used_at timestamptz,
  revoked      boolean not null default false,
  created_at   timestamptz not null default now()
);

create unique index if not exists api_tokens_hash_idx on public.api_tokens (token_hash);
create index if not exists api_tokens_owner_idx       on public.api_tokens (owner_id);

create table if not exists public.webhooks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  url         text not null,
  secret      text not null,                  -- para firmar HMAC-SHA256
  eventos     text[] not null default '{}',   -- ['ticket.pagado','checkin.realizado','evento.publicado']
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists webhooks_owner_idx on public.webhooks (owner_id, activo);

create table if not exists public.webhook_deliveries (
  id           uuid primary key default gen_random_uuid(),
  webhook_id   uuid not null references public.webhooks(id) on delete cascade,
  evento_tipo  text not null,
  payload      jsonb not null,
  status       text not null default 'pending', -- pending | ok | failed
  response_code int,
  intentos     int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists wh_deliveries_idx on public.webhook_deliveries (webhook_id, created_at desc);

/* RLS — el organizador gestiona lo suyo. La API pública valida el token desde
   el backend con service_role (no usa estas policies). */
alter table public.api_tokens         enable row level security;
alter table public.webhooks           enable row level security;
alter table public.webhook_deliveries enable row level security;

drop policy if exists api_tokens_owner on public.api_tokens;
create policy api_tokens_owner on public.api_tokens
  for all using (owner_id = auth.uid());

drop policy if exists webhooks_owner on public.webhooks;
create policy webhooks_owner on public.webhooks
  for all using (owner_id = auth.uid());

drop policy if exists wh_deliveries_owner on public.webhook_deliveries;
create policy wh_deliveries_owner on public.webhook_deliveries
  for select using (
    exists (select 1 from public.webhooks w where w.id = webhook_deliveries.webhook_id and w.owner_id = auth.uid())
  );
