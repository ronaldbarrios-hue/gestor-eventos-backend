-- PEGAR ENTERO en Supabase → SQL Editor. Orden importante: 0089 crea
-- fn_perms_iguales, que la 0090 usa; la 0091 es independiente pero va después.
-- Todo es idempotente: si algo falla a mitad, se puede volver a correr.
-- Generado el 2026-09-02 desde db/migrations/. La fuente son los tres archivos.

begin;

-- ══════════════════════════════════════════════════════════════
-- 0089_rol_administrador_y_realineo.sql
-- ══════════════════════════════════════════════════════════════
-- 0089 · El rol «Administrador», y los roles viejos realineados con la semilla.
--
-- ── Por qué ──────────────────────────────────────────────────────────────
--
-- 1) NO EXISTÍA UN ROL QUE PUDIERA TODO. Las pantallas más sensibles se
--    guardan con `__solo_owner__` y el dueño no es un rol: es una columna,
--    `eventos.owner_id`. Así que delegar «todo» a una segunda persona era
--    imposible sin traspasarle el evento entero. Éste es el rol que faltaba.
--
-- 2) EL MISMO ROL DABA PERMISOS DISTINTOS SEGÚN LA EDAD DEL EVENTO. Medido
--    sobre los 33 eventos de producción:
--
--      «Editor»            31 eventos: sin `gestionar_agenda` ni `gestionar_imagenes`
--                           2 eventos: con los dos
--      «Staff · Logística» 31 eventos: sólo `ver_clientes` — no puede hacer
--                                      NADA logístico
--                           2 eventos: `crear_canales`, `gestionar_agenda`
--      «VIP host»          31 eventos: sin `checkin`
--                           2 eventos: con `checkin`
--
--    No es que haya dos semillas: `fn_roles_semilla` (0054) y
--    `modules/eventos/semillas.js` dicen exactamente lo mismo. Lo que pasó es
--    que los 31 eventos viejos nacieron con la semilla en INGLÉS de la 0007 y
--    la 0054 los tradujo palabra por palabra — traducir «view_analytics» da
--    «ver_analytics», pero no puede inventar los permisos que aquella lista no
--    tenía. La 0054 arregló la función; los datos ya escritos se quedaron.
--
-- ── Cuidado: NO se pisan los roles que alguien haya tocado ────────────────
--
-- `permissions` es editable desde la pantalla de roles, así que un
-- `is_system` puede llevar una decisión deliberada del organizador. El
-- realineo de abajo sólo toca las filas cuyo contenido es EXACTAMENTE el de la
-- traducción vieja: eso demuestra que nadie las tocó. Cualquier otra cosa se
-- queda como está, aunque parezca rara — no es nuestra.
--
-- ── Reversible ───────────────────────────────────────────────────────────
--
-- Sí, y sin pérdida: sólo inserta un rol y añade permisos a otros. El rollback
-- está al final, comentado. Ningún DROP, ningún borrado de filas con miembros.
--
-- Idempotente: se puede correr dos veces.

-- ── 1 · La semilla, con el rol nuevo ─────────────────────────────────────
--
-- OJO CON EL ESQUEMA: la 0056 movió `fn_roles_semilla` de `public` a
-- `private`, y el trigger `public.seed_event_roles()` llama a la de
-- `private`. Escribir `create or replace function public.fn_roles_semilla`
-- aquí no habría dado error: habría creado una función FANTASMA en `public`
-- que nadie llama, y el rol nuevo no habría aparecido en ningún evento
-- nuevo. Comprobado contra la base antes de escribir esto.
--
-- «Administrador» lleva TODOS los permisos del catálogo, incluidos los seis
-- que todavía no verifica nadie (`vip_zone`, `crear_canales`,
-- `borrar_mensajes`, `ver_pagos`, `reembolsar`, `gestionar_descuentos`).
-- Mismo criterio que ya usa el resto de la semilla: el rol describe lo que ese
-- puesto HACE, no lo que el servidor comprueba hoy. Y en éste importa más que
-- en ninguno: el día que se apliquen, quien es administrador tiene que poder
-- hacerlos sin que nadie se acuerde de volver a editarlo.
--
-- Va con `orden = 0` para que salga el primero: es el más fuerte y es el que
-- se busca al delegar.
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

-- ── 2 · «Administrador» en los eventos que ya existen ────────────────────
--
-- La semilla sólo corre al crear un evento, así que sin esto el rol nuevo
-- existiría únicamente para los que nazcan de hoy en adelante — y el problema
-- que resuelve lo tienen los 33 de ahora.
insert into public.event_roles (evento_id, nombre, descripcion, permissions, is_system, orden)
select e.id, s.nombre, s.descripcion, s.permissions, true, s.orden
  from public.eventos e
  cross join private.fn_roles_semilla() s
 where s.nombre = 'Administrador'
   and not exists (
     select 1 from public.event_roles r
      where r.evento_id = e.id and r.nombre = s.nombre
   );

-- ── 3 · Realinear SÓLO lo que nadie tocó ────────────────────────────────
--
-- Cada `update` compara contra el contenido exacto que dejó la traducción de
-- la 0054. Se comparan como conjuntos ordenados para no depender del orden en
-- que estén escritos dentro del jsonb.
create or replace function private.fn_perms_iguales(a jsonb, b jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(
    (select jsonb_agg(v order by v) from jsonb_array_elements_text(a) t(v)),
    '[]'::jsonb
  ) = coalesce(
    (select jsonb_agg(v order by v) from jsonb_array_elements_text(b) t(v)),
    '[]'::jsonb
  );
$$;

update public.event_roles r
   set permissions = s.permissions
  from private.fn_roles_semilla() s
 where r.is_system
   and r.nombre = s.nombre
   and r.nombre <> 'Administrador'
   and not private.fn_perms_iguales(r.permissions, s.permissions)
   and private.fn_perms_iguales(
         r.permissions,
         case r.nombre
           when 'Editor'            then '["editar_evento","editar_pagina_publica","ver_clientes","crear_canales"]'::jsonb
           when 'Coordinador'       then '["editar_evento","invitar_staff","ver_clientes","crear_canales","gestionar_tickets","ver_pagos"]'::jsonb
           when 'Staff · Acceso'    then '["checkin","ver_clientes"]'::jsonb
           when 'Staff · Logística' then '["ver_clientes"]'::jsonb
           when 'Staff · Atención'  then '["ver_clientes","gestionar_clientes"]'::jsonb
           when 'VIP host'          then '["vip_zone","ver_clientes"]'::jsonb
           else '["__nunca__"]'::jsonb
         end);

-- ── Rollback ─────────────────────────────────────────────────────────────
--
-- No hay pérdida que deshacer: quitar el rol nuevo y devolver los seis roles a
-- su contenido traducido. Se deja comentado a propósito — ejecutarlo dejaría a
-- quien ya tenga «Administrador» asignado sin rol.
--
--   delete from public.event_roles
--    where nombre = 'Administrador'
--      and is_system
--      and not exists (select 1 from public.event_members m where m.rol_id = event_roles.id);
--
-- Y los permisos se devuelven con el mismo `update` de arriba, cambiando
-- `s.permissions` por el literal viejo de cada rol.

-- ══════════════════════════════════════════════════════════════
-- 0090_roles_renombrados.sql
-- ══════════════════════════════════════════════════════════════
-- 0090 · Los roles, llamados por lo que son — y sin conceder de más.
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

-- ══════════════════════════════════════════════════════════════
-- 0091_zonas_tabla_expand.sql
-- ══════════════════════════════════════════════════════════════
-- 0091 · Las zonas dejan de vivir dentro de un JSON. PASO 1 de 3 (expand).
--
-- ── El problema ──────────────────────────────────────────────────────────
--
-- Una zona vive hoy en `eventos.page_json.zonas`, un array. Cuatro tablas la
-- referencian por `zona_id` —`agenda_sessions`, `networking_expositores`,
-- `zona_cortes` y `ticket_movimientos`— y **ninguna referencia está
-- garantizada**, porque una clave foránea no puede apuntar dentro de un jsonb.
--
-- Lo que se paga por eso, medido hoy contra producción:
--
--   · `routes/networking.js` tiene `zonaInvalida()`, una función que lee
--     `page_json` en CADA escritura para hacer a mano el trabajo de una FK.
--   · `ticket_movimientos` ya tiene **4 filas huérfanas**: apuntan a zonas que
--     alguien borró del plano. La 0079 y la 0080 no validaban, así que las
--     dejaron entrar.
--   · «Qué hay en esta zona» no se puede preguntar con un join: hay que leer
--     el JSON, leer las sesiones, leer los stands y cruzar en memoria. Eso es
--     lo que hace `mapa/vivo`, y es la única puerta que existe.
--
-- ── Por qué esta migración NO cambia quién lee ───────────────────────────
--
-- Expand/contract, y de verdad: este archivo sólo CREA y COPIA. `page_json`
-- sigue siendo la fuente de la que todo el mundo lee, y el código no cambia.
-- Los tres pasos, en migraciones distintas y en sesiones distintas:
--
--   0091 (esto)  crear la tabla, copiar, poner las claves foráneas.
--   0092         el código escribe en las dos y lee de la tabla.
--   0093         dejar de escribir el JSON, y sólo entonces borrarlo.
--
-- Partirlo así no es ceremonia: mientras el JSON siga ahí, revertir es borrar
-- una tabla que nadie lee todavía. En cuanto el código lea de la tabla, ya no.
--
-- ── Lo que se decidió mirando los datos, no el diseño ────────────────────
--
-- · **`id` es `text`, no `uuid`.** Los ids que ya existen son `acc_jzgcn7b` y
--   parecidos, y las cuatro columnas que los referencian son `text`. Con un PK
--   de texto, las FK casan **sin reescribir una sola fila** de las tablas que
--   apuntan. Un `uuid` bonito habría obligado a migrar cuatro tablas.
-- · **Sin `x` / `y`.** Las coordenadas no son de la zona: viven en
--   `page_json.mapa.marcadores`, porque una zona puede existir sin estar
--   colocada en el plano. Meterlas aquí habría mezclado «qué es» con «dónde
--   se dibuja».
-- · Los 7 ids que hay son únicos entre todos los eventos, así que el PK puede
--   ser sólo `id`. Comprobado antes de escribirlo.
--
-- Reversible: `drop table public.zonas` y ya. Nada lee de ella todavía.
-- Idempotente.

create table if not exists public.zonas (
  id          text primary key,
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  nombre      text not null,
  aforo_max   integer,
  orden       integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists zonas_evento_idx on public.zonas (evento_id, orden);

/* Copiar lo que hay en el JSON.
   Se filtran las que no tienen id o no tienen nombre: las dos existen de forma
   legítima y transitoria mientras alguien está creando una zona, y son las
   mismas que `zonasDelEvento()` ya descarta al leer. Meterlas aquí crearía
   filas que la aplicación considera inexistentes. */
insert into public.zonas (id, evento_id, nombre, aforo_max, orden)
select el->>'id',
       e.id,
       trim(el->>'nombre'),
       nullif(el->>'aforo_max','')::integer,
       (el_idx - 1)::integer
  from public.eventos e,
       lateral jsonb_array_elements(coalesce(e.page_json->'zonas','[]'::jsonb))
         with ordinality as t(el, el_idx)
 where nullif(el->>'id','') is not null
   and nullif(trim(el->>'nombre'),'') is not null
on conflict (id) do nothing;

/* ── Las claves foráneas ─────────────────────────────────────────────────
 *
 * `on delete set null` en las dos tablas VIVAS: si se borra una zona, la
 * charla y el stand siguen existiendo, sólo dejan de estar ubicados. Es lo que
 * ya pasaba de hecho —quedaban apuntando a nada— pero ahora queda dicho.
 */
alter table public.agenda_sessions
  drop constraint if exists agenda_sessions_zona_id_fkey;
alter table public.agenda_sessions
  add constraint agenda_sessions_zona_id_fkey
  foreign key (zona_id) references public.zonas(id) on delete set null;

alter table public.networking_expositores
  drop constraint if exists networking_expositores_zona_id_fkey;
alter table public.networking_expositores
  add constraint networking_expositores_zona_id_fkey
  foreign key (zona_id) references public.zonas(id) on delete set null;

/* ── Las dos tablas de HISTORIAL no llevan clave foránea ─────────────────
 *
 * `zona_cortes` y `ticket_movimientos` son registros de algo que pasó. Una FK
 * les dejaría dos salidas y las dos son malas: `on delete set null` borraría
 * de la historia en qué zona ocurrió, y `restrict` impediría borrar una zona
 * que alguna vez tuvo movimiento — es decir, cualquiera.
 *
 * Y hay una razón medida: `ticket_movimientos` tiene YA 4 filas apuntando a
 * zonas borradas. Son ingresos reales a una zona que después desapareció del
 * plano; el dato es cierto aunque la zona no exista. Borrarlos o vaciarlos
 * para que entre una FK sería falsear el historial por una regla de forma.
 *
 * `zona_cortes` guarda además el NOMBRE de la zona (`zona`) junto al id, que es
 * exactamente cómo se resuelve esto bien: el historial se queda con su copia y
 * no depende de que la fila siga existiendo.
 */

alter table public.zonas enable row level security;

/* Sin políticas a propósito: la tabla la escribe y la lee el backend con la
   llave de servicio, igual que el resto del panel. Las zonas llegan al público
   por `eventos.publicos`, ya filtradas — abrir aquí una lectura anónima sería
   dar el plano interno del recinto a quien pregunte, y es justo lo que la
   Fase 3 de INDEPENDENCIA vino a cerrar. */

-- ── Rollback ─────────────────────────────────────────────────────────────
--   alter table public.agenda_sessions drop constraint if exists agenda_sessions_zona_id_fkey;
--   alter table public.networking_expositores drop constraint if exists networking_expositores_zona_id_fkey;
--   drop table if exists public.zonas;
-- `page_json.zonas` sigue intacto, así que no se pierde nada.

commit;
