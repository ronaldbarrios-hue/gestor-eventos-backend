-- 0115 · Adjuntar archivos en un formulario, y que los sensibles no anden sueltos
--
-- ── Qué falta hoy ──────────────────────────────────────────────────────
--
-- El formulario sabe pedir una FOTO y nada más. Para una Batalla de Pitch hace
-- falta un PDF; para inscribir una empresa, su RUT; para una beca, un
-- certificado. Todo eso hoy se pide por fuera —por correo, por WhatsApp— y se
-- pierde: nadie sabe quién lo mandó ni si llegó.
--
-- ── Por qué no basta con ampliar la lista de formatos ──────────────────
--
-- El bucket `form-uploads` es PÚBLICO: nadie puede listar lo que hay dentro
-- —la 0048 quitó esa política a propósito— pero cualquiera con el enlace lo
-- abre. Y ese enlace viaja dentro de `tickets.respuestas`, así que sale en el
-- CSV de asistentes, en los informes y en cualquier pantalla que enseñe las
-- respuestas.
--
-- Para un pitch deck eso está bien. Para una cédula escaneada, no: un enlace
-- que no caduca, pegado en una hoja de cálculo que circula por correo, es una
-- filtración esperando a que alguien reenvíe el archivo.
--
-- Así que hay dos sitios y lo elige quien hace la pregunta:
--
--   `sensible = false` → `form-uploads`, enlace público no adivinable. Es lo
--                        que ya pasa con las fotos.
--   `sensible = true`  → `form-uploads-privado`, sin lectura pública. El
--                        archivo sólo se abre por un enlace firmado que caduca,
--                        que emite el servidor a quien tiene por qué verlo.
--
-- Y lo que se guarda en `respuestas` cambia con ello: en el privado NO se
-- guarda una URL sino una referencia a la ruta. Una URL en esa columna acabaría
-- en el CSV por construcción; una referencia no se puede abrir sin pasar por el
-- servidor, que es justo lo que se quiere.

alter table public.event_form_fields
  add column if not exists sensible boolean not null default false;

comment on column public.event_form_fields.sensible is
  'Si lo que pide este campo son datos sensibles. Un archivo sensible va al bucket privado y sólo se abre con enlace firmado. Sólo aplica a los campos de tipo archivo.';

-- ── El bucket privado ──────────────────────────────────────────────────
--
-- `public = false`: no hay URL pública que valga, ni siquiera conociendo la
-- ruta. 15 MB porque un escaneo de varias páginas los ocupa, y por debajo de
-- eso la gente lo manda por WhatsApp y volvemos al principio.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'form-uploads-privado', 'form-uploads-privado', false, 15728640,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Subir SÍ, leer NO. Quien compra como invitado no tiene sesión, así que la
-- política de INSERT es para todos —igual que en `form-uploads`— y es lo que
-- permite que alguien sin cuenta adjunte su documento.
--
-- Y no hay política de SELECT. Es la pieza central: sin ella, la llave anónima
-- no puede leer NADA de este bucket, ni listando ni adivinando la ruta. Leer
-- pasa siempre por el servidor, que firma un enlace temporal para quien tiene
-- por qué verlo.
--
-- Tampoco de UPDATE: el nombre del archivo lleva la hora, así que no hay
-- conflicto que resolver, y sin UPDATE nadie puede sobrescribir el documento
-- de otro aun conociendo su ruta.

drop policy if exists form_uploads_privado_insert on storage.objects;
create policy form_uploads_privado_insert on storage.objects
  for insert to public
  with check (bucket_id = 'form-uploads-privado');

-- ── Y el bucket público acepta documentos ──────────────────────────────
--
-- Lo que no es sensible sigue donde estaba. Se le amplían los formatos y el
-- tope: 4 MB era para una foto, y un pitch deck de veinte láminas no cabe.

update storage.buckets
   set file_size_limit = 15728640,
       allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp',
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation'
       ]
 where id = 'form-uploads';

-- Comprobación:
--   select id, public, file_size_limit from storage.buckets
--    where id in ('form-uploads', 'form-uploads-privado');
--   select policyname, cmd from pg_policies
--    where schemaname='storage' and tablename='objects'
--      and policyname like 'form_uploads_privado%';
--   -- Tiene que salir UNA sola política, y de INSERT. Si aparece una de
--   -- SELECT, el bucket privado dejó de serlo.
--   select column_name from information_schema.columns
--    where table_name='event_form_fields' and column_name='sensible';
--
-- Vuelta atrás:
--   drop policy if exists form_uploads_privado_insert on storage.objects;
--   delete from storage.buckets where id = 'form-uploads-privado';
--   alter table public.event_form_fields drop column if exists sensible;
--   -- (el tope y los formatos de `form-uploads` se dejan: ampliarlos no rompe
--   --  nada de lo que ya estaba subido)
