-- 0058 · Anclar y archivar conversaciones, y borrado suave de mensajes.
-- YA APLICADA. Idempotente.
--
-- Anclar y archivar son POR PERSONA, no por canal. Si fueran del canal, anclar
-- una conversación se la anclaría a todo el equipo, y archivar un canal lo
-- esconderría a los demás sin que nadie lo hubiera pedido. Por eso van en su
-- propia tabla, con la pareja (canal, usuario) como llave.

create table if not exists public.chat_channel_prefs (
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  anclado    boolean not null default false,
  archivado  boolean not null default false,
  /* Hasta dónde leyó, para poder marcar lo que no ha visto. */
  leido_at   timestamptz,
  updated_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists chat_channel_prefs_user_idx
  on public.chat_channel_prefs(user_id) where archivado = false;

alter table public.chat_channel_prefs enable row level security;

/* Cada quien ve y escribe solo sus propias preferencias. */
drop policy if exists chat_channel_prefs_propias on public.chat_channel_prefs;
create policy chat_channel_prefs_propias on public.chat_channel_prefs
  for all using (auth.uid() = user_id);

/* ── Borrado suave de mensajes ─────────────────────────────────────────
   El DELETE que se añadió con el permiso `borrar_mensajes` borraba la fila. Eso
   deja un hueco raro en la conversación: el resto ve desaparecer un mensaje del
   medio sin explicación, y si era una moderación no queda constancia de que
   alguien moderó.

   Con borrado suave el mensaje se marca y se pinta como "mensaje eliminado".
   Queda quién lo borró, que es lo que hace auditable una moderación. El
   contenido no se entrega en la API: borrarlo y seguir mandando el texto sería
   un borrado de mentira. */
alter table public.chat_messages
  add column if not exists borrado_at timestamptz,
  add column if not exists borrado_por uuid references public.profiles(id) on delete set null;

create index if not exists chat_messages_canal_vivos_idx
  on public.chat_messages(channel_id, created_at desc) where borrado_at is null;

comment on column public.chat_messages.borrado_at is
  'Borrado suave: si no es null, el mensaje se pinta como eliminado y su contenido no se entrega.';
comment on column public.chat_messages.borrado_por is
  'Quién lo borró. Distinto del autor cuando fue una moderación.';
