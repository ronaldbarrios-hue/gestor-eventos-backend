-- 0109 · Que cada rol pueda hacer lo que su descripción promete
--
-- ── El problema ────────────────────────────────────────────────────────
--
-- Los roles semilla se repartieron por nombre, no por trabajo. Tres de ellos
-- prometen en su descripción algo que sus permisos no alcanzan, y el síntoma
-- no es un error: es una pantalla que no está, o un botón que contesta 403.
--
--   · «Atención — atiende asistentes durante el evento» tenía `ver_clientes` y
--     `checkin`. O sea que podía MIRAR. Lo primero que hace un puesto de
--     atención es reenviar una boleta que no llegó, o corregir un correo mal
--     escrito, y las dos cosas piden `gestionar_clientes`. Un puesto de
--     atención que sólo mira no atiende a nadie.
--
--   · «Coordinación de expositores — gestiona los stands y las fichas» tenía
--     un permiso: `gestionar_expositores`. Desde la 0108 se puede sentar gente
--     en la rueda con su correo, y para eso hay que poder ver quién está
--     inscrito: `ver_clientes`.
--
--   · «Staff · Logística — montaje, técnica y escenario» tenía
--     `gestionar_agenda`, que es armar el programa — no es su trabajo, y es de
--     los permisos que más cosas mueven. Se cambia por `checkin`, que es lo
--     que de verdad necesita: ver zonas y aforo el día del evento.
--
-- ── Por qué esto no pisa el trabajo de nadie ───────────────────────────
--
-- Sólo se tocan los roles `is_system` cuyos permisos siguen siendo EXACTAMENTE
-- los que puso la semilla. Si alguien ya ajustó su «Atención» —le quitó algo o
-- le añadió—, esa fila no se toca: su decisión gana sobre la nuestra.
--
-- Y sólo se AÑADE, salvo el `gestionar_agenda` de Logística, que se quita a
-- propósito y se dice arriba por qué.
--
-- Idempotente: correrla dos veces deja lo mismo.

-- ── 1 · La semilla, para los eventos que nazcan ─────────────────────────
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
      '["editar_evento","invitar_staff","gestionar_agenda","ver_clientes","ver_analytics",
        "crear_canales","gestionar_solicitudes"]'::jsonb, 2),
    ('Puerta',            'Controla el ingreso y escanea las entradas',
      '["checkin","ver_clientes"]'::jsonb, 3),
    -- Sin `gestionar_agenda`: montar el escenario no es armar el programa.
    -- Con `checkin`: lo que necesita es ver zonas y aforo el día del evento.
    ('Staff · Logística', 'Montaje, técnica y escenario',
      '["crear_canales","checkin"]'::jsonb, 4),
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

-- ── 2 · Los eventos que ya existen ──────────────────────────────────────
-- Sólo los que siguen tal cual salieron de la semilla anterior. La comparación
-- es por CONJUNTO y no por texto: el orden dentro del jsonb no significa nada
-- y compararlo como cadena dejaría fuera filas idénticas.
create or replace function private.fn_mismo_conjunto(a jsonb, b jsonb)
returns boolean language sql immutable as $$
  select coalesce(
    (select array_agg(x order by x) from jsonb_array_elements_text(a) x)
    = (select array_agg(y order by y) from jsonb_array_elements_text(b) y),
    a = b)
$$;

update public.event_roles r
   set permissions = '["ver_clientes","gestionar_clientes","checkin","gestionar_solicitudes"]'::jsonb
 where r.is_system
   and r.nombre = 'Atención'
   and private.fn_mismo_conjunto(r.permissions, '["ver_clientes","checkin"]'::jsonb);

update public.event_roles r
   set permissions = '["gestionar_expositores","ver_clientes"]'::jsonb
 where r.is_system
   and r.nombre = 'Coordinación de expositores'
   and private.fn_mismo_conjunto(r.permissions, '["gestionar_expositores"]'::jsonb);

update public.event_roles r
   set permissions = '["crear_canales","checkin"]'::jsonb
 where r.is_system
   and r.nombre = 'Staff · Logística'
   and private.fn_mismo_conjunto(r.permissions, '["crear_canales","gestionar_agenda"]'::jsonb);

update public.event_roles r
   set permissions = '["editar_evento","invitar_staff","gestionar_agenda","ver_clientes","ver_analytics","crear_canales","gestionar_solicitudes"]'::jsonb
 where r.is_system
   and r.nombre = 'Coordinador'
   and private.fn_mismo_conjunto(r.permissions,
       '["editar_evento","invitar_staff","gestionar_agenda","ver_clientes","ver_analytics","crear_canales"]'::jsonb);

-- Comprobación:
--   select nombre, permissions from public.event_roles
--    where is_system and nombre in ('Atención','Coordinación de expositores','Staff · Logística','Coordinador')
--    order by nombre;
--
-- Vuelta atrás (deja los permisos como estaban; sólo para los sin tocar):
--   update public.event_roles set permissions = '["ver_clientes","checkin"]'::jsonb
--    where is_system and nombre = 'Atención';
--   update public.event_roles set permissions = '["gestionar_expositores"]'::jsonb
--    where is_system and nombre = 'Coordinación de expositores';
--   update public.event_roles set permissions = '["crear_canales","gestionar_agenda"]'::jsonb
--    where is_system and nombre = 'Staff · Logística';
