/* GESTEK — Falta la política de UPDATE en "form-uploads": el upload sigue
   fallando con "new row violates row-level security policy" pese a que
   0077 ya agregó la política de INSERT.

   La causa: FormPhotoUploader.jsx sube con { upsert: true }. Eso hace que
   Postgres arme internamente un "INSERT ... ON CONFLICT (bucket_id, name)
   DO UPDATE" en vez de un INSERT simple. Postgres documenta que, para un
   INSERT con ON CONFLICT DO UPDATE, la fila debe pasar TANTO la política de
   INSERT COMO la de UPDATE — sin importar si en la práctica hay conflicto o
   es un archivo totalmente nuevo. 0077 solo cubrió el INSERT; sin política
   de UPDATE, Postgres deniega por RLS *cualquier* upload con upsert:true a
   este bucket, aunque el archivo sea nuevo.

   (Así se depuró: un INSERT simple de prueba en SQL —sin ON CONFLICT—
   pasaba sin problema, mientras la subida real de la app, con
   x-upsert:true en la petición, seguía fallando exactamente igual.) */

do $$
begin
  drop policy if exists "form_uploads_update_publico" on storage.objects;

  /* Mismo criterio que la de INSERT: sin auth.uid(), porque un invitado sin
     sesión también debe poder subir/reemplazar su foto. */
  create policy "form_uploads_update_publico" on storage.objects
    for update
    using (bucket_id = 'form-uploads')
    with check (bucket_id = 'form-uploads');
end$$;
