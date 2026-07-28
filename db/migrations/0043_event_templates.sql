-- 0043 · Plantillas de evento. YA APLICADA en producción. Idempotente.
create table if not exists public.event_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  nombre text not null, descripcion text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists event_templates_owner_idx on public.event_templates(owner_id);
alter table public.event_templates enable row level security;
