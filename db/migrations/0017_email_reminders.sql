/* GESTEK — Recordatorios email automáticos (T-7d / T-1d / T-1h).

   Flujo:
   1. Cada evento decide si quiere recordatorios (eventos.email_reminders default true).
   2. Una Edge Function `send-reminders` corre cada hora vía pg_cron.
   3. La función usa find_pending_reminders() para sacar la lista de envíos pendientes.
   4. Por cada uno, manda email vía Resend y registra en email_log (idempotente).
*/

alter table public.eventos
  add column if not exists email_reminders boolean not null default true;

create table if not exists public.email_log (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets(id) on delete cascade,
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  tipo        text not null,
    -- t7d | t1d | t1h | confirmacion | post_evento
  destinatario text not null,
  status      text not null default 'sent',
    -- sent | failed
  error       text,
  created_at  timestamptz not null default now()
);

create unique index if not exists email_log_unique on public.email_log (ticket_id, tipo);
create index if not exists email_log_evento_idx   on public.email_log (evento_id, created_at desc);

alter table public.email_log enable row level security;

drop policy if exists email_log_select_owner on public.email_log;
create policy email_log_select_owner on public.email_log
  for select using (
    exists (select 1 from public.eventos e where e.id = email_log.evento_id and e.owner_id = auth.uid())
  );

/* Encuentra los próximos N envíos pendientes.
   Devuelve filas con todo lo que la Edge Function necesita para mandar el email.
   Ventanas:
     - t7d : 7 días - 30min  →  7 días + 30min
     - t1d : 24h - 30min     →  24h + 30min
     - t1h : 1h - 15min      →  1h + 15min
   Solo tickets en estado 'pagado' y eventos con email_reminders=true.
*/
create or replace function public.find_pending_reminders(p_limit int default 200)
returns table (
  ticket_id     uuid,
  evento_id     uuid,
  tipo          text,
  guest_email   text,
  guest_nombre  text,
  codigo        text,
  qr_token      text,
  evento_titulo text,
  evento_inicio timestamptz,
  evento_location text,
  evento_slug   text,
  owner_nombre  text,
  owner_empresa text
)
language sql security definer set search_path = public as $$
  with candidatos as (
    select
      t.id as ticket_id, t.evento_id, t.guest_email, t.guest_nombre, t.codigo, t.qr_token,
      e.titulo as evento_titulo, e.fecha_inicio as evento_inicio,
      coalesce(e.location_nombre, e.location_direccion) as evento_location,
      e.slug as evento_slug,
      p.nombre as owner_nombre, p.empresa as owner_empresa,
      case
        when e.fecha_inicio between now() + interval '6 days 23 hours 30 minutes' and now() + interval '7 days 30 minutes' then 't7d'
        when e.fecha_inicio between now() + interval '23 hours 30 minutes'         and now() + interval '24 hours 30 minutes' then 't1d'
        when e.fecha_inicio between now() + interval '45 minutes'                  and now() + interval '1 hour 15 minutes'   then 't1h'
        else null
      end as tipo
    from public.tickets t
    join public.eventos e  on e.id = t.evento_id
    join public.profiles p on p.id = e.owner_id
    where t.estado = 'pagado'
      and e.email_reminders = true
      and e.deleted_at is null
      and e.estado = 'publicado'
      and t.guest_email is not null
  )
  select
    c.ticket_id, c.evento_id, c.tipo,
    c.guest_email, c.guest_nombre, c.codigo, c.qr_token,
    c.evento_titulo, c.evento_inicio, c.evento_location, c.evento_slug,
    c.owner_nombre, c.owner_empresa
  from candidatos c
  where c.tipo is not null
    and not exists (
      select 1 from public.email_log l
      where l.ticket_id = c.ticket_id and l.tipo = c.tipo
    )
  order by c.evento_inicio asc
  limit p_limit;
$$;
