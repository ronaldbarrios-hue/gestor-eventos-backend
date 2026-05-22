-- GESTEK — Sugerencias / solicitudes / mensajes del equipo hacia el organizador.
-- El equipo (miembros activos) crea entradas; el organizador las gestiona.

create table if not exists public.event_requests (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  autor_id    uuid references public.profiles(id) on delete set null,
  tipo        text not null default 'sugerencia',   -- sugerencia | solicitud | mensaje | reporte
  titulo      text,
  contenido   text not null,
  estado      text not null default 'abierta',       -- abierta | en_revision | resuelta | descartada
  respuesta   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists event_requests_evento_idx on public.event_requests (evento_id, created_at desc);
create index if not exists event_requests_autor_idx  on public.event_requests (autor_id);
create index if not exists event_requests_estado_idx on public.event_requests (evento_id) where estado <> 'resuelta';
