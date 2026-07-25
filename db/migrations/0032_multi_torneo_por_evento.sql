-- Multi-torneo: un evento puede tener varios torneos (Smash, Tekken, boxeo…),
-- cada uno con su disciplina/categoría y orden de aparición.
-- YA APLICADA en producción (Supabase).
alter table public.torneos
  add column if not exists disciplina text,
  add column if not exists orden integer not null default 0;

create index if not exists idx_torneos_evento_orden on public.torneos(evento_id, orden);

comment on column public.torneos.disciplina is 'Etiqueta libre de la disciplina/categoría del torneo: "Smash Bros", "Boxeo", "Fútbol"…';
