/* GESTEK — Restricciones de canales por rol + branding del organizador. */

/* 1. Canales pueden ser restringidos a uno o más roles del evento.
   rol_ids = [] significa "abierto a todos los miembros del evento". */
alter table public.chat_channels
  add column if not exists rol_ids uuid[] not null default '{}';

create index if not exists chat_channels_rol_ids_idx on public.chat_channels using gin (rol_ids);

/* 2. White-label / branding del organizador.
   logo_url para reemplazar el logo GESTEK en sus páginas (cuando hagamos Pro).
   branding jsonb guarda colores y otras prefs. */
alter table public.profiles
  add column if not exists empresa_logo_url text,
  add column if not exists branding jsonb not null default '{}'::jsonb;
