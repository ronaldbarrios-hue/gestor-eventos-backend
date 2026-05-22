-- GESTEK — Migraciones pendientes 0020→0028 (combinadas)
-- Pega TODO esto en Supabase → SQL Editor → Run (una sola vez).
-- Idempotente: usa create table if not exists. Orden respetado.

begin;


-- ════════════════════════════════════════════════════════════
-- 0020_waitlist.sql
-- ════════════════════════════════════════════════════════════
-- 0020: Lista de espera por tipo de boleta
-- Permite a usuarios unirse a una cola cuando el cupo está agotado.

create table if not exists public.event_waitlist (
  id                    uuid primary key default gen_random_uuid(),
  evento_id             uuid not null references public.eventos(id) on delete cascade,
  ticket_type_id        uuid not null references public.ticket_types(id) on delete cascade,

  user_id               uuid references public.profiles(id) on delete set null,
  guest_email           text not null,
  guest_nombre          text,

  posicion              integer not null,

  estado                text not null default 'active',
  -- active | contacted | purchased | cancelled

  added_at              timestamptz not null default now(),
  notified_at           timestamptz,
  purchased_at          timestamptz,

  notification_attempts integer not null default 0,
  last_contact_at       timestamptz,

  unique (evento_id, ticket_type_id, guest_email)
);

create index if not exists waitlist_evento_idx    on public.event_waitlist (evento_id);
create index if not exists waitlist_tipo_idx      on public.event_waitlist (ticket_type_id);
create index if not exists waitlist_estado_idx    on public.event_waitlist (estado);
create index if not exists waitlist_posicion_idx  on public.event_waitlist (evento_id, ticket_type_id, posicion);


-- ════════════════════════════════════════════════════════════
-- 0021_notificaciones.sql
-- ════════════════════════════════════════════════════════════
/* GESTEK — Notificaciones in-app.
   Una fila por notificación a un usuario. El backend las crea (service_role)
   desde puntos clave (reserva, alta a equipo, tarea asignada, etc).
   El frontend las lee + escucha vía Supabase Realtime. */

create table if not exists public.notificaciones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  tipo        text not null default 'info',
    -- info | reserva | equipo | tarea | pago | sistema
  titulo      text not null,
  cuerpo      text,
  link        text,                       -- ruta interna a la que navega al click
  evento_id   uuid references public.eventos(id) on delete cascade,
  leida       boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists notif_user_idx
  on public.notificaciones (user_id, created_at desc);
create index if not exists notif_user_unread_idx
  on public.notificaciones (user_id) where leida = false;

alter table public.notificaciones enable row level security;

/* Cada usuario ve y marca como leídas SOLO las suyas.
   El insert lo hace el backend con service_role (bypassa RLS). */
drop policy if exists notif_select_own on public.notificaciones;
create policy notif_select_own on public.notificaciones
  for select using (user_id = auth.uid());

drop policy if exists notif_update_own on public.notificaciones;
create policy notif_update_own on public.notificaciones
  for update using (user_id = auth.uid());

drop policy if exists notif_delete_own on public.notificaciones;
create policy notif_delete_own on public.notificaciones
  for delete using (user_id = auth.uid());

/* Realtime sobre notificaciones (idempotente) */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificaciones'
  ) then
    execute 'alter publication supabase_realtime add table public.notificaciones';
  end if;
end$$;


-- ════════════════════════════════════════════════════════════
-- 0022_gamificacion.sql
-- ════════════════════════════════════════════════════════════
/* GESTEK — Gamificación.
   Las tablas points_log / user_badges / missions ya existen (0001_init.sql).
   Esto agrega:
   - profiles.puntos_total : cache del total (para ranking sin agregaciones caras)
   - Backfill del cache desde points_log
   - RLS extra para que el ranking sea legible por usuarios autenticados
*/

alter table public.profiles
  add column if not exists puntos_total integer not null default 0;

/* Backfill: suma histórica de points_log a la cache */
update public.profiles p
set puntos_total = coalesce((
  select sum(pl.puntos) from public.points_log pl where pl.user_id = p.id
), 0);

create index if not exists profiles_puntos_idx
  on public.profiles (puntos_total desc) where puntos_total > 0;

/* Ranking: cualquier usuario autenticado puede leer nombre+avatar+puntos
   de los demás (solo esas columnas, vía la policy de abajo no — RLS es a nivel
   fila, no columna). Para no exponer todo el profile, el backend usa
   service_role y selecciona solo columnas públicas. Dejamos la policy
   existente intacta; el ranking se sirve desde el backend. */

/* user_badges: permitir que el dueño vea las suyas ya está en 0001.
   Agregamos índice para el conteo por usuario. */
create index if not exists user_badges_user_idx
  on public.user_badges (user_id);


-- ════════════════════════════════════════════════════════════
-- 0023_recordatorios_inapp.sql
-- ════════════════════════════════════════════════════════════
/* GESTEK — Recordatorios in-app (T-7d / T-1d / T-1h).
   A diferencia de los recordatorios por email (Edge Function + Resend), estos
   son notificaciones internas: solo insertan filas en `notificaciones`, así que
   pg_cron puede llamar una función SQL pura sin Edge Function ni provider.

   Destinatarios:
   - Owner del evento + miembros activos del equipo.
   - Asistentes con cuenta (tickets.user_id no null) y ticket pagado/usado.

   Idempotencia: tabla recordatorio_inapp_log con unique (scope_id, evento_id, tipo).
*/

create table if not exists public.recordatorio_inapp_log (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  scope_id    uuid not null,            -- user_id destinatario
  tipo        text not null,            -- t7d | t1d | t1h
  created_at  timestamptz not null default now(),
  unique (scope_id, evento_id, tipo)
);

create index if not exists rec_inapp_log_evento_idx
  on public.recordatorio_inapp_log (evento_id);

/* Genera recordatorios in-app pendientes. Devuelve cuántas notificaciones creó.
   Llamable por pg_cron: select public.generar_recordatorios_inapp(); */
create or replace function public.generar_recordatorios_inapp()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creadas integer := 0;
  v_rec record;
  v_tipo text;
  v_label text;
begin
  for v_rec in
    with eventos_proximos as (
      select
        e.id as evento_id, e.titulo, e.owner_id, e.slug, e.fecha_inicio,
        case
          when e.fecha_inicio between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour' then 't7d'
          when e.fecha_inicio between now() + interval '23 hours'         and now() + interval '25 hours'         then 't1d'
          when e.fecha_inicio between now() + interval '45 minutes'       and now() + interval '1 hour 15 minutes' then 't1h'
          else null
        end as tipo
      from public.eventos e
      where e.estado = 'publicado'
        and e.deleted_at is null
        and e.email_reminders = true
    ),
    destinatarios as (
      /* Owner */
      select ep.evento_id, ep.titulo, ep.slug, ep.tipo, ep.owner_id as user_id
      from eventos_proximos ep where ep.tipo is not null
      union
      /* Equipo activo */
      select ep.evento_id, ep.titulo, ep.slug, ep.tipo, m.user_id
      from eventos_proximos ep
      join public.event_members m on m.evento_id = ep.evento_id and m.status = 'active' and m.user_id is not null
      where ep.tipo is not null
      union
      /* Asistentes con cuenta y ticket válido */
      select ep.evento_id, ep.titulo, ep.slug, ep.tipo, t.user_id
      from eventos_proximos ep
      join public.tickets t on t.evento_id = ep.evento_id and t.user_id is not null
        and t.estado in ('pagado', 'usado')
      where ep.tipo is not null
    )
    select distinct d.evento_id, d.titulo, d.slug, d.tipo, d.user_id
    from destinatarios d
    where not exists (
      select 1 from public.recordatorio_inapp_log l
      where l.scope_id = d.user_id and l.evento_id = d.evento_id and l.tipo = d.tipo
    )
  loop
    v_tipo := v_rec.tipo;
    v_label := case v_tipo
      when 't7d' then 'en 7 días'
      when 't1d' then 'mañana'
      when 't1h' then 'en 1 hora'
      else 'pronto'
    end;

    insert into public.notificaciones (user_id, tipo, titulo, cuerpo, link, evento_id)
    values (
      v_rec.user_id,
      'sistema',
      'Recordatorio: ' || v_rec.titulo,
      'El evento empieza ' || v_label || '.',
      '/explorar/' || v_rec.slug,
      v_rec.evento_id
    );

    insert into public.recordatorio_inapp_log (evento_id, scope_id, tipo)
    values (v_rec.evento_id, v_rec.user_id, v_tipo);

    v_creadas := v_creadas + 1;
  end loop;

  return v_creadas;
end$$;

/* Permisos: el service_role / postgres puede ejecutarla. RLS no aplica a
   security definer functions. */


-- ════════════════════════════════════════════════════════════
-- 0024_loyalty_recompensas.sql
-- ════════════════════════════════════════════════════════════
/* GESTEK — Fidelidad y recompensas escopadas por organizador.

   Dos audiencias:
   - 'cliente'  : asistente con cuenta que acumula puntos con un organizador
                  asistiendo a sus eventos. Canjea recompensas que ese
                  organizador define. Canje = código automático.
   - 'empleado' : miembro del equipo que acumula puntos trabajando (tareas,
                  check-ins). Ranking global del organizador + por evento.

   points_log (0001) se extiende con organizador_id + audiencia para atribución.
*/

alter table public.points_log
  add column if not exists organizador_id uuid references public.profiles(id) on delete set null,
  add column if not exists audiencia      text not null default 'cliente';
    -- cliente | empleado

create index if not exists points_log_org_aud_idx
  on public.points_log (organizador_id, audiencia, user_id);
create index if not exists points_log_evento_aud_idx
  on public.points_log (evento_id, audiencia) where evento_id is not null;

/* Balance cacheado por (usuario, organizador, audiencia). Es la fuente para
   ranking global y para el saldo canjeable del cliente. */
create table if not exists public.puntos_balance (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  organizador_id uuid not null references public.profiles(id) on delete cascade,
  audiencia      text not null,                     -- cliente | empleado
  puntos         integer not null default 0,
  updated_at     timestamptz not null default now(),
  unique (user_id, organizador_id, audiencia)
);

create index if not exists puntos_balance_rank_idx
  on public.puntos_balance (organizador_id, audiencia, puntos desc);

/* Recompensas que define un organizador, para una audiencia. */
create table if not exists public.recompensas (
  id             uuid primary key default gen_random_uuid(),
  organizador_id uuid not null references public.profiles(id) on delete cascade,
  audiencia      text not null,                     -- cliente | empleado
  titulo         text not null,
  descripcion    text,
  costo_puntos   integer not null check (costo_puntos > 0),
  stock          integer,                           -- null = ilimitado
  canjeados      integer not null default 0,
  activo         boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists recompensas_org_idx
  on public.recompensas (organizador_id, audiencia, activo);

/* Canjes realizados. Código automático (estado 'entregado' al crear). */
create table if not exists public.canjes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  organizador_id uuid not null references public.profiles(id) on delete cascade,
  recompensa_id  uuid references public.recompensas(id) on delete set null,
  audiencia      text not null,
  titulo         text not null,                     -- snapshot por si borran la recompensa
  costo_puntos   integer not null,
  codigo         text not null,
  estado         text not null default 'entregado', -- entregado | usado | cancelado
  created_at     timestamptz not null default now()
);

create unique index if not exists canjes_codigo_idx on public.canjes (codigo);
create index if not exists canjes_user_idx          on public.canjes (user_id, created_at desc);
create index if not exists canjes_org_idx           on public.canjes (organizador_id, created_at desc);

/* ── RLS ── */
alter table public.puntos_balance enable row level security;
alter table public.recompensas    enable row level security;
alter table public.canjes         enable row level security;

/* Balance: el usuario ve los suyos; el organizador ve los de su comunidad. */
drop policy if exists pb_self on public.puntos_balance;
create policy pb_self on public.puntos_balance
  for select using (user_id = auth.uid() or organizador_id = auth.uid());

/* Recompensas: el organizador gestiona las suyas; cualquiera autenticado puede
   leer las activas (para que clientes/empleados las vean). */
drop policy if exists recompensas_owner on public.recompensas;
create policy recompensas_owner on public.recompensas
  for all using (organizador_id = auth.uid());

drop policy if exists recompensas_read on public.recompensas;
create policy recompensas_read on public.recompensas
  for select using (activo = true);

/* Canjes: el usuario ve los suyos; el organizador ve los de su comunidad. */
drop policy if exists canjes_self on public.canjes;
create policy canjes_self on public.canjes
  for select using (user_id = auth.uid() or organizador_id = auth.uid());

/* Canje atómico: valida saldo, descuenta puntos, descuenta stock, registra canje.
   Devuelve el código generado o lanza excepción con mensaje claro. */
create or replace function public.canjear_recompensa(p_user uuid, p_recompensa uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec   record;
  v_saldo integer;
  v_codigo text;
begin
  select * into v_rec from public.recompensas where id = p_recompensa for update;
  if not found then raise exception 'Recompensa no encontrada.'; end if;
  if not v_rec.activo then raise exception 'Recompensa no disponible.'; end if;
  if v_rec.stock is not null and v_rec.canjeados >= v_rec.stock then
    raise exception 'Recompensa agotada.';
  end if;

  select coalesce(puntos, 0) into v_saldo
  from public.puntos_balance
  where user_id = p_user and organizador_id = v_rec.organizador_id and audiencia = v_rec.audiencia;

  if coalesce(v_saldo, 0) < v_rec.costo_puntos then
    raise exception 'Puntos insuficientes (tenés %, necesitás %).', coalesce(v_saldo,0), v_rec.costo_puntos;
  end if;

  update public.puntos_balance
    set puntos = puntos - v_rec.costo_puntos, updated_at = now()
    where user_id = p_user and organizador_id = v_rec.organizador_id and audiencia = v_rec.audiencia;

  update public.recompensas set canjeados = canjeados + 1 where id = p_recompensa;

  v_codigo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.canjes (user_id, organizador_id, recompensa_id, audiencia, titulo, costo_puntos, codigo)
  values (p_user, v_rec.organizador_id, p_recompensa, v_rec.audiencia, v_rec.titulo, v_rec.costo_puntos, v_codigo);

  return v_codigo;
end$$;


-- ════════════════════════════════════════════════════════════
-- 0025_audit_log.sql
-- ════════════════════════════════════════════════════════════
/* GESTEK — Auditoría de acciones del equipo (feature plan Pro).
   Una fila por acción relevante hecha sobre un evento: quién, qué, sobre qué
   entidad, con qué detalle. El backend escribe con service_role (best-effort);
   el owner lee desde el panel. */

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_email text,                       -- snapshot por si borran el perfil
  accion      text not null,
    -- evento.crear | evento.editar | evento.estado | evento.borrar
    -- equipo.invitar | equipo.rol | equipo.quitar
    -- rol.crear | rol.editar | rol.borrar
    -- ticket.crear | ticket.editar | ticket.borrar
  entidad     text,                       -- evento | miembro | rol | ticket | ...
  entidad_id  uuid,
  detalle     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_evento_idx
  on public.audit_log (evento_id, created_at desc);
create index if not exists audit_log_actor_idx
  on public.audit_log (actor_id) where actor_id is not null;

alter table public.audit_log enable row level security;

/* Solo el owner del evento ve su auditoría. Insert lo hace el backend
   (service_role bypassa RLS). */
drop policy if exists audit_log_owner on public.audit_log;
create policy audit_log_owner on public.audit_log
  for select using (
    exists (select 1 from public.eventos e where e.id = audit_log.evento_id and e.owner_id = auth.uid())
  );


-- ════════════════════════════════════════════════════════════
-- 0026_storage_hardening.sql
-- ════════════════════════════════════════════════════════════
/* GESTEK — Hardening de storage (auditoría de seguridad sección 3).

   Las policies de 0004 (avatars) y 0005 (event-media) ya escopan escritura por
   carpeta = auth.uid() y lectura pública. Esta migración:
   - Endurece límites de tamaño y MIME types (defensa ante uploads abusivos).
   - Re-afirma las policies de forma idempotente (estado seguro garantizado
     aunque alguien las haya tocado a mano).
   - Garantiza que NO exista escritura anónima/pública. */

/* ── Límites más conservadores ── */
update storage.buckets
  set file_size_limit = 3 * 1024 * 1024,                       -- 3 MB avatares
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/avif']
  where id = 'avatars';

update storage.buckets
  set file_size_limit = 15 * 1024 * 1024,                      -- 15 MB media de evento (incluye audio)
      allowed_mime_types = array[
        'image/jpeg','image/png','image/webp','image/gif','image/avif',
        'audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav'
      ]
  where id = 'event-media';

/* ── Re-afirmar policies (idempotente) ── */
do $$
begin
  /* avatars: lectura pública, escritura solo dueño de la carpeta */
  drop policy if exists "avatars_public_read"  on storage.objects;
  drop policy if exists "avatars_owner_insert" on storage.objects;
  drop policy if exists "avatars_owner_update" on storage.objects;
  drop policy if exists "avatars_owner_delete" on storage.objects;

  create policy "avatars_public_read" on storage.objects
    for select using (bucket_id = 'avatars');
  create policy "avatars_owner_insert" on storage.objects
    for insert with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
  create policy "avatars_owner_update" on storage.objects
    for update using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
  create policy "avatars_owner_delete" on storage.objects
    for delete using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

  /* event-media: igual */
  drop policy if exists "event_media_public_read"  on storage.objects;
  drop policy if exists "event_media_owner_insert" on storage.objects;
  drop policy if exists "event_media_owner_update" on storage.objects;
  drop policy if exists "event_media_owner_delete" on storage.objects;

  create policy "event_media_public_read" on storage.objects
    for select using (bucket_id = 'event-media');
  create policy "event_media_owner_insert" on storage.objects
    for insert with check (bucket_id = 'event-media' and auth.uid()::text = (storage.foldername(name))[1]);
  create policy "event_media_owner_update" on storage.objects
    for update using (bucket_id = 'event-media' and auth.uid()::text = (storage.foldername(name))[1]);
  create policy "event_media_owner_delete" on storage.objects
    for delete using (bucket_id = 'event-media' and auth.uid()::text = (storage.foldername(name))[1]);
end$$;

/* RLS en storage.objects ya viene forzada por Supabase. Las policies de insert
   exigen auth.uid(), por lo que un cliente anónimo (anon key sin sesión) NO
   puede subir archivos a ningún bucket. Lectura pública es intencional
   (avatares y covers se muestran en páginas públicas). */


-- ════════════════════════════════════════════════════════════
-- 0027_api_webhooks.sql
-- ════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════
-- 0028_event_requests.sql
-- ════════════════════════════════════════════════════════════
-- GESTEK — Sugerencias / solicitudes / mensajes del equipo hacia el organizador.
-- El equipo (miembros activos) crea entradas; el organizador las gestiona.

create table if not exists public.event_requests (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  autor_id    uuid references public.profiles(id) on delete set null,
  tipo        text not null default 'sugerencia',   -- sugerencia | solicitud | mensaje | reporte
  titulo      text,
  contenido   text not null,
  estado      text not null default 'abierta',       -- abierta | en_revision | resuelta | descartada
  respuesta   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists event_requests_evento_idx on public.event_requests (evento_id, created_at desc);
create index if not exists event_requests_autor_idx  on public.event_requests (autor_id);
create index if not exists event_requests_estado_idx on public.event_requests (evento_id) where estado <> 'resuelta';

commit;
