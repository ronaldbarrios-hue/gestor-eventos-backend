-- 0106 · Atender las solicitudes del equipo se puede delegar.
--
-- ── Por qué ──────────────────────────────────────────────────────────────
--
-- Responder una sugerencia del equipo, cerrar una incidencia y —sobre todo—
-- aprobar que a alguien le corrijan su ficha estaba pegado a «ser el dueño del
-- evento». En un evento de siete mil personas eso deja al organizador como el
-- único que puede aprobar que a un colaborador le cambien una letra del nombre
-- en la escarapela.
--
-- Ahora hay un permiso, `gestionar_solicitudes`, y el dueño lo delega en quien
-- lleva el equipo. Pertenecer al equipo sigue sin bastar: aquí se edita la
-- ficha de OTRA persona, y eso se concede, no se hereda por estar dentro.
--
-- ── Qué hace, y en qué orden ─────────────────────────────────────────────
--
-- 1. Redefine la semilla de roles para que los eventos NUEVOS nazcan con el
--    permiso dentro de «Administrador».
-- 2. Se lo añade a los «Administrador» que YA existen. Sin este paso, el rol
--    seguiría llamándose «puede todo dentro del evento» y no podría hacer esto
--    — que es la forma exacta en que una lista literal envejece.
--
-- Expand y nada más: no quita permisos ni toca a nadie más. Correrla dos veces
-- no cambia nada la segunda (el `?` comprueba antes de añadir).
--
-- ── Qué NO hace ──────────────────────────────────────────────────────────
--
-- No se lo da a ningún otro rol de la semilla. «Coordinador» coordina al staff
-- y podría parecer el sitio, pero conceder de más en una migración es
-- justamente lo que nadie revisa después: si hace falta, se marca la casilla
-- desde la pantalla de roles, que para eso está.

-- ── 1 · La semilla, para los eventos que se creen a partir de ahora ──────
create or replace function private.fn_roles_semilla()
returns table (nombre text, descripcion text, permissions jsonb, orden integer)
language sql
immutable
as $$
  values
    ('Administrador',     'Puede todo dentro del evento, salvo transferirlo o borrarlo',
      '["editar_evento","publicar_evento","editar_pagina_publica","gestionar_imagenes",
        "gestionar_agenda","gestionar_torneo","gestionar_expositores",
        "invitar_staff","gestionar_roles","remover_miembros","gestionar_solicitudes",
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

-- ── 2 · Los «Administrador» que ya existen ──────────────────────────────
--
-- Sólo los de sistema y sólo si no lo tienen ya. Un rol que alguien renombró o
-- editó a mano no se toca: dejó de ser la semilla el día que lo tocaron.
update public.event_roles
   set permissions = permissions || '["gestionar_solicitudes"]'::jsonb
 where is_system
   and nombre = 'Administrador'
   and not (permissions ? 'gestionar_solicitudes');

-- ── Comprobar después de correrla ───────────────────────────────────────
--
--   select count(*) filter (where permissions ? 'gestionar_solicitudes') as con,
--          count(*) as total
--     from public.event_roles
--    where is_system and nombre = 'Administrador';
--
-- `con` y `total` tienen que ser el mismo número. Si no, hay Administradores
-- editados a mano y hay que mirarlos uno a uno antes de decidir.
--
-- ── Volver atrás ────────────────────────────────────────────────────────
--
--   update public.event_roles
--      set permissions = permissions - 'gestionar_solicitudes'
--    where is_system and nombre = 'Administrador';
--
-- Y volver a poner la semilla de la 0090. No hay pérdida de datos: es un
-- permiso, no una columna.
