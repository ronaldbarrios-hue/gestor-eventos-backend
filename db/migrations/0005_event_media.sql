/* GESTEK — Storage para portada y galería de eventos.

   Bucket: 'event-media' — público de lectura.
   Estructura: event-media/{owner_id}/{event_slug_o_id}/{cover|gallery}-{timestamp}.{ext}

   El owner del evento (auth.uid()) es el único que puede subir/editar/borrar
   archivos en su carpeta. Cualquiera puede leer (porque las páginas públicas
   de eventos necesitan mostrarlas sin auth).

   Además: agregamos columna `gallery jsonb` a eventos para almacenar el
   arreglo de URLs ordenadas.
*/

/* 1. Bucket */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-media',
  'event-media',
  true,
  5 * 1024 * 1024, -- 5 MB max por imagen
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

/* 2. Policies */
drop policy if exists "event_media_public_read"   on storage.objects;
drop policy if exists "event_media_owner_insert"  on storage.objects;
drop policy if exists "event_media_owner_update"  on storage.objects;
drop policy if exists "event_media_owner_delete"  on storage.objects;

create policy "event_media_public_read" on storage.objects
  for select using (bucket_id = 'event-media');

create policy "event_media_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'event-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "event_media_owner_update" on storage.objects
  for update using (
    bucket_id = 'event-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "event_media_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'event-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

/* 3. Columna gallery en eventos */
alter table public.eventos
  add column if not exists gallery jsonb not null default '[]'::jsonb;

/* Ejemplo de gallery:
   ["https://.../event-media/<owner>/<event>/gallery-1.jpg",
    "https://.../event-media/<owner>/<event>/gallery-2.jpg"]
*/
