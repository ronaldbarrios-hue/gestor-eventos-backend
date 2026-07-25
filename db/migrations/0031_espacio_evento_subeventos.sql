-- "Espacio del evento": las sesiones de agenda se generalizan a sub-eventos
-- con un TIPO (charla, stand, competencia, ring…) y un enlace opcional a un
-- torneo, para saltar a sus llaves desde el calendario y la web pública.
-- YA APLICADA en producción (Supabase) — este archivo es el registro en repo.
alter table public.agenda_sessions
  add column if not exists tipo text not null default 'charla',
  add column if not exists torneo_id uuid references public.torneos(id) on delete set null;

create index if not exists idx_agenda_sessions_tipo      on public.agenda_sessions(evento_id, tipo);
create index if not exists idx_agenda_sessions_torneo_id on public.agenda_sessions(torneo_id);

comment on column public.agenda_sessions.tipo is 'Tipo de sub-evento: charla|taller|panel|competencia|show|stand|activacion|proyeccion|meetgreet|ceremonia|otro';
comment on column public.agenda_sessions.torneo_id is 'Si el sub-evento es competitivo, apunta al torneo cuyas llaves muestra.';
