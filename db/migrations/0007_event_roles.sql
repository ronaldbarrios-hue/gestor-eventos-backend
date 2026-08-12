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

/* ── Los ids de permiso van en español ────────────────────────────────
   Este archivo sembraba los permisos en inglés ("edit_event", "view",
   "internal_chat", "attendee_lookup"…). Ninguno de esos ids existe: el
   verificador de `lib/acceso.js` y el catálogo de `src/lib/permisos.js`
   trabajan en español, así que cada rol semilla concedía exactamente cero
   permisos y solo funcionaba ser dueño del evento.

   En producción alguien corrigió la función directamente sobre Supabase sin
   dejar migración, y este archivo se quedó mintiendo: reconstruir la base
   desde las migraciones daba un resultado distinto al de la base real.

   Corregido aquí, en el origen. Los valores son los mismos que dejan la 0054
   y la 0056 para estos seis roles, de modo que aplicarlas encima no cambia
   ninguna fila. La 0054 añade los cuatro que faltan (Expositor, Speaker,
   Finanzas, Moderación) y la 0056 mueve la semilla al esquema `private`. */
create or replace function public.seed_event_roles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.event_roles (evento_id, nombre, descripcion, permissions, is_system, orden) values
    (new.id, 'Editor',           'Edita información, agenda y página pública',     '["editar_evento","editar_pagina_publica","gestionar_imagenes","gestionar_agenda"]'::jsonb, true, 1),
    (new.id, 'Coordinador',      'Coordina al staff y al evento completo',         '["editar_evento","invitar_staff","gestionar_agenda","ver_clientes","ver_analytics","crear_canales"]'::jsonb, true, 2),
    (new.id, 'Staff · Acceso',   'Controla entrada y hace check-in con QR',        '["checkin","ver_clientes"]'::jsonb,                true, 3),
    (new.id, 'Staff · Logística','Montaje, técnica y escenario',                    '["crear_canales","gestionar_agenda"]'::jsonb,      true, 4),
    (new.id, 'Staff · Atención', 'Atiende asistentes durante el evento',           '["ver_clientes","checkin"]'::jsonb,                true, 5),
    (new.id, 'VIP host',         'Anfitrión de zona VIP',                          '["vip_zone","ver_clientes","checkin"]'::jsonb,     true, 6)
  on conflict (evento_id, nombre) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_event_roles on public.eventos;
create trigger trg_seed_event_roles
  after insert on public.eventos
  for each row execute function public.seed_event_roles();

/* Backfill: eventos existentes también reciben sus roles default.
   Mismos ids en español que la función de arriba; `on conflict` en vez de
   comprobar si el evento tiene alguno, para que añada los que falten sin
   pisar los que el organizador haya editado a mano. */
insert into public.event_roles (evento_id, nombre, descripcion, permissions, is_system, orden)
select e.id, r.nombre, r.descripcion, r.permissions, true, r.orden
  from public.eventos e
  cross join (values
    ('Editor',            'Edita información, agenda y página pública',
      '["editar_evento","editar_pagina_publica","gestionar_imagenes","gestionar_agenda"]'::jsonb, 1),
    ('Coordinador',       'Coordina al staff y al evento completo',
      '["editar_evento","invitar_staff","gestionar_agenda","ver_clientes","ver_analytics","crear_canales"]'::jsonb, 2),
    ('Staff · Acceso',    'Controla entrada y hace check-in con QR',
      '["checkin","ver_clientes"]'::jsonb, 3),
    ('Staff · Logística', 'Montaje, técnica y escenario',
      '["crear_canales","gestionar_agenda"]'::jsonb, 4),
    ('Staff · Atención',  'Atiende asistentes durante el evento',
      '["ver_clientes","checkin"]'::jsonb, 5),
    ('VIP host',          'Anfitrión de zona VIP',
      '["vip_zone","ver_clientes","checkin"]'::jsonb, 6)
  ) as r(nombre, descripcion, permissions, orden)
 where e.deleted_at is null
on conflict (evento_id, nombre) do nothing;
