/* GESTEK — Equipo y roles por evento.

   Cada evento puede tener varios miembros (staff). Cada miembro tiene un rol
   con permisos. Los roles vienen como string (preset) pero el modelo permite
   custom_permissions para granularidad.

   Flujo de invitación:
   - Owner invita por email
   - Si el email ya tiene cuenta GESTEK → user_id se llena, status='active'
   - Si no → user_id null, status='invited', se completa al aceptar la invitación
*/

create table if not exists public.event_members (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,

  /* Datos del miembro — user_id null = invitado aún sin registrar */
  user_id     uuid references public.profiles(id) on delete set null,
  email       text not null,
  nombre_invitado text,

  /* Rol del miembro DENTRO de este evento */
  rol         text not null default 'staff',  -- owner | editor | coordinador | staff_acceso | staff_logistica | staff_atencion | vip_host | staff
  custom_permissions text[] default '{}',     -- permisos extra para granularidad

  /* Estado de la invitación */
  status      text not null default 'invited', -- invited | active | rejected | removed
  invited_at  timestamptz not null default now(),
  accepted_at timestamptz,

  /* Quién lo invitó */
  invited_by  uuid references public.profiles(id),

  unique (evento_id, email)
);

create index if not exists event_members_evento_idx on public.event_members (evento_id);
create index if not exists event_members_user_idx   on public.event_members (user_id) where user_id is not null;
create index if not exists event_members_email_idx  on public.event_members (lower(email));

/* RLS — el owner del evento gestiona; los miembros leen su propio rol */
alter table public.event_members enable row level security;

drop policy if exists event_members_select_owner_or_self on public.event_members;
create policy event_members_select_owner_or_self on public.event_members
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.eventos e where e.id = event_members.evento_id and e.owner_id = auth.uid())
  );

drop policy if exists event_members_write_owner on public.event_members;
create policy event_members_write_owner on public.event_members
  for all using (
    exists (select 1 from public.eventos e where e.id = event_members.evento_id and e.owner_id = auth.uid())
  );

/* Permite al usuario invitado actualizar su propia fila (para aceptar/rechazar) */
drop policy if exists event_members_update_self on public.event_members;
create policy event_members_update_self on public.event_members
  for update using (user_id = auth.uid());

/* Cuando un usuario nuevo se registra, completar event_members donde estaba invitado por email */
create or replace function public.link_event_invitations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.event_members
    set user_id = new.id, status = 'active', accepted_at = now()
    where lower(email) = lower(new.email)
      and user_id is null
      and status = 'invited';
  return new;
end;
$$;

drop trigger if exists on_new_user_link_invites on auth.users;
create trigger on_new_user_link_invites
  after insert on auth.users
  for each row execute function public.link_event_invitations();
