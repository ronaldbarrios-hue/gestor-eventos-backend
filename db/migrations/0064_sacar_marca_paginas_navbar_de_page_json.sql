-- 0064 · La marca, las páginas y el navbar salen de `page_json`.
--
-- `eventos.page_json` es un JSON donde viven quince cosas distintas: la marca,
-- las páginas de la landing, el navbar, el SEO, el checkout, el mapa, las
-- zonas, los accesos, los documentos, la cartera… Cada pantalla lo escribe
-- entero, partiendo de la copia del evento que tenía en memoria:
--
--     page_json: { ...evento.page_json, branding }
--     page_json: { ...evento.page_json, pages, navbar }
--
-- Si dos pantallas están abiertas —o si una guarda y la otra no se entera—, la
-- segunda en pulsar escribe su copia vieja encima y borra lo de la primera sin
-- avisar. Así fue como la marca se borraba sola: se guardaba bien, y el
-- siguiente "Guardar cambios" del editor la escribía sin `branding`.
--
-- Se ataca por los dos lados:
--
--   1. AQUÍ: las tres cosas que se pisaban salen a columnas propias. Ya no
--      comparten campo, así que no pueden pisarse ni queriendo. Se eligieron
--      estas tres y no todas porque son las que tienen editores separados
--      escribiendo a la vez; el resto (seo, checkout, mapa…) tiene un solo
--      editor cada una.
--   2. En la API: el PATCH deja de REEMPLAZAR `page_json` y pasa a MEZCLAR
--      por claves de primer nivel. Con eso, una pantalla que manda sólo lo
--      suyo no puede borrar lo de otra aunque su copia esté vieja. Es lo que
--      cierra la puerta para las claves que siguen dentro.
--
-- Y una vez copiadas, las tres claves SE QUITAN de `page_json`. No es un
-- adorno: mientras existan dos copias del mismo dato, hay que decidir cuál
-- gana, y cualquier regla que elijamos falla en algún caso. La más tentadora
-- —"si la columna está vacía, usa la del JSON"— resucita la marca borrada:
-- alguien la quita a propósito, la columna queda vacía, y la copia legada la
-- devuelve a la vida.
--
-- Con una sola copia no hay nada que decidir. La compatibilidad hacia atrás la
-- da la API, que al LEER vuelve a meter las tres dentro de `page_json`: quien
-- siga leyendo `page_json.branding` no se entera del cambio.

alter table public.eventos
  add column if not exists branding jsonb not null default '{}'::jsonb,
  add column if not exists paginas  jsonb not null default '[]'::jsonb,
  add column if not exists navbar   jsonb not null default '{}'::jsonb;

/* Backfill. Sólo donde el JSON trae algo con la forma correcta: un
   `page_json` a medio construir no puede convertir `paginas` en un objeto
   cuando el resto del código espera un array. */
update public.eventos
   set branding = coalesce(page_json -> 'branding', '{}'::jsonb)
 where page_json ? 'branding'
   and jsonb_typeof(page_json -> 'branding') = 'object'
   and branding = '{}'::jsonb;

update public.eventos
   set navbar = coalesce(page_json -> 'navbar', '{}'::jsonb)
 where page_json ? 'navbar'
   and jsonb_typeof(page_json -> 'navbar') = 'object'
   and navbar = '{}'::jsonb;

update public.eventos
   set paginas = page_json -> 'pages'
 where page_json ? 'pages'
   and jsonb_typeof(page_json -> 'pages') = 'array'
   and paginas = '[]'::jsonb;

/* Formato antiguo: antes de que existieran varias páginas, la landing era un
   array de bloques suelto en `page_json.blocks`. El frontend ya lo traduce al
   leer; aquí se traduce de una vez para que la columna nazca correcta. */
update public.eventos
   set paginas = jsonb_build_array(
         jsonb_build_object('id', 'inicio', 'nombre', 'Inicio', 'blocks', page_json -> 'blocks')
       )
 where paginas = '[]'::jsonb
   and page_json ? 'blocks'
   and jsonb_typeof(page_json -> 'blocks') = 'array'
   and jsonb_array_length(page_json -> 'blocks') > 0;

/* Fuera del JSON. A partir de aquí hay UNA copia de cada cosa y ninguna regla
   que decidir. `blocks` se va también: ya está traducido a `paginas` arriba y
   dejarlo sería un tercer sitio donde mirar. */
update public.eventos
   set page_json = page_json - 'branding' - 'pages' - 'navbar' - 'blocks'
 where page_json ?| array['branding', 'pages', 'navbar', 'blocks'];

comment on column public.eventos.branding is
  'Marca del evento (White Label). Única fuente de verdad; la API la sirve también dentro de page_json por compatibilidad.';
comment on column public.eventos.paginas is
  'Páginas de la landing. Única fuente de verdad; la API la sirve también como page_json.pages.';
comment on column public.eventos.navbar is
  'Barra superior del sitio público. Única fuente de verdad; la API la sirve también dentro de page_json.';
comment on column public.eventos.page_json is
  'Resto de la configuración del sitio (seo, checkout, mapa, zonas, accesos, documentos…). '
  'La API lo MEZCLA por claves al guardar: mandar sólo lo tuyo no borra lo de otra pantalla.';
