-- 0090 · Los roles, llamados por lo que son — y sin conceder de más.
-- APLICADA el 2026-09-02. Comprobado después: 0 «Speaker», 0 «Expositor», 0
-- «Staff · Acceso»; 33 «Puerta», 33 «Atención», 18 «Programación» con torneos y
-- 18 «Moderación» ya sin la agenda. Ningún miembro se quedó sin rol.
--
-- Va DESPUÉS de la 0089, que crea «Administrador» y realinea los permisos.
--
-- ── Por qué ──────────────────────────────────────────────────────────────
--
-- Tres roles del catálogo daban algo distinto de lo que su nombre promete, y
-- dos de ellos ni siquiera son puestos de trabajo:
--
--   «Speaker»    → `gestionar_agenda`. Un ponente podía editar la agenda
--                  ENTERA del evento: mover charlas ajenas, borrarlas, cambiar
--                  cupos. Un ponente es alguien que habla, no quien programa.
--   «Expositor»  → `gestionar_expositores`. Un expositor podía administrar a
--                  TODOS los expositores, no su propia ficha. Y el expositor
--                  de verdad ya tiene su camino: `/expositor/:codigo`, con su
--                  lista corta de campos (`CAMPOS_EDITABLES_EXPOSITOR`).
--   «Moderación» → `gestionar_agenda` además de lo del chat. Moderar el chat
--                  no tiene nada que ver con programar el evento.
--
-- Lo que hace este archivo es RENOMBRAR, no borrar y crear: los 29 miembros
-- apuntan a un `rol_id`, y borrar un rol para poner otro con el nombre bueno
-- dejaría a esa gente sin permisos en 27 eventos. Renombrando in situ, el id no
-- cambia y nadie se entera.
--
-- ── Lo que NO se toca ────────────────────────────────────────────────────
--
-- Sólo se renombra donde el rol sigue teniendo su nombre de origen y su
-- descripción de origen. Si alguien ya lo llamó de otra forma, ese nombre es
-- suyo. Y los permisos sólo se quitan donde el rol tiene EXACTAMENTE lo que la
-- semilla le puso: cualquier ajuste manual se respeta.
--
-- No se borra ningún rol. «Staff · Logística» se queda: quitarlo dejaría sin
-- rol a quien lo tenga, y eso lo decide el organizador desde su pantalla, no
-- una migración.
--
-- Reversible: renombrar al revés y devolver el permiso. Está al final.
-- Idempotente.

-- ── 1 · La semilla, para los eventos que nazcan ──────────────────────────
create or replace function private.fn_roles_semilla()
returns table (nombre text, descripcion text, permissions jsonb, orden integer)
language sql
immutable
as $$
  values
    ('Administrador',     'Puede todo dentro del evento, salvo transferirlo o borrarlo',
      '["editar_evento","publicar_evento","editar_pagina_publica","gestionar_imagenes",
        "gestionar_agenda","gestionar_torneo","gestionar_expositores",
        "invitar_staff","gestionar_roles","remover_miembros",
        "gestionar_tickets","gestionar_descuentos",
        "ver_clientes","gestionar_clientes","checkin","vip_zone",
        "crear_canales","borrar_mensajes",
        "ver_pagos","reembolsar","ver_analytics"]'::jsonb, 0),
    ('Editor',            'Edita información, agenda y página pública',
      '["editar_evento","editar_pagina_publica","gestionar_imagenes","gestionar_agenda"]'::jsonb, 1),
    ('Coordinador',       'Coordina al staff y al evento completo',
      '["editar_evento","invitar_staff","gestionar_agenda","ver_clientes","ver_analytics","crear_canales"]'::jsonb, 2),
    ('Puerta',            'Controla el ingreso y escanea las entradas',
      '["checkin","ver_clientes"]'::jsonb, 3),
    ('Staff · Logística', 'Montaje, técnica y escenario',
      '["crear_canales","gestionar_agenda"]'::jsonb, 4),
    ('Atención',          'Atiende asistentes durante el evento',
      '["ver_clientes","checkin"]'::jsonb, 5),
    ('VIP host',          'Anfitrión de zona VIP',
      '["vip_zone","ver_clientes","checkin"]'::jsonb, 6),
    -- Quien COORDINA a los expositores, no un expositor. El expositor entra por
    -- su propio enlace y edita su ficha, no la de los demás.
    ('Coordinación de expositores', 'Gestiona los stands y las fichas de los expositores',
      '["gestionar_expositores"]'::jsonb, 7),
    -- Quien arma el programa. Un ponente no administra nada: su ficha vive en
    -- `speakers` y se le engancha a las actividades desde el Calendario.
    ('Programación',      'Arma el calendario: charlas, talleres y competencias',
      '["gestionar_agenda","gestionar_torneo"]'::jsonb, 8),
    ('Finanzas',          'Ve ingresos, facturación y reembolsos',
      '["ver_pagos","reembolsar","ver_clientes","ver_analytics"]'::jsonb, 9),
    -- Sin `gestionar_agenda`: moderar el chat no es programar el evento.
    ('Moderación',        'Modera el chat del evento',
      '["borrar_mensajes","crear_canales"]'::jsonb, 10);
$$;

-- ── 2 · Renombrar los que ya existen, sólo si nadie los tocó ─────────────
update public.event_roles
   set nombre      = 'Puerta',
       descripcion = 'Controla el ingreso y escanea las entradas'
 where is_system and nombre = 'Staff · Acceso'
   and descripcion = 'Controla entrada y hace check-in con QR';

update public.event_roles
   set nombre      = 'Atención',
       descripcion = 'Atiende asistentes durante el evento'
 where is_system and nombre = 'Staff · Atención';

update public.event_roles
   set nombre      = 'Coordinación de expositores',
       descripcion = 'Gestiona los stands y las fichas de los expositores'
 where is_system and nombre = 'Expositor'
   and descripcion = 'Gestiona su stand, su ficha y sus puntos';

update public.event_roles
   set nombre      = 'Programación',
       descripcion = 'Arma el calendario: charlas, talleres y competencias'
 where is_system and nombre = 'Speaker'
   and descripcion = 'Ponente: ve su franja y el cronograma';

update public.event_roles
   set descripcion = 'Modera el chat del evento'
 where is_system and nombre = 'Moderación'
   and descripcion = 'Modera el chat y la agenda pública';

-- ── 3 · Quitar lo que se concedía de más ─────────────────────────────────
--
-- Sólo donde el rol tiene EXACTAMENTE lo que la semilla le puso: si el
-- organizador le añadió o le quitó algo, esa lista es suya y no se toca.

-- «Programación» (antes Speaker) gana los torneos, que es lo suyo.
update public.event_roles
   set permissions = '["gestionar_agenda","gestionar_torneo"]'::jsonb
 where is_system and nombre = 'Programación'
   and private.fn_perms_iguales(permissions, '["gestionar_agenda"]'::jsonb);

-- «Moderación» pierde la agenda.
update public.event_roles
   set permissions = '["borrar_mensajes","crear_canales"]'::jsonb
 where is_system and nombre = 'Moderación'
   and private.fn_perms_iguales(
         permissions, '["borrar_mensajes","crear_canales","gestionar_agenda"]'::jsonb);

-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   update public.event_roles set nombre = 'Staff · Acceso' where nombre = 'Puerta' and is_system;
--   update public.event_roles set nombre = 'Staff · Atención' where nombre = 'Atención' and is_system;
--   update public.event_roles set nombre = 'Expositor' where nombre = 'Coordinación de expositores' and is_system;
--   update public.event_roles set nombre = 'Speaker', permissions = '["gestionar_agenda"]'::jsonb
--    where nombre = 'Programación' and is_system;
--   update public.event_roles
--      set permissions = '["borrar_mensajes","crear_canales","gestionar_agenda"]'::jsonb
--    where nombre = 'Moderación' and is_system;
