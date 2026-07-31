-- 0050 · Google Calendar OAuth tokens. YA APLICADA. Idempotente.
alter table public.profiles
  add column if not exists google_refresh_token text,
  add column if not exists google_email text,
  add column if not exists google_connected_at timestamptz;
