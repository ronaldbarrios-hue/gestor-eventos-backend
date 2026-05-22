/* GESTEK — Auditoría de acciones del equipo (feature plan Pro).
   Una fila por acción relevante hecha sobre un evento: quién, qué, sobre qué
   entidad, con qué detalle. El backend escribe con service_role (best-effort);
   el owner lee desde el panel. */

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_email text,                       -- snapshot por si borran el perfil
  accion      text not null,
    -- evento.crear | evento.editar | evento.estado | evento.borrar
    -- equipo.invitar | equipo.rol | equipo.quitar
    -- rol.crear | rol.editar | rol.borrar
    -- ticket.crear | ticket.editar | ticket.borrar
  entidad     text,                       -- evento | miembro | rol | ticket | ...
  entidad_id  uuid,
  detalle     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_evento_idx
  on public.audit_log (evento_id, created_at desc);
create index if not exists audit_log_actor_idx
  on public.audit_log (actor_id) where actor_id is not null;

alter table public.audit_log enable row level security;

/* Solo el owner del evento ve su auditoría. Insert lo hace el backend
   (service_role bypassa RLS). */
drop policy if exists audit_log_owner on public.audit_log;
create policy audit_log_owner on public.audit_log
  for select using (
    exists (select 1 from public.eventos e where e.id = audit_log.evento_id and e.owner_id = auth.uid())
  );
