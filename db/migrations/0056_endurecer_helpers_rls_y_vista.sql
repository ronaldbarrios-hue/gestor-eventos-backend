-- 0056 · Endurecer lo que dejaron 0053 a 0055. YA APLICADA. Idempotente.
--
-- Tres cosas que señaló el linter de seguridad de Supabase, las tres
-- introducidas por las migraciones anteriores. Se arreglan aquí en vez de
-- editar aquellas, para que quien ya las aplicó llegue al mismo sitio.
--
-- 1. ERROR — v_participacion_sesiones quedó SECURITY DEFINER, que es el default
--    de las vistas en Postgres. Una vista así se evalúa con los permisos de
--    quien la creó y NO aplica la RLS de quien consulta: cualquiera con acceso a
--    la API podía leer la participación de eventos ajenos. Con
--    security_invoker = true manda la RLS del que pregunta. Al backend no le
--    afecta: usa la service key.
--
-- 2. WARN — fn_puede_ver_chat, fn_es_miembro_evento y fn_sync_inscritos_sesion
--    son SECURITY DEFINER y estaban en `public`, el esquema que PostgREST
--    expone: quedaban llamables por anon en /rest/v1/rpc/. Son ayudantes de
--    políticas y de triggers, no API.
--
--    Revocarles el EXECUTE no sirve: las expresiones de una política RLS las
--    evalúa el usuario que consulta, así que sin permiso de ejecución el chat
--    dejaría de funcionar entero. La salida correcta es moverlas a un esquema
--    que la API no exponga y referenciarlas con nombre completo.
--
-- 3. WARN — fn_traducir_permisos y fn_roles_semilla no fijaban search_path. La
--    primera era de un solo uso (corrió en la 0054) y se borra; la segunda se
--    mueve con search_path fijo.
--
-- Comprobado sobre la base después de aplicar, con el rol `authenticated` y un
-- jwt simulado:
--   · el dueño del evento ve sus canales y mensajes
--   · un miembro del equipo SIN boleta ve 4 canales — antes veía 0, y eso era
--     exactamente el "los mensajes no llegan sin recargar"
--   · un tercero CON acceso al chat del evento (ve sus 4 canales) ve 0 canales y
--     0 mensajes del DM ajeno
--   · un desconocido sin nada ve 0

create schema if not exists private;
revoke all on schema private from anon, authenticated;

/* ── Ayudantes de la RLS del chat, fuera del alcance de la API ── */
create or replace function private.fn_es_miembro_evento(p_evento_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.event_members m
    where m.evento_id = p_evento_id and m.user_id = p_user_id and m.status = 'active'
  );
$$;

create or replace function private.fn_puede_ver_chat(p_evento_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.eventos e where e.id = p_evento_id and e.owner_id = p_user_id
  )
  or private.fn_es_miembro_evento(p_evento_id, p_user_id)
  or exists (
    select 1 from public.tickets t
    where t.evento_id = p_evento_id and t.user_id = p_user_id
      and t.estado in ('pagado', 'usado')
  );
$$;

/* Las políticas apuntan a las nuevas. Mismo comportamiento que la 0053. */
drop policy if exists chat_channels_select on public.chat_channels;
create policy chat_channels_select on public.chat_channels
  for select using (
    private.fn_puede_ver_chat(chat_channels.evento_id, auth.uid())
    and (
      coalesce(chat_channels.tipo, 'canal') <> 'dm'
      or auth.uid() = any (coalesce(chat_channels.dm_users, '{}'::uuid[]))
    )
  );

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select using (
    exists (
      select 1 from public.chat_channels c
      where c.id = chat_messages.channel_id
        and private.fn_puede_ver_chat(c.evento_id, auth.uid())
        and (
          coalesce(c.tipo, 'canal') <> 'dm'
          or auth.uid() = any (coalesce(c.dm_users, '{}'::uuid[]))
        )
    )
  );

/* ── El contador de inscritos ── */
create or replace function private.fn_sync_inscritos_sesion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare objetivo uuid;
begin
  objetivo := coalesce(new.session_id, old.session_id);
  update public.agenda_sessions s
     set inscritos = (
       select count(*) from public.sesion_inscripciones i
       where i.session_id = objetivo and i.estado <> 'cancelada'
     )
   where s.id = objetivo;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_inscritos_sesion on public.sesion_inscripciones;
create trigger trg_sync_inscritos_sesion
  after insert or update or delete on public.sesion_inscripciones
  for each row execute function private.fn_sync_inscritos_sesion();

/* ── La semilla de roles ── */
create or replace function private.fn_roles_semilla()
returns table (nombre text, descripcion text, permissions jsonb, orden integer)
language sql immutable set search_path = public, pg_temp as $$
  values
    ('Editor',            'Edita información, agenda y página pública',
      '["editar_evento","editar_pagina_publica","gestionar_imagenes","gestionar_agenda"]'::jsonb, 1),
    ('Coordinador',       'Coordina al staff y al evento completo',
      '["editar_evento","invitar_staff","gestionar_agenda","ver_clientes","ver_analytics","crear_canales"]'::jsonb, 2),
    ('Staff · Acceso',    'Controla entrada y hace check-in con QR',
      '["checkin","ver_clientes"]'::jsonb, 3),
    ('Staff · Logística', 'Montaje, técnica y escenario',
      '["crear_canales","gestionar_agenda"]'::jsonb, 4),
    ('Staff · Atención',  'Atiende asistentes durante el evento',
      '["ver_clientes","checkin"]'::jsonb, 5),
    ('VIP host',          'Anfitrión de zona VIP',
      '["vip_zone","ver_clientes","checkin"]'::jsonb, 6),
    ('Expositor',         'Gestiona su stand, su ficha y sus puntos',
      '["gestionar_expositores"]'::jsonb, 7),
    ('Speaker',           'Ponente: ve su franja y el cronograma',
      '["gestionar_agenda"]'::jsonb, 8),
    ('Finanzas',          'Ve ingresos, facturación y reembolsos',
      '["ver_pagos","reembolsar","ver_clientes","ver_analytics"]'::jsonb, 9),
    ('Moderación',        'Modera el chat y la agenda pública',
      '["borrar_mensajes","crear_canales","gestionar_agenda"]'::jsonb, 10);
$$;

create or replace function public.seed_event_roles()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.event_roles (evento_id, nombre, descripcion, permissions, is_system, orden)
  select new.id, r.nombre, r.descripcion, r.permissions, true, r.orden
    from private.fn_roles_semilla() r
  on conflict (evento_id, nombre) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_event_roles on public.eventos;
create trigger trg_seed_event_roles
  after insert on public.eventos
  for each row execute function public.seed_event_roles();

/* ── Fuera las de public ── */
drop function if exists public.fn_puede_ver_chat(uuid, uuid);
drop function if exists public.fn_es_miembro_evento(uuid, uuid);
drop function if exists public.fn_sync_inscritos_sesion();
drop function if exists public.fn_roles_semilla();
/* Era de un solo uso: ya tradujo lo que había en la 0054. */
drop function if exists public.fn_traducir_permisos(jsonb);

/* ── La vista respeta la RLS de quien consulta ── */
create or replace view public.v_participacion_sesiones
with (security_invoker = true) as
select
  s.evento_id,
  s.id            as session_id,
  s.titulo,
  s.inicio,
  s.cupo,
  s.inscritos,
  count(i.id) filter (where i.estado = 'asistio')                as asistentes,
  count(i.id) filter (where i.estado = 'inscrito')               as solo_inscritos,
  count(i.id) filter (where i.estado = 'cancelada')              as canceladas,
  count(i.id) filter (where i.ticket_id is null
                        and i.estado <> 'cancelada')             as sin_boleta
from public.agenda_sessions s
left join public.sesion_inscripciones i on i.session_id = s.id
group by s.evento_id, s.id, s.titulo, s.inicio, s.cupo, s.inscritos;

/* ── Nota sobre lo que el linter sigue señalando y NO es de estas migraciones ──
   Catorce tablas tienen RLS activada sin ninguna política: catalogo_roles,
   cobros_vacantes, event_form_fields, event_requests, event_waitlist,
   evento_alertas, evento_motivos, perfil_talento, postulaciones,
   recordatorio_inapp_log, talento_resenas, ticket_interacciones,
   ticket_movimientos y vacantes.

   RLS sin políticas deniega todo por defecto, así que no hay fuga: el backend
   entra con la service key y no le afecta. Pero significa que ninguna de esas
   tablas se puede leer desde el cliente, y si algún día alguna hace falta en el
   navegador va a fallar sin explicación aparente. Queda anotado, no se toca
   aquí: decidir la política de cada una es un cambio con criterio propio. */
