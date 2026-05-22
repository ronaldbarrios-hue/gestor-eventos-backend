/* GESTEK — Tareas asignables por persona o por rol + trazabilidad. */

create table if not exists public.tareas (
  id              uuid primary key default gen_random_uuid(),
  evento_id       uuid not null references public.eventos(id) on delete cascade,
  titulo          text not null,
  descripcion     text,
  estado          text not null default 'pendiente',
    -- pendiente | en_curso | hecho | cancelada
  prioridad       text not null default 'normal',
    -- baja | normal | alta | urgente

  /* Asignación: a un usuario específico O a un rol (los miembros con ese rol la ven).
     Pueden ser ambos null si la tarea aún no fue asignada. */
  asignado_user_id uuid references public.profiles(id) on delete set null,
  asignado_rol_id  uuid references public.event_roles(id) on delete set null,

  vence_at        timestamptz,
  completed_at    timestamptz,
  orden           integer not null default 0,

  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists tareas_evento_idx       on public.tareas (evento_id);
create index if not exists tareas_estado_idx       on public.tareas (estado);
create index if not exists tareas_asignado_user_idx on public.tareas (asignado_user_id) where asignado_user_id is not null;
create index if not exists tareas_asignado_rol_idx  on public.tareas (asignado_rol_id)  where asignado_rol_id  is not null;

/* Log / trazabilidad de cada tarea */
create table if not exists public.tarea_log (
  id          uuid primary key default gen_random_uuid(),
  tarea_id    uuid not null references public.tareas(id) on delete cascade,
  user_id     uuid references public.profiles(id),
  tipo        text not null,
    -- created | estado | asignacion | comentario | completed | vence | borrada
  contenido   jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists tarea_log_tarea_idx on public.tarea_log (tarea_id, created_at desc);

/* updated_at trigger en tareas */
drop trigger if exists trg_tareas_updated on public.tareas;
create trigger trg_tareas_updated before update on public.tareas
  for each row execute function public.set_updated_at();

/* RLS */
alter table public.tareas    enable row level security;
alter table public.tarea_log enable row level security;

/* Tareas: owner del evento gestiona; miembros activos ven las tareas
   asignadas a su rol o a ellos mismos. */
drop policy if exists tareas_select on public.tareas;
create policy tareas_select on public.tareas
  for select using (
    exists (select 1 from public.eventos e where e.id = tareas.evento_id and e.owner_id = auth.uid())
    or asignado_user_id = auth.uid()
    or exists (
      select 1 from public.event_members m
      where m.evento_id = tareas.evento_id and m.user_id = auth.uid() and m.status = 'active'
        and (tareas.asignado_rol_id is null or m.rol_id = tareas.asignado_rol_id)
    )
  );

drop policy if exists tareas_write_owner on public.tareas;
create policy tareas_write_owner on public.tareas
  for all using (
    exists (select 1 from public.eventos e where e.id = tareas.evento_id and e.owner_id = auth.uid())
  );

/* log: lectura igual que tareas */
drop policy if exists tarea_log_select on public.tarea_log;
create policy tarea_log_select on public.tarea_log
  for select using (
    exists (
      select 1 from public.tareas t
      join public.eventos e on e.id = t.evento_id
      where t.id = tarea_log.tarea_id and (
        e.owner_id = auth.uid()
        or t.asignado_user_id = auth.uid()
        or exists (
          select 1 from public.event_members m
          where m.evento_id = e.id and m.user_id = auth.uid() and m.status = 'active'
            and (t.asignado_rol_id is null or m.rol_id = t.asignado_rol_id)
        )
      )
    )
  );

/* ─────────── Storage: permitir audio en event-media ─────────── */
update storage.buckets
  set allowed_mime_types = array[
    'image/jpeg','image/png','image/webp','image/gif',
    'audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav'
  ]
  where id = 'event-media';
