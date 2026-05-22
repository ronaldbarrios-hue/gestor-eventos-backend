/* GESTEK — Recordatorios in-app (T-7d / T-1d / T-1h).
   A diferencia de los recordatorios por email (Edge Function + Resend), estos
   son notificaciones internas: solo insertan filas en `notificaciones`, así que
   pg_cron puede llamar una función SQL pura sin Edge Function ni provider.

   Destinatarios:
   - Owner del evento + miembros activos del equipo.
   - Asistentes con cuenta (tickets.user_id no null) y ticket pagado/usado.

   Idempotencia: tabla recordatorio_inapp_log con unique (scope_id, evento_id, tipo).
*/

create table if not exists public.recordatorio_inapp_log (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  scope_id    uuid not null,            -- user_id destinatario
  tipo        text not null,            -- t7d | t1d | t1h
  created_at  timestamptz not null default now(),
  unique (scope_id, evento_id, tipo)
);

create index if not exists rec_inapp_log_evento_idx
  on public.recordatorio_inapp_log (evento_id);

/* Genera recordatorios in-app pendientes. Devuelve cuántas notificaciones creó.
   Llamable por pg_cron: select public.generar_recordatorios_inapp(); */
create or replace function public.generar_recordatorios_inapp()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creadas integer := 0;
  v_rec record;
  v_tipo text;
  v_label text;
begin
  for v_rec in
    with eventos_proximos as (
      select
        e.id as evento_id, e.titulo, e.owner_id, e.slug, e.fecha_inicio,
        case
          when e.fecha_inicio between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour' then 't7d'
          when e.fecha_inicio between now() + interval '23 hours'         and now() + interval '25 hours'         then 't1d'
          when e.fecha_inicio between now() + interval '45 minutes'       and now() + interval '1 hour 15 minutes' then 't1h'
          else null
        end as tipo
      from public.eventos e
      where e.estado = 'publicado'
        and e.deleted_at is null
        and e.email_reminders = true
    ),
    destinatarios as (
      /* Owner */
      select ep.evento_id, ep.titulo, ep.slug, ep.tipo, ep.owner_id as user_id
      from eventos_proximos ep where ep.tipo is not null
      union
      /* Equipo activo */
      select ep.evento_id, ep.titulo, ep.slug, ep.tipo, m.user_id
      from eventos_proximos ep
      join public.event_members m on m.evento_id = ep.evento_id and m.status = 'active' and m.user_id is not null
      where ep.tipo is not null
      union
      /* Asistentes con cuenta y ticket válido */
      select ep.evento_id, ep.titulo, ep.slug, ep.tipo, t.user_id
      from eventos_proximos ep
      join public.tickets t on t.evento_id = ep.evento_id and t.user_id is not null
        and t.estado in ('pagado', 'usado')
      where ep.tipo is not null
    )
    select distinct d.evento_id, d.titulo, d.slug, d.tipo, d.user_id
    from destinatarios d
    where not exists (
      select 1 from public.recordatorio_inapp_log l
      where l.scope_id = d.user_id and l.evento_id = d.evento_id and l.tipo = d.tipo
    )
  loop
    v_tipo := v_rec.tipo;
    v_label := case v_tipo
      when 't7d' then 'en 7 días'
      when 't1d' then 'mañana'
      when 't1h' then 'en 1 hora'
      else 'pronto'
    end;

    insert into public.notificaciones (user_id, tipo, titulo, cuerpo, link, evento_id)
    values (
      v_rec.user_id,
      'sistema',
      'Recordatorio: ' || v_rec.titulo,
      'El evento empieza ' || v_label || '.',
      '/explorar/' || v_rec.slug,
      v_rec.evento_id
    );

    insert into public.recordatorio_inapp_log (evento_id, scope_id, tipo)
    values (v_rec.evento_id, v_rec.user_id, v_tipo);

    v_creadas := v_creadas + 1;
  end loop;

  return v_creadas;
end$$;

/* Permisos: el service_role / postgres puede ejecutarla. RLS no aplica a
   security definer functions. */
