-- Cronograma: cada expositor aporta su franja al "Espacio del evento". Una
-- franja del expositor = una fila de agenda_sessions con expositor_id. Así el
-- cronograma sigue teniendo UNA sola fuente de verdad (agenda_sessions).
-- YA APLICADA en producción (Supabase).
alter table public.agenda_sessions
  add column if not exists expositor_id uuid references public.networking_expositores(id) on delete cascade;

create index if not exists idx_agenda_expositor on public.agenda_sessions(expositor_id);

comment on column public.agenda_sessions.expositor_id is 'NULL = franja del organizador; si no, franja aportada por ese expositor.';
