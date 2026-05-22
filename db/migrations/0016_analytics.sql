/* GESTEK — Analytics ligero: tracking de visitas a páginas públicas.
   Una fila por visita. visitor_hash agrupa "mismo visitante en el mismo día"
   (hash de IP + UA + día), no es PII trackeada. */

create table if not exists public.event_views (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references public.eventos(id) on delete cascade,
  visitor_hash  text not null,
  referrer      text,
  source        text,
    -- direct | search | social | email | otro
  user_agent    text,
  pais          text,
  created_at    timestamptz not null default now()
);

create index if not exists event_views_evento_idx   on public.event_views (evento_id, created_at desc);
create index if not exists event_views_visitor_idx  on public.event_views (evento_id, visitor_hash, created_at);

/* RLS: owner del evento ve sus stats. Insert lo hace el backend con service_role. */
alter table public.event_views enable row level security;

drop policy if exists event_views_select_owner on public.event_views;
create policy event_views_select_owner on public.event_views
  for select using (
    exists (select 1 from public.eventos e where e.id = event_views.evento_id and e.owner_id = auth.uid())
  );
