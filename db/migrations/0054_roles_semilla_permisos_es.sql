-- 0054 · Cuatro roles nuevos, y el archivo de la semilla puesto al día. YA APLICADA.
-- Idempotente. Ojo: la 0056 mueve fn_roles_semilla al esquema `private`.
--
-- SOBRE 0007_event_roles.sql: ese archivo sembraba los roles con ids de permiso
-- en INGLÉS ("edit_event", "invite_staff", "view", "internal_chat",
-- "attendee_lookup"), que no existen para el verificador de lib/acceso.js ni
-- para el catálogo de src/lib/permisos.js — los dos usan español. Con esa
-- versión, cada rol semilla concedía exactamente cero permisos y solo
-- funcionaba ser dueño del evento.
--
-- Comprobado contra la base: NO era la que estaba corriendo. Alguien había
-- corregido seed_event_roles directamente sobre Supabase sin dejar migración,
-- así que el archivo 0007 quedó mintiendo y quien reconstruyera desde las
-- migraciones se llevaba el fallo entero.
--
-- **Ya está arreglado en el origen:** 0007 siembra en español los mismos
-- valores que deja esta migración para esos seis roles. Reconstruir desde cero
-- da el mismo resultado con o sin la 0054 detrás, y esta sigue siendo
-- necesaria solo por los cuatro roles nuevos.
--
-- Esta migración hace tres cosas:
--   1. Deja la función escrita en el repo, en español, para que reconstruir la
--      base desde cero dé el mismo resultado que la base de hoy.
--   2. Añade los cuatro roles que no existen en ningún evento: Expositor,
--      Speaker, Finanzas y Moderación.
--   3. Traduce por si acaso los ids en inglés que hubieran quedado sueltos en
--      algún rol o en los custom_permissions de algún miembro. Sobre esta base
--      no encuentra nada y no cambia una fila; se deja porque es lo que hace
--      seguro aplicarla en otro entorno (staging, una copia, un despliegue
--      nuevo) donde sí esté la versión vieja.
--
-- "view" se descarta: no correspondía a ningún permiso real. La lectura del
-- evento la da ser miembro activo, no un permiso.

/* ── Traducir lo que ya está guardado ─────────────────────────────────
   Se toca `permissions` de event_roles y `custom_permissions` de
   event_members, que es el otro sitio donde se guardan ids sueltos.

   "view" se descarta: no existe como permiso. */
create or replace function public.fn_traducir_permisos(p jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_agg(distinct nuevo) filter (where nuevo is not null),
    '[]'::jsonb
  )
  from (
    select case valor
      when 'edit_event'       then 'editar_evento'
      when 'invite_staff'     then 'invitar_staff'
      when 'manage_roles'     then 'gestionar_roles'
      when 'remove_members'   then 'remover_miembros'
      when 'manage_tickets'   then 'gestionar_tickets'
      when 'attendee_lookup'  then 'ver_clientes'
      when 'manage_attendees' then 'gestionar_clientes'
      when 'internal_chat'    then 'crear_canales'
      when 'view_analytics'   then 'ver_analytics'
      when 'view_payments'    then 'ver_pagos'
      /* 'view' y cualquier cosa desconocida se caen aquí. Los ids que ya
         estaban en español pasan tal cual. */
      when 'view'             then null
      else valor
    end as nuevo
    from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) as t(valor)
  ) x;
$$;

update public.event_roles
   set permissions = public.fn_traducir_permisos(permissions)
 where permissions is not null
   and exists (
     select 1 from jsonb_array_elements_text(permissions) as t(v)
     where t.v in ('edit_event','invite_staff','manage_roles','remove_members',
                   'manage_tickets','attendee_lookup','manage_attendees',
                   'internal_chat','view_analytics','view_payments','view')
   );

update public.event_members
   set custom_permissions = (
     select coalesce(array_agg(x), '{}'::text[])
     from jsonb_array_elements_text(
       public.fn_traducir_permisos(to_jsonb(custom_permissions))
     ) as t(x)
   )
 where custom_permissions is not null
   and custom_permissions && array['edit_event','invite_staff','manage_roles',
       'remove_members','manage_tickets','attendee_lookup','manage_attendees',
       'internal_chat','view_analytics','view_payments','view'];

/* ── Semilla nueva ────────────────────────────────────────────────────
   Diez roles. Los seis de antes con sus ids traducidos, más expositor,
   speaker, finanzas y moderación. */
create or replace function public.fn_roles_semilla()
returns table (nombre text, descripcion text, permissions jsonb, orden integer)
language sql
immutable
as $$
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
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.event_roles (evento_id, nombre, descripcion, permissions, is_system, orden)
  select new.id, r.nombre, r.descripcion, r.permissions, true, r.orden
    from public.fn_roles_semilla() r
  on conflict (evento_id, nombre) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_event_roles on public.eventos;
create trigger trg_seed_event_roles
  after insert on public.eventos
  for each row execute function public.seed_event_roles();

/* ── Backfill ─────────────────────────────────────────────────────────
   A los eventos que ya existen se les añaden solo los roles que les falten,
   por nombre. No se pisa ninguno: si el organizador editó "Editor" a mano,
   su versión se queda. */
insert into public.event_roles (evento_id, nombre, descripcion, permissions, is_system, orden)
select e.id, r.nombre, r.descripcion, r.permissions, true, r.orden
  from public.eventos e
  cross join public.fn_roles_semilla() r
 where e.deleted_at is null
on conflict (evento_id, nombre) do nothing;
