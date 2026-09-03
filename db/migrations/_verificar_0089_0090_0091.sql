-- Comprobación de que la 0089, la 0090 y la 0091 quedaron aplicadas.
-- Correr DESPUÉS, en el SQL Editor. Sólo lee: no cambia nada.
--
-- Los números de la columna «esperado» se midieron ANTES de aplicar, el
-- 2026-09-02: 273 roles, 0 «Administrador», 33 eventos, 29 miembros, 7 zonas
-- dentro de `page_json`, y ninguna tabla `zonas`.

select 'roles en total'                as comprueba,
       count(*)::text                  as ahora,
       '306  (273 + 1 Administrador por cada uno de los 33 eventos)' as esperado
  from public.event_roles
union all
select 'eventos con Administrador', count(*)::text, '33  (todos)'
  from public.event_roles where nombre = 'Administrador'
union all
select 'miembros con su rol intacto', count(*)::text, '29  — si baja, algo borró roles en vez de renombrarlos'
  from public.event_members m join public.event_roles r on r.id = m.rol_id
union all
select 'roles llamados «Speaker»', count(*)::text, '0  — pasaron a «Programación»'
  from public.event_roles where nombre = 'Speaker'
union all
select 'roles llamados «Expositor»', count(*)::text, '0  — pasaron a «Coordinación de expositores»'
  from public.event_roles where nombre = 'Expositor'
union all
select 'roles llamados «Staff · Acceso»', count(*)::text, '0  — pasaron a «Puerta»'
  from public.event_roles where nombre = 'Staff · Acceso'
union all
select 'Editor que ya puede la agenda', count(*)::text, '33  — antes eran 2'
  from public.event_roles
 where nombre = 'Editor' and permissions::jsonb ? 'gestionar_agenda'
union all
select 'Moderación sin la agenda', count(*)::text, 'todas — moderar el chat no es programar'
  from public.event_roles
 where nombre = 'Moderación' and not (permissions::jsonb ? 'gestionar_agenda')
union all
select 'zonas en la tabla nueva', count(*)::text, '7  — las mismas que hay en page_json'
  from public.zonas
union all
select 'zonas que aún viven en page_json', count(*)::text,
       '7  — TIENE que seguir igual: la 0091 copia, no mueve'
  from public.eventos e,
       jsonb_array_elements(coalesce(e.page_json->'zonas','[]'::jsonb)) el
 where nullif(el->>'id','') is not null
   and nullif(trim(el->>'nombre'),'') is not null
union all
select 'claves foráneas de zona puestas', count(*)::text, '2  (agenda_sessions y networking_expositores)'
  from pg_constraint
 where conname in ('agenda_sessions_zona_id_fkey', 'networking_expositores_zona_id_fkey')
union all
select 'sesiones CON zona', count(*)::text,
       '2  — las mismas que antes. Si baja, una FK vació referencias que sí valían'
  from public.agenda_sessions
 where zona_id is not null;
