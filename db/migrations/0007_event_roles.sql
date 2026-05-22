/* GESTEK — Roles definidos por evento.

   El organizador define los roles ANTES de invitar. Cada evento arranca con
   un set de roles preset (editables/borrables) y puede crear nuevos.
   event_members.rol_id apunta al rol seleccionado.
*/

create table if not exists public.event_roles (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  nombre      text not null,
  descripcion text,
  permissions jsonb not null default '[]'::jsonb,
  is_system   boolean not null default false,
  orden       integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (evento_id, nombre)
);

create index if not exists event_roles_evento_idx on public.event_roles (evento_id);

/* event_members ya existe — agregamos rol_id como FK */
alter table public.event_members
  add column if not exists rol_id uuid references public.event_roles(id) on delete set null;

/* RLS */
alter table public.event_roles enable row level security;

drop policy if exists event_roles_select on public.event_roles;
create policy event_roles_select on public.event_roles
  for select using (
    exists (select 1 from public.eventos e where e.id = event_roles.evento_id and e.owner_id = auth.uid())
    or exists (
      select 1 from public.event_members m
      where m.evento_id = event_roles.evento_id and m.user_id = auth.uid() and m.status = 'active'
    )
  );

drop policy if exists event_roles_write_owner on public.event_roles;
create policy event_roles_write_owner on public.event_roles
  for all using (
    exists (select 1 from public.eventos e where e.id = event_roles.evento_id and e.owner_id = auth.uid())
  );

/* Trigger: seed defaults cuando se crea un evento nuevo */
create or replace function public.seed_event_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.event_roles (evento_id, nombre, descripcion, permissions, is_system, orden) values
    (new.id, 'Editor',           'Edita información, agenda y página pública',     '["edit_event","view"]'::jsonb,             true, 1),
    (new.id, 'Coordinador',      'Coordina al staff y al evento completo',         '["edit_event","invite_staff","view"]'::jsonb, true, 2),
    (new.id, 'Staff · Acceso',   'Controla entrada y hace check-in con QR',        '["checkin","view"]'::jsonb,                true, 3),
    (new.id, 'Staff · Logística','Montaje, técnica y escenario',                    '["view","internal_chat"]'::jsonb,          true, 4),
    (new.id, 'Staff · Atención', 'Atiende asistentes durante el evento',           '["view","attendee_lookup"]'::jsonb,        true, 5),
    (new.id, 'VIP host',         'Anfitrión de zona VIP',                          '["view","vip_zone"]'::jsonb,               true, 6);
  return new;
end;
$$;

drop trigger if exists trg_seed_event_roles on public.eventos;
create trigger trg_seed_event_roles
  after insert on public.eventos
  for each row execute function public.seed_event_roles();

/* Backfill: eventos existentes también reciben sus roles default */
do $$
declare e record;
begin
  for e in select id from public.eventos where deleted_at is null loop
    if not exists (select 1 from public.event_roles where evento_id = e.id) then
      insert into public.event_roles (evento_id, nombre, descripcion, permissions, is_system, orden) values
        (e.id, 'Editor',           'Edita información, agenda y página pública',     '["edit_event","view"]'::jsonb,             true, 1),
        (e.id, 'Coordinador',      'Coordina al staff y al evento completo',         '["edit_event","invite_staff","view"]'::jsonb, true, 2),
        (e.id, 'Staff · Acceso',   'Controla entrada y hace check-in con QR',        '["checkin","view"]'::jsonb,                true, 3),
        (e.id, 'Staff · Logística','Montaje, técnica y escenario',                    '["view","internal_chat"]'::jsonb,          true, 4),
        (e.id, 'Staff · Atención', 'Atiende asistentes durante el evento',           '["view","attendee_lookup"]'::jsonb,        true, 5),
        (e.id, 'VIP host',         'Anfitrión de zona VIP',                          '["view","vip_zone"]'::jsonb,               true, 6);
    end if;
  end loop;
end$$;
