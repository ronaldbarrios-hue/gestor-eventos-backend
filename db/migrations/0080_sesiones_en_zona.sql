-- 0080 · Un sub-evento pertenece a una zona. Idempotente.
--
-- La zona es UN punto del plano ("Zona Gamer") y dentro pasan cosas a lo largo
-- del día: el torneo de FIFA a las 3, la final a las 7. Hasta ahora esas dos
-- cosas no se conocían: la zona vivía en `page_json.zonas` y el sub-evento
-- decía dónde ocurría con texto libre en `ubicacion` o `track`.
--
-- Con texto libre, "Zona Gamer", "zona gamer" y "Z. Gamer" son tres sitios, y
-- renombrar la zona rompe el vínculo en silencio. Es el mismo fallo que la
-- 0079 arregló en los movimientos de aforo, así que se arregla igual: manda el
-- id de la zona, y el nombre queda para leerlo.
--
-- El relleno de abajo empareja lo ya escrito. Lo que no case sigue funcionando:
-- quien consulte busca por id Y por nombre, así que un sub-evento viejo con la
-- ubicación bien escrita sigue apareciendo en su zona.

begin;

alter table public.agenda_sessions add column if not exists zona_id text;

create index if not exists agenda_sessions_zona_idx
  on public.agenda_sessions(evento_id, zona_id);

/* Empareja por nombre contra las zonas declaradas del evento, mirando primero
   la ubicación y después el track. Sin distinguir mayúsculas ni espacios de
   más, que es justo por donde se cuelan los duplicados. */
update public.agenda_sessions s
   set zona_id = z.id
  from public.eventos e,
       lateral jsonb_to_recordset(
         case when jsonb_typeof(e.page_json->'zonas') = 'array'
              then e.page_json->'zonas' else '[]'::jsonb end
       ) as z(id text, nombre text)
 where s.evento_id = e.id
   and s.zona_id is null
   and z.nombre is not null
   and lower(btrim(z.nombre)) in (lower(btrim(coalesce(s.ubicacion, ''))),
                                  lower(btrim(coalesce(s.track, ''))));

commit;
