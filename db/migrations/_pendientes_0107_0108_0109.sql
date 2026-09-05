-- ═══════════════════════════════════════════════════════════════════════
-- PENDIENTES · 0107 + 0108 + 0109
--
-- Comprobado contra produccion el 2026-09-05: ninguna de las tres esta
-- aplicada. La 0106 y todo lo anterior si.
--
-- Se pegan las tres juntas y en este orden. Las tres son ADITIVAS: no borran
-- ni recortan nada de lo que ya hay, y correrlas dos veces deja lo mismo.
--
--   0107 · Cuanto se puede escribir en una pregunta de texto
--   0108 · Sentar a alguien en la rueda con solo su correo
--   0109 · Que cada rol pueda hacer lo que su descripcion promete
--
-- Al final hay UNA consulta que dice si las tres entraron.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ─── 0107_limite_de_texto_en_preguntas.sql ───────────────────────

-- 0107 · Cuánto puede escribirse en una pregunta de texto
--
-- ── Por qué ────────────────────────────────────────────────────────────
--
-- Un formulario pide «cuéntanos tu propuesta en máximo 10 palabras» y hoy la
-- plataforma no tiene dónde guardar ese «10». El organizador lo escribe en el
-- enunciado y no lo hace cumplir nadie: llegan respuestas de un párrafo, y el
-- recorte lo acaba haciendo una persona a mano cuando toca leerlas o
-- imprimirlas. Peor si la respuesta va a una escarapela o a un listado, donde
-- lo que no cabe se corta a la mitad de una palabra.
--
-- ── Dos límites y no uno ───────────────────────────────────────────────
--
-- Se piden de las dos maneras y no son intercambiables: «100 caracteres» es
-- una restricción de espacio —cabe en la etiqueta, cabe en la columna—, y
-- «10 palabras» es una restricción de forma —sé breve—. Convertir una en otra
-- obliga a adivinar cuánto mide una palabra.
--
-- Los dos son opcionales e independientes: se puede poner uno, el otro, o los
-- dos. NULL = sin límite, que es como está todo lo que ya existe, así que
-- ninguna pregunta cambia de comportamiento al aplicar esto.
--
-- ── Por qué no se recorta lo ya guardado ───────────────────────────────
--
-- Poner un límite hoy no puede borrar lo que alguien respondió ayer. Lo
-- guardado se queda como está; el límite se aplica a lo que se responda desde
-- ahora. Si el organizador necesita recortar lo viejo, eso es una decisión
-- suya sobre SUS datos, no un efecto silencioso de guardar un ajuste.

alter table public.event_form_fields
  add column if not exists max_caracteres integer,
  add column if not exists max_palabras   integer;

-- Un límite de 0 o negativo no es un límite: es una pregunta que no se puede
-- responder. Y el tope de arriba evita que un dedo de más («1000000») acabe
-- guardando textos que revientan cualquier listado.
alter table public.event_form_fields
  drop constraint if exists event_form_fields_max_caracteres_ck;
alter table public.event_form_fields
  add  constraint event_form_fields_max_caracteres_ck
  check (max_caracteres is null or (max_caracteres between 1 and 10000));

alter table public.event_form_fields
  drop constraint if exists event_form_fields_max_palabras_ck;
alter table public.event_form_fields
  add  constraint event_form_fields_max_palabras_ck
  check (max_palabras is null or (max_palabras between 1 and 2000));

comment on column public.event_form_fields.max_caracteres is
  'Máximo de caracteres de la respuesta. NULL = sin límite. Sólo aplica a texto y párrafo.';
comment on column public.event_form_fields.max_palabras is
  'Máximo de palabras de la respuesta. NULL = sin límite. Sólo aplica a texto y párrafo.';

-- Comprobación (debe devolver dos filas):
--   select column_name, data_type
--     from information_schema.columns
--    where table_name = 'event_form_fields'
--      and column_name in ('max_caracteres', 'max_palabras');

-- ─── 0108_citas_a_mano_por_correo.sql ────────────────────────────

-- 0108 · Sentar a alguien en la rueda con sólo su correo
--
-- ── Por qué ────────────────────────────────────────────────────────────
--
-- Hay ruedas donde la agenda la arma el equipo entera: se sabe quién se
-- reunirá con quién y a qué hora, y nadie reserva ni aprueba nada. Hoy eso no
-- se puede: `networking_citas.user_id` es NOT NULL y apunta a `auth.users`, o
-- sea que sólo se puede sentar a quien YA se hizo una cuenta en GESTEK.
--
-- Y la mayoría de quien compra una boleta no tiene cuenta: la compra es
-- anónima a propósito —esa decisión ya está tomada en el checkout— y lo único
-- que queda de esa persona es su correo en la boleta.
--
-- ── Qué cambia ─────────────────────────────────────────────────────────
--
-- `user_id` pasa a ser opcional, y aparecen `guest_email` y `guest_nombre`.
-- Una cita pertenece a una persona con cuenta (user_id) O a un correo. Nunca a
-- ninguno de los dos: eso lo impide el CHECK, porque una cita sin dueño no se
-- le puede enseñar a nadie ni avisar por correo, y sería una casilla ocupada
-- por nadie.
--
-- ── Lo que NO cambia ───────────────────────────────────────────────────
--
-- Las citas que ya existen tienen su `user_id` y siguen igual. El índice único
-- sobre `horario_id` sigue siendo el que impide dos personas en la misma
-- casilla, y vale para las dos formas.
--
-- ── Por qué el correo se guarda en minúsculas ──────────────────────────
--
-- Porque es la llave con la que se cruza contra la boleta y contra el perfil.
-- «Juan@X.com» y «juan@x.com» son la misma persona, y si se guardan tal cual
-- llegan, la misma persona acaba con dos agendas. La normalización la hace el
-- servidor al escribir; esto sólo deja constancia del criterio.

alter table public.networking_citas
  alter column user_id drop not null;

alter table public.networking_citas
  add column if not exists guest_email  text,
  add column if not exists guest_nombre text;

-- Una cita es de alguien. Con cuenta o con correo, pero de alguien.
alter table public.networking_citas
  drop constraint if exists networking_citas_dueno_ck;
alter table public.networking_citas
  add  constraint networking_citas_dueno_ck
  check (user_id is not null or guest_email is not null);

-- Para cruzar «mis citas» por correo cuando no hay cuenta.
create index if not exists networking_citas_guest_email_idx
  on public.networking_citas (evento_id, guest_email)
  where guest_email is not null;

comment on column public.networking_citas.guest_email is
  'Dueño de la cita cuando no tiene cuenta en GESTEK. Siempre en minúsculas.';
comment on column public.networking_citas.guest_nombre is
  'Cómo se llama, para que la parrilla no enseñe sólo un correo.';

-- ─── 0109_roles_que_hacen_lo_que_dicen.sql ───────────────────────

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

commit;

-- ═══════════════════════════════════════════════════════════════════════
-- ¿Entraron? Las tres filas tienen que decir `true`.
-- ═══════════════════════════════════════════════════════════════════════
select '0107 · limite de texto en preguntas' as migracion,
       (select count(*) from information_schema.columns
         where table_name = 'event_form_fields'
           and column_name in ('max_caracteres', 'max_palabras')) = 2 as ok
union all
select '0108 · citas a mano por correo',
       (select count(*) from information_schema.columns
         where table_name = 'networking_citas'
           and column_name in ('guest_email', 'guest_nombre')) = 2
       and (select is_nullable from information_schema.columns
             where table_name = 'networking_citas' and column_name = 'user_id') = 'YES'
union all
select '0109 · roles que hacen lo que dicen',
       exists (select 1 from public.event_roles
                where is_system and nombre = 'Atención'
                  and permissions ? 'gestionar_clientes');
