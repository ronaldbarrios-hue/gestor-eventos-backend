/* GESTEK — page_json v2 con múltiples páginas y bloques sistema.

   Estructura nueva:
   {
     "pages": [
       {
         "id"    : "p_inicio",
         "nombre": "Inicio",
         "blocks": [
           { "id": "sys_portada",    "type": "portada",    "data": {} },
           { "id": "sys_titulo",     "type": "titulo",     "data": {} },
           { "id": "sys_descripcion","type": "descripcion","data": {} },
           { "id": "sys_info",       "type": "info",       "data": {} },
           { "id": "sys_direccion",  "type": "direccion",  "data": {} },
           { "id": "sys_links",      "type": "links",      "data": {} },
           { "id": "sys_tickets",    "type": "tickets",    "data": {} }
         ]
       }
     ]
   }

   Bloques sistema: leen su contenido del evento (cover_url, gallery, titulo,
   descripcion, fechas, links, tipos_ticket). El usuario puede ocultarlos
   (data.oculto = true), reordenarlos y duplicarlos.

   Bloques custom: texto, galeria, video, faq (su contenido vive en data).
*/

create or replace function public.default_page_blocks()
returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'sys_portada',    'type', 'portada',     'data', '{}'::jsonb),
    jsonb_build_object('id', 'sys_titulo',     'type', 'titulo',      'data', '{}'::jsonb),
    jsonb_build_object('id', 'sys_descripcion','type', 'descripcion', 'data', '{}'::jsonb),
    jsonb_build_object('id', 'sys_info',       'type', 'info',        'data', '{}'::jsonb),
    jsonb_build_object('id', 'sys_direccion',  'type', 'direccion',   'data', '{}'::jsonb),
    jsonb_build_object('id', 'sys_links',      'type', 'links',       'data', '{}'::jsonb),
    jsonb_build_object('id', 'sys_tickets',    'type', 'tickets',     'data', '{}'::jsonb)
  );
$$;

create or replace function public.seed_page_json_v2()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.page_json is null or new.page_json = '{}'::jsonb or new.page_json->'pages' is null then
    new.page_json := jsonb_build_object(
      'pages', jsonb_build_array(
        jsonb_build_object(
          'id',     'p_inicio',
          'nombre', 'Inicio',
          'blocks', public.default_page_blocks()
        )
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_seed_page_json on public.eventos;
create trigger trg_seed_page_json
  before insert on public.eventos
  for each row execute function public.seed_page_json_v2();

/* Backfill: convierte eventos existentes a la estructura v2.
   Si tenían blocks viejos en page_json.blocks, los preserva al final. */
update public.eventos
set page_json = jsonb_build_object(
  'pages', jsonb_build_array(
    jsonb_build_object(
      'id',     'p_inicio',
      'nombre', 'Inicio',
      'blocks', public.default_page_blocks() || coalesce(page_json->'blocks', '[]'::jsonb)
    )
  )
)
where deleted_at is null
  and (page_json is null or page_json->'pages' is null);
