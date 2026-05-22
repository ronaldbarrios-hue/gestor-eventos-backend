-- 0020: Lista de espera por tipo de boleta
-- Permite a usuarios unirse a una cola cuando el cupo está agotado.

create table if not exists public.event_waitlist (
  id                    uuid primary key default gen_random_uuid(),
  evento_id             uuid not null references public.eventos(id) on delete cascade,
  ticket_type_id        uuid not null references public.ticket_types(id) on delete cascade,

  user_id               uuid references public.profiles(id) on delete set null,
  guest_email           text not null,
  guest_nombre          text,

  posicion              integer not null,

  estado                text not null default 'active',
  -- active | contacted | purchased | cancelled

  added_at              timestamptz not null default now(),
  notified_at           timestamptz,
  purchased_at          timestamptz,

  notification_attempts integer not null default 0,
  last_contact_at       timestamptz,

  unique (evento_id, ticket_type_id, guest_email)
);

create index if not exists waitlist_evento_idx    on public.event_waitlist (evento_id);
create index if not exists waitlist_tipo_idx      on public.event_waitlist (ticket_type_id);
create index if not exists waitlist_estado_idx    on public.event_waitlist (estado);
create index if not exists waitlist_posicion_idx  on public.event_waitlist (evento_id, ticket_type_id, posicion);
