-- 0068 · Los anuncios del evento existen de verdad.
--
-- ── Qué pasaba ────────────────────────────────────────────────────────
--
-- "Enviar anuncio" era ÚNICAMENTE un push del navegador. Tres consecuencias,
-- que son exactamente las tres que reportó el equipo:
--
--   1. NO LLEGA. El endpoint arranca con `if (!VAPID_PUBLIC) return 503`, y
--      las claves VAPID no están puestas. O sea que el anuncio no se enviaba
--      nunca: fallaba entero antes de mirar a quién iba dirigido.
--   2. NO NOTIFICA. Aunque hubiera claves, sólo alcanzaba a quien hubiera
--      aceptado notificaciones del navegador (`push_subscriptions`). No
--      escribía nada en `notificaciones`, así que la campana del panel no se
--      enteraba y quien no tuviera el push activado no veía nada, jamás.
--   3. NO PERSISTE. No se guardaba en ninguna parte. Enviado y evaporado: no
--      había forma de saber qué se había anunciado ni cuándo.
--
-- ── El arreglo ────────────────────────────────────────────────────────
--
-- Un anuncio pasa a ser una COSA, no el efecto secundario de un push:
--
--   · se guarda aquí,
--   · genera una notificación in-app por destinatario —ése es el canal que
--     siempre funciona, sin claves ni permisos del navegador—,
--   · y el push se manda además, si hay claves. Deja de ser el requisito para
--     ser un extra.

create table if not exists public.evento_anuncios (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  autor_id    uuid references public.profiles(id) on delete set null,
  titulo      text not null,
  mensaje     text not null,
  url         text,
  /* Cuánta gente lo recibió y por qué vías. Se guarda el resultado del envío
     porque después no hay forma de reconstruirlo, y es lo que permite
     responder "¿le llegó a alguien?" sin adivinar. */
  destinatarios integer not null default 0,
  push_enviados integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists evento_anuncios_idx
  on public.evento_anuncios (evento_id, created_at desc);

comment on table public.evento_anuncios is
  'Anuncios enviados al equipo de un evento. Antes no se guardaban en ningún sitio.';

/* ── RLS ──
   Lo lee el equipo del evento; lo escribe el backend con la service key.
   Con políticas desde el principio, para no engordar la lista de tablas con
   RLS activada y ninguna. */
alter table public.evento_anuncios enable row level security;

drop policy if exists evento_anuncios_select on public.evento_anuncios;
create policy evento_anuncios_select on public.evento_anuncios
  for select using (
    exists (select 1 from public.eventos e
            where e.id = evento_anuncios.evento_id and e.owner_id = auth.uid())
    or exists (select 1 from public.event_members m
               where m.evento_id = evento_anuncios.evento_id
                 and m.user_id = auth.uid() and m.status = 'active')
  );

drop policy if exists evento_anuncios_write_owner on public.evento_anuncios;
create policy evento_anuncios_write_owner on public.evento_anuncios
  for all using (
    exists (select 1 from public.eventos e
            where e.id = evento_anuncios.evento_id and e.owner_id = auth.uid())
  );
