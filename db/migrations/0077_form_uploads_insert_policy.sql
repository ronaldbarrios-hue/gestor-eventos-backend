/* GESTEK — Arregla el bucket "form-uploads": nadie podía subir nada.

   0026 (hardening de storage) endureció avatars y event-media a propósito:
   solo el dueño de la carpeta (auth.uid()) puede escribir ahí. Bien — pero
   form-uploads se creó DESPUÉS, para el campo tipo "foto" del formulario de
   compra, que a propósito debe aceptar subidas de INVITADOS SIN SESIÓN
   (alguien comprando boleta como invitado también puede subir su foto — ver
   el comentario de FormPhotoUploader.jsx). Nunca se le puso ninguna política
   de inserción. Como Supabase bloquea todo por defecto salvo que una
   política lo permita, el resultado es "new row violates row-level security
   policy" para CUALQUIERA que intente subir ahí — invitado u organizador —
   desde que existe el bucket. La función no fallaba con un error claro de
   "falta configurar esto"; fallaba con el error genérico de Postgres, que no
   dice qué hacer.

   Este bucket no puede exigir auth.uid() como avatars/event-media —el punto
   es que un invitado SIN cuenta también debe poder escribir—, así que la
   política de inserción va abierta por bucket, y la defensa real está en los
   límites de tamaño/MIME del bucket mismo (no solo en la validación del
   cliente, que cualquiera puede saltarse). */

-- Bucket público, con los mismos límites que ya valida el frontend
-- (FormPhotoUploader.jsx: 4 MB, jpg/png/webp) — reforzados aquí a nivel de
-- Storage, no solo en el navegador.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('form-uploads', 'form-uploads', true, 4 * 1024 * 1024,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 4 * 1024 * 1024,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

do $$
begin
  drop policy if exists "form_uploads_insert_publico" on storage.objects;

  /* Sin auth.uid() a propósito: un invitado sin sesión debe poder insertar.
     El tamaño/MIME ya quedan acotados por el bucket de arriba. */
  create policy "form_uploads_insert_publico" on storage.objects
    for insert with check (bucket_id = 'form-uploads');
end$$;
