-- 0053 · Chat: la RLS acepta al staff y deja de filtrar los DM. YA APLICADA. Idempotente.
-- Ojo: la 0056 mueve sus funciones al esquema `private`. Aplicar esta sola deja
-- un aviso de seguridad; hay que aplicar la 0056 detrás.
--
-- Dos problemas en las políticas que dejó 0001_init:
--
-- 1. Solo pasaban el dueño del evento y quien tuviera boleta 'pagado'/'usado'.
--    Un colaborador del equipo (event_members activo) no cumple ninguna de las
--    dos, así que Postgres le negaba el SELECT. El backend usa la service key
--    y salta la RLS, por eso los mensajes SÍ salían al recargar; pero Realtime
--    va con el JWT del usuario, y ahí la RLS manda: el INSERT nunca le llegaba.
--    Ese es el "los mensajes no llegan sin recargar".
--
-- 2. 0047 añadió los canales DM (dm_users, dm_key) pero no tocó la RLS. La
--    política de mensajes autoriza por evento, no por canal, así que cualquiera
--    con boleta pagada podía suscribirse por Realtime al canal DM de otras dos
--    personas y recibir sus mensajes. La API REST sí lo comprueba
--    (routes/chat.js), pero Realtime no pasa por la API.
--
-- Estas políticas son solo de lectura; el INSERT sigue siendo
-- `auth.uid() = user_id`, que ya estaba bien.

/* Miembro activo del equipo del evento. */
create or replace function public.fn_es_miembro_evento(p_evento_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.event_members m
    where m.evento_id = p_evento_id
      and m.user_id   = p_user_id
      and m.status    = 'active'
  );
$$;

/* Quién puede ver el chat de un evento: dueño, staff activo o asistente con
   boleta que ya vale. */
create or replace function public.fn_puede_ver_chat(p_evento_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.eventos e
    where e.id = p_evento_id and e.owner_id = p_user_id
  )
  or public.fn_es_miembro_evento(p_evento_id, p_user_id)
  or exists (
    select 1 from public.tickets t
    where t.evento_id = p_evento_id
      and t.user_id   = p_user_id
      and t.estado in ('pagado', 'usado')
  );
$$;

/* ── Canales ──────────────────────────────────────────────────────────
   Se ve el canal si tienes acceso al chat del evento Y, cuando es un DM,
   estás entre sus dos participantes. */
drop policy if exists chat_channels_select on public.chat_channels;
create policy chat_channels_select on public.chat_channels
  for select using (
    public.fn_puede_ver_chat(chat_channels.evento_id, auth.uid())
    and (
      coalesce(chat_channels.tipo, 'canal') <> 'dm'
      or auth.uid() = any (coalesce(chat_channels.dm_users, '{}'::uuid[]))
    )
  );

/* ── Mensajes ─────────────────────────────────────────────────────────
   Misma regla, resuelta a través del canal al que pertenece el mensaje. */
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select using (
    exists (
      select 1 from public.chat_channels c
      where c.id = chat_messages.channel_id
        and public.fn_puede_ver_chat(c.evento_id, auth.uid())
        and (
          coalesce(c.tipo, 'canal') <> 'dm'
          or auth.uid() = any (coalesce(c.dm_users, '{}'::uuid[]))
        )
    )
  );

/* El INSERT no cambia, pero se redeclara para que la migración sea
   autocontenida si alguien la aplica sobre una base parcial. */
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert with check (auth.uid() = user_id);

/* Realtime evalúa la política por cada fila candidata: sin estos índices,
   cada INSERT en un evento grande hace scan de event_members y tickets. */
create index if not exists event_members_evento_user_idx
  on public.event_members(evento_id, user_id) where status = 'active';
create index if not exists tickets_evento_user_estado_idx
  on public.tickets(evento_id, user_id, estado);
