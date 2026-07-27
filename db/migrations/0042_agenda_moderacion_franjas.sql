-- 0042 · Moderación de franjas del expositor. YA APLICADA en producción. Idempotente.
alter table public.agenda_sessions
  add column if not exists moderacion text not null default 'aprobado';
