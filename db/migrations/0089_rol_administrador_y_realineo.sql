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
