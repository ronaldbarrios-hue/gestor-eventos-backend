-- 0122 · Los permisos que faltaban
--
-- Cuatro cosas del panel no se podían conceder ni quitar por rol, porque no
-- existía el permiso:
--
--   Accesos e ingresos    era del DUEÑO y de nadie más. Eso deja a quien
--                         organiza como el único que puede decir que la puerta
--                         3 admite prensa — una tarea de logística que hace
--                         otra persona.
--   Anuncios              lo mismo, y quien lleva la comunicación de un
--                         festival no suele ser quien creó el evento aquí.
--   Documentos            al revés: no pedía NADA. Cualquier miembro del equipo
--                         veía los contratos y los riders.
--   Borrar boletas        no existía la acción. Anular deja la fila —y eso está
--                         bien casi siempre— pero los duplicados que deja un
--                         fallo hay que poder quitarlos, y no con el mismo
--                         permiso que atiende asistentes. Con un contrato
--                         dentro eso no es una decisión, es un descuido.
--
-- ── Lo que esta migración cuida ────────────────────────────────────────
--
-- Que nadie PIERDA algo que ya tenía.
--
-- Los dos primeros sólo amplían: eran del dueño, así que dárselos a un rol no
-- le quita nada a nadie.
--
-- `ver_documentos` es el delicado, porque hoy lo tiene todo el mundo por
-- omisión. Se concede a TODOS los roles que ya existen: así hoy no cambia nada
-- —quien veía los documentos los sigue viendo— y lo que cambia es que a partir
-- de ahora se puede quitar. Un permiso nuevo que empieza quitando acceso es la
-- forma de que alguien descubra el cambio en mitad de un evento.

-- ── 1 · La semilla, para los eventos que nazcan ────────────────────────
--
-- El rol «Administrador» promete «puede todo dentro del evento». Su lista está
-- escrita a mano en la 0109, así que crecer el catálogo sin tocarla lo deja
-- incumpliendo su propia descripción — y eso no da error: da un 403 a alguien
-- que debería poder. Lo caza `test/rolesSemilla.test.js`.

create or replace function private.fn_roles_semilla()
returns table (nombre text, descripcion text, permissions jsonb, orden integer)
language sql
immutable
as $$
  values
    ('Administrador',     'Puede todo dentro del evento, salvo transferirlo o borrarlo',
      '["editar_evento","publicar_evento","editar_pagina_publica","gestionar_imagenes",
        "gestionar_agenda","gestionar_torneo","gestionar_expositores","gestionar_accesos",
        "invitar_staff","gestionar_roles","remover_miembros","gestionar_solicitudes","ver_documentos",
        "gestionar_tickets","gestionar_descuentos",
        "ver_clientes","gestionar_clientes","checkin","vip_zone","borrar_boletas",
        "crear_canales","borrar_mensajes","publicar_anuncios",
        "ver_pagos","reembolsar","ver_analytics"]'::jsonb, 0),
    ('Editor',            'Edita información, agenda y página pública',
      '["editar_evento","editar_pagina_publica","gestionar_imagenes","gestionar_agenda","ver_documentos"]'::jsonb, 1),
    ('Coordinador',       'Coordina al staff y al evento completo',
      '["editar_evento","invitar_staff","gestionar_agenda","ver_clientes","ver_analytics",
        "crear_canales","gestionar_solicitudes","ver_documentos"]'::jsonb, 2),
    ('Puerta',            'Controla el ingreso y escanea las entradas',
      '["checkin","ver_clientes"]'::jsonb, 3),
    -- Sin `gestionar_agenda`: montar el escenario no es armar el programa.
    -- Con `checkin`: lo que necesita es ver zonas y aforo el día del evento.
    ('Staff · Logística', 'Montaje, técnica y escenario',
      '["crear_canales","checkin","ver_documentos"]'::jsonb, 4),
    -- Atiende de verdad: reenviar una boleta y corregir un dato piden
    -- `gestionar_clientes`. Sin él, este rol sólo podía mirar.
    ('Atención',          'Atiende asistentes durante el evento',
      '["ver_clientes","gestionar_clientes","checkin","gestionar_solicitudes"]'::jsonb, 5),
    ('VIP host',          'Anfitrión de zona VIP',
      '["vip_zone","ver_clientes","checkin"]'::jsonb, 6),
    -- `ver_clientes` para poder sentar gente en la rueda con su correo (0108).
    ('Coordinación de expositores', 'Gestiona los stands y las fichas de los expositores',
      '["gestionar_expositores","ver_clientes"]'::jsonb, 7),
    ('Programación',      'Arma el calendario: charlas, talleres y competencias',
      '["gestionar_agenda","gestionar_torneo"]'::jsonb, 8),
    ('Finanzas',          'Ve ingresos, facturación y reembolsos',
      '["ver_pagos","reembolsar","ver_clientes","ver_analytics"]'::jsonb, 9),
    ('Moderación',        'Modera el chat del evento',
      '["borrar_mensajes","crear_canales"]'::jsonb, 10)
$$;

-- ── 2 · Los eventos que ya existen ─────────────────────────────────────

-- `ver_documentos` a TODOS los roles: es lo que todos tenían de hecho.
-- `jsonb_agg` sobre el conjunto para no duplicarlo si se corre dos veces.
update public.event_roles r
   set permissions = coalesce(
         (select jsonb_agg(distinct p)
            from jsonb_array_elements_text(r.permissions || '["ver_documentos"]'::jsonb) p),
         '["ver_documentos"]'::jsonb)
 where not (r.permissions ? 'ver_documentos');

-- Y los dos que eran del dueño, sólo al Administrador: es el rol cuya
-- descripción promete «puede todo». A los demás se los da quien organiza, a
-- mano, si quiere.
update public.event_roles r
   set permissions = coalesce(
         (select jsonb_agg(distinct p)
            from jsonb_array_elements_text(
              r.permissions || '["gestionar_accesos","publicar_anuncios","borrar_boletas"]'::jsonb) p),
         r.permissions)
 where r.is_system
   and r.nombre = 'Administrador';

-- ── Comprobación ───────────────────────────────────────────────────────
--
--   -- Ningún rol se quedó sin ver documentos:
--   select count(*) from public.event_roles where not (permissions ? 'ver_documentos');
--   -- 0
--
--   -- Y el Administrador tiene los tres nuevos:
--   select count(*) from public.event_roles
--    where is_system and nombre = 'Administrador'
--      and not (permissions ?& array['ver_documentos','gestionar_accesos','publicar_anuncios','borrar_boletas']);
--   -- 0
--
-- ── Vuelta atrás ───────────────────────────────────────────────────────
--
-- No hace falta: los permisos que sobran no hacen nada si el código no los
-- comprueba. Si aun así se quiere limpiar:
--
--   update public.event_roles
--      set permissions = (select jsonb_agg(p) from jsonb_array_elements_text(permissions) p
--                          where p not in ('ver_documentos','gestionar_accesos','publicar_anuncios','borrar_boletas'));
--
-- Y volver a aplicar la 0109 para la semilla.
