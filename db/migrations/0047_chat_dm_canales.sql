-- 0047 · Chat 1:1: canales DM entre dos miembros. YA APLICADA. Idempotente.
alter table public.chat_channels add column if not exists dm_users uuid[];
alter table public.chat_channels add column if not exists dm_key text;
create unique index if not exists chat_channels_dm_uidx
  on public.chat_channels(evento_id, dm_key) where dm_key is not null;
