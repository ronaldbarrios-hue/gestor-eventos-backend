/* GESTEK — Notificaciones in-app.
   Una fila por notificación a un usuario. El backend las crea (service_role)
   desde puntos clave (reserva, alta a equipo, tarea asignada, etc).
   El frontend las lee + escucha vía Supabase Realtime. */

create table if not exists public.notificaciones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  tipo        text not null default 'info',
    -- info | reserva | equipo | tarea | pago | sistema
  titulo      text not null,
  cuerpo      text,
  link        text,                       -- ruta interna a la que navega al click
  evento_id   uuid references public.eventos(id) on delete cascade,
  leida       boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists notif_user_idx
  on public.notificaciones (user_id, created_at desc);
create index if not exists notif_user_unread_idx
  on public.notificaciones (user_id) where leida = false;

alter table public.notificaciones enable row level security;

/* Cada usuario ve y marca como leídas SOLO las suyas.
   El insert lo hace el backend con service_role (bypassa RLS). */
drop policy if exists notif_select_own on public.notificaciones;
create policy notif_select_own on public.notificaciones
  for select using (user_id = auth.uid());

drop policy if exists notif_update_own on public.notificaciones;
create policy notif_update_own on public.notificaciones
  for update using (user_id = auth.uid());

drop policy if exists notif_delete_own on public.notificaciones;
create policy notif_delete_own on public.notificaciones
  for delete using (user_id = auth.uid());

/* Realtime sobre notificaciones (idempotente) */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificaciones'
  ) then
    execute 'alter publication supabase_realtime add table public.notificaciones';
  end if;
end$$;
