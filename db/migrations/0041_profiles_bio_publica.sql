-- 0041 · Descripción pública del perfil (talento y organizador) para Mi Espacio.
-- YA APLICADA en producción vía Supabase MCP. Idempotente.
alter table public.profiles add column if not exists bio text;
