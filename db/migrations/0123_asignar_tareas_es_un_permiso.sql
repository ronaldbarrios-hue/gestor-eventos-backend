-- 0123 · Asignar tareas es un permiso, no ser el dueño
--
-- Repartir el trabajo del evento —crear tareas, asignarlas, cambiar una fecha,
-- ver el tablero completo— no era un permiso. Era `owner_id`, comprobado dentro
-- del handler con un «Solo el organizador puede crear tareas».
--
-- O sea que quien lleva la logística de un evento, la persona cuyo trabajo ES
-- repartir el trabajo, podía abrir el tablero y no poner nada en él. Y veía
-- sólo las tareas asignadas a ella misma, que para quien asigna es no ver nada:
-- las tareas que reparte son de otros por definición. Cada asignación había que
-- pedírsela a quien creó el evento, una por una.
--
-- ── Lo que esta migración cuida ────────────────────────────────────────
--
-- Que nadie pierda nada, y que nada haga falta con urgencia.
--
-- La ruta acepta `gestionar_tareas` **o** `editar_evento`, y eso último ya lo
-- tienen Administrador, Editor y Coordinador. Así que sin aplicar esto todo
-- sigue funcionando igual que hoy y además se puede conceder el permiso nuevo a
-- mano desde el panel: los permisos son cadenas en `event_roles.permissions`,
-- no hace falta migrar para marcar una casilla.
--
-- Lo que esto arregla es la promesa del rol «Administrador» —«puede todo dentro
-- del evento»—, cuya lista está escrita a mano en la semilla. Sin tocarla, el
-- catálogo crece y ese rol se queda atrás, y eso no da error: da un 403 a
-- alguien que debería poder. Lo caza `test/rolesSemilla.test.js`, que es quien
-- pidió esta migración.

-- ── 1 · La semilla, para los eventos que nazcan ────────────────────────

create or replace function private.fn_roles_semilla()
returns table (nombre text, descripcion text, permissions jsonb, orden integer)
language sql
immutable
as $$
  values
    ('Administrador',     'Puede todo dentro del evento, salvo transferirlo o borrarlo',
      '["editar_evento","publicar_evento","editar_pagina_publica","gestionar_imagenes",
        "gestionar_agenda","gestionar_torneo","gestionar_expositores","gestionar_accesos",
        "invitar_staff","gestionar_roles","remover_miembros","gestionar_solicitudes",
        "gestionar_tareas","ver_documentos",
        "gestionar_tickets","gestionar_descuentos",
        "ver_clientes","gestionar_clientes","checkin","vip_zone","borrar_boletas",
        "crear_canales","borrar_mensajes","publicar_anuncios",
        "ver_pagos","reembolsar","ver_analytics"]'::jsonb, 0),
    ('Editor',            'Edita información, agenda y página pública',
      '["editar_evento","editar_pagina_publica","gestionar_imagenes","gestionar_agenda","ver_documentos"]'::jsonb, 1),
    -- «Coordina al staff y al evento completo»: si algún rol reparte el
    -- trabajo, es éste. Ya podía por `editar_evento`; ahora se dice.
    ('Coordinador',       'Coordina al staff y al evento completo',
      '["editar_evento","invitar_staff","gestionar_agenda","ver_clientes","ver_analytics",
        "crear_canales","gestionar_solicitudes","gestionar_tareas","ver_documentos"]'::jsonb, 2),
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
--
-- Sólo a los dos roles que ya podían hacerlo por `editar_evento`: no se le da
-- a nadie un poder que no tuviera. Se AÑADE (`permissions || …` con
-- `jsonb_agg(distinct p)`), nunca se reemplaza, y se puede correr dos veces.

update public.event_roles r
   set permissions = coalesce(
         (select jsonb_agg(distinct p)
            from jsonb_array_elements_text(r.permissions || '["gestionar_tareas"]'::jsonb) p),
         r.permissions)
 where r.is_system
   and r.nombre in ('Administrador', 'Coordinador')
   and not (r.permissions ? 'gestionar_tareas');

-- ── Comprobación ───────────────────────────────────────────────────────
--
--   -- Los dos roles del sistema lo tienen:
--   select nombre, count(*) from public.event_roles
--    where is_system and nombre in ('Administrador','Coordinador')
--      and permissions ? 'gestionar_tareas' group by 1;
--
--   -- Y nadie más lo recibió sin pedirlo:
--   select count(*) from public.event_roles
--    where permissions ? 'gestionar_tareas'
--      and not (is_system and nombre in ('Administrador','Coordinador'));
--   -- 0, salvo los roles a medida donde se haya marcado a mano
--
-- ── Vuelta atrás ───────────────────────────────────────────────────────
--
--   update public.event_roles
--      set permissions = (select jsonb_agg(p) from jsonb_array_elements_text(permissions) p
--                          where p <> 'gestionar_tareas');
--
-- Y volver a aplicar la 0122 para la semilla. Nadie se queda sin poder repartir
-- tareas: `editar_evento` sigue valiendo.
