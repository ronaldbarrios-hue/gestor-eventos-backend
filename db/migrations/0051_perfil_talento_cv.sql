-- 0051 · Hoja de vida en el perfil de talento
--
-- Hasta ahora el candidato solo podía describirse en texto y dejar un enlace
-- a su portafolio. Quien contrata suele querer el CV. Se guardan dos campos:
-- la URL del archivo y el nombre original, para poder mostrarlo y ofrecer la
-- descarga con un nombre que la persona reconozca.
--
-- Aditiva y sin valor por defecto: las filas existentes quedan en null y nada
-- de lo que ya funciona cambia de comportamiento.

alter table public.perfil_talento
  add column if not exists cv_url    text,
  add column if not exists cv_nombre text;

comment on column public.perfil_talento.cv_url is
  'URL del archivo de hoja de vida en Storage. Solo PDF o DOCX: el cliente '
  'valida MIME y extensión, y bloquea ejecutables y formatos con macros.';
comment on column public.perfil_talento.cv_nombre is
  'Nombre original del archivo, saneado, para mostrarlo y descargarlo.';
