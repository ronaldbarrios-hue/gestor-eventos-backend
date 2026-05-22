/* GESTEK — Hardening de storage (auditoría de seguridad sección 3).

   Las policies de 0004 (avatars) y 0005 (event-media) ya escopan escritura por
   carpeta = auth.uid() y lectura pública. Esta migración:
   - Endurece límites de tamaño y MIME types (defensa ante uploads abusivos).
   - Re-afirma las policies de forma idempotente (estado seguro garantizado
     aunque alguien las haya tocado a mano).
   - Garantiza que NO exista escritura anónima/pública. */

/* ── Límites más conservadores ── */
update storage.buckets
  set file_size_limit = 3 * 1024 * 1024,                       -- 3 MB avatares
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/avif']
  where id = 'avatars';

update storage.buckets
  set file_size_limit = 15 * 1024 * 1024,                      -- 15 MB media de evento (incluye audio)
      allowed_mime_types = array[
        'image/jpeg','image/png','image/webp','image/gif','image/avif',
        'audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav'
      ]
  where id = 'event-media';

/* ── Re-afirmar policies (idempotente) ── */
do $$
begin
  /* avatars: lectura pública, escritura solo dueño de la carpeta */
  drop policy if exists "avatars_public_read"  on storage.objects;
  drop policy if exists "avatars_owner_insert" on storage.objects;
  drop policy if exists "avatars_owner_update" on storage.objects;
  drop policy if exists "avatars_owner_delete" on storage.objects;

  create policy "avatars_public_read" on storage.objects
    for select using (bucket_id = 'avatars');
  create policy "avatars_owner_insert" on storage.objects
    for insert with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
  create policy "avatars_owner_update" on storage.objects
    for update using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
  create policy "avatars_owner_delete" on storage.objects
    for delete using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

  /* event-media: igual */
  drop policy if exists "event_media_public_read"  on storage.objects;
  drop policy if exists "event_media_owner_insert" on storage.objects;
  drop policy if exists "event_media_owner_update" on storage.objects;
  drop policy if exists "event_media_owner_delete" on storage.objects;

  create policy "event_media_public_read" on storage.objects
    for select using (bucket_id = 'event-media');
  create policy "event_media_owner_insert" on storage.objects
    for insert with check (bucket_id = 'event-media' and auth.uid()::text = (storage.foldername(name))[1]);
  create policy "event_media_owner_update" on storage.objects
    for update using (bucket_id = 'event-media' and auth.uid()::text = (storage.foldername(name))[1]);
  create policy "event_media_owner_delete" on storage.objects
    for delete using (bucket_id = 'event-media' and auth.uid()::text = (storage.foldername(name))[1]);
end$$;

/* RLS en storage.objects ya viene forzada por Supabase. Las policies de insert
   exigen auth.uid(), por lo que un cliente anónimo (anon key sin sesión) NO
   puede subir archivos a ningún bucket. Lectura pública es intencional
   (avatares y covers se muestran en páginas públicas). */
