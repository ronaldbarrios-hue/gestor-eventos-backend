-- 0048 · Hardening de seguridad. YA APLICADA en producción. Idempotente-ish.
-- 1) Fija search_path de la función trigger (evita inyección por search_path).
alter function public.fn_expositor_desde_boleta() set search_path = public, pg_temp;
-- 2) Quita el listado público de buckets (las URLs públicas NO dependen de esta
--    política; solo se impide ENUMERAR todos los archivos). Buckets siguen public=true.
drop policy if exists "avatars_public_read" on storage.objects;
drop policy if exists "event_media_public_read" on storage.objects;
drop policy if exists "form_uploads_select_publico" on storage.objects;
