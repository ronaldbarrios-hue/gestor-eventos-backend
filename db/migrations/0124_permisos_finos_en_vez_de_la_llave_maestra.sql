-- 0124 · Permisos finos, en vez de la llave maestra
--
-- ── De dónde sale ──────────────────────────────────────────────────────
--
-- De capacitar a quien lleva la logística de un evento real: hubo que darle
-- permisos **muy altos** para que pudiera operar.
--
-- La razón está medida. `editar_evento` aparece en once archivos de rutas, y en
-- cinco sitios es el ÚNICO permiso que abre la puerta. Así que para dejar que
-- alguien suba un contrato, diseñe la escarapela o cargue el padrón de
-- invitados, había que darle además: editar el evento entero, su formulario de
-- compra, las vacantes, la configuración del SMTP y la del torneo.
--
-- Eso no es un permiso, es una llave maestra con otro nombre.
--
-- ── Los cuatro que se parten ───────────────────────────────────────────
--
--   gestionar_documentos    subir y quitar contratos, riders, planos
--   gestionar_acreditacion  diseñar la escarapela y el carné
--   gestionar_padron        cargar la lista previa de invitados
--   gestionar_vacantes      publicar vacantes y mover postulaciones
--
-- Los tres primeros guardan dentro de `page_json`, que es un cajón donde vive
-- media plataforma. Abrirlo entero a quien sólo tiene que colgar un PDF le deja
-- reescribir la landing, así que cada permiso dice qué CLAVE abre
-- (`lib/quePuedeEditar.js`). Ya existía ese recorte para `gestionar_accesos`,
-- escrito como una adivinanza que fallaba con el segundo permiso estrecho.
--
-- ── Lo que esta migración cuida ────────────────────────────────────────
--
-- Que nadie pierda nada y que nada haga falta con urgencia.
--
-- Las rutas aceptan el permiso nuevo **o** `editar_evento`, así que sin aplicar
-- esto todo sigue funcionando igual que hoy, y el permiso nuevo se puede marcar
-- a mano en el panel: son cadenas en `event_roles.permissions`, no hace falta
-- migrar para ponerle una casilla a un rol.
--
-- Lo que esto arregla es la promesa del rol «Administrador» —«puede todo dentro
-- del evento»—, cuya lista está escrita a mano. Lo caza
-- `test/rolesSemilla.test.js`, que es quien pidió esta migración.

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
        "gestionar_tareas","ver_documentos","gestionar_documentos","gestionar_vacantes",
        "gestionar_tickets","gestionar_descuentos",
        "ver_clientes","gestionar_clientes","checkin","vip_zone","borrar_boletas",
        "gestionar_acreditacion","gestionar_padron",
        "crear_canales","borrar_mensajes","publicar_anuncios",
        "ver_pagos","reembolsar","ver_analytics"]'::jsonb, 0),
    ('Editor',            'Edita información, agenda y página pública',
      '["editar_evento","editar_pagina_publica","gestionar_imagenes","gestionar_agenda","ver_documentos"]'::jsonb, 1),
    ('Coordinador',       'Coordina al staff y al evento completo',
      '["editar_evento","invitar_staff","gestionar_agenda","ver_clientes","ver_analytics",
        "crear_canales","gestionar_solicitudes","gestionar_tareas","ver_documentos"]'::jsonb, 2),
    ('Puerta',            'Controla el ingreso y escanea las entradas',
      '["checkin","ver_clientes"]'::jsonb, 3),
    -- Montaje y escenario. Se le añaden los dos que necesita de verdad y que
    -- antes obligaban a darle el evento entero: colgar los planos y el rider, y
    -- dejar listas las escarapelas del día.
    ('Staff · Logística', 'Montaje, técnica y escenario',
      '["crear_canales","checkin","ver_documentos","gestionar_documentos",
        "gestionar_acreditacion","gestionar_accesos"]'::jsonb, 4),
    ('Atención',          'Atiende asistentes durante el evento',
      '["ver_clientes","gestionar_clientes","checkin","gestionar_solicitudes","gestionar_padron"]'::jsonb, 5),
    ('VIP host',          'Anfitrión de zona VIP',
      '["vip_zone","ver_clientes","checkin"]'::jsonb, 6),
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
-- Sólo a quien YA podía hacerlo por `editar_evento`: no se le da a nadie un
-- poder que no tuviera. Se AÑADE, nunca se reemplaza, y se puede correr dos
-- veces.

update public.event_roles r
   set permissions = coalesce(
         (select jsonb_agg(distinct p)
            from jsonb_array_elements_text(
              r.permissions || '["gestionar_documentos","gestionar_acreditacion",
                                 "gestionar_padron","gestionar_vacantes"]'::jsonb) p),
         r.permissions)
 where r.permissions ? 'editar_evento'
   and not (r.permissions ?& array['gestionar_documentos','gestionar_acreditacion',
                                   'gestionar_padron','gestionar_vacantes']);

-- ── Comprobación ───────────────────────────────────────────────────────
--
--   -- Nadie con `editar_evento` se quedó sin los cuatro:
--   select count(*) from public.event_roles
--    where permissions ? 'editar_evento'
--      and not (permissions ?& array['gestionar_documentos','gestionar_acreditacion',
--                                    'gestionar_padron','gestionar_vacantes']);
--   -- 0
--
--   -- Y nadie que NO los tuviera recibió poder de más (aparte de la semilla
--   -- de los eventos nuevos):
--   select nombre, count(*) from public.event_roles
--    where permissions ? 'gestionar_documentos' and not (permissions ? 'editar_evento')
--    group by 1;
--   -- sólo «Staff · Logística» de eventos creados después de esta migración
--
-- ── Vuelta atrás ───────────────────────────────────────────────────────
--
--   update public.event_roles
--      set permissions = (select jsonb_agg(p) from jsonb_array_elements_text(permissions) p
--                          where p not in ('gestionar_documentos','gestionar_acreditacion',
--                                          'gestionar_padron','gestionar_vacantes'));
--
-- Y volver a aplicar la 0123 para la semilla. Nadie se queda sin poder hacer lo
-- que hacía: `editar_evento` sigue valiendo en las cuatro.
