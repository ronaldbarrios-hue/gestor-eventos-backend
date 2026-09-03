-- 0086 · La funcion de recordatorios in-app insertaba una columna que no existe
--
-- APLICADA el 2026-09-02. Comprobado antes con precision —mirar si el cuerpo
-- menciona «link» daba un FALSO POSITIVO, porque la version arreglada lo dice en
-- un comentario; hay que mirar la lista de columnas del INSERT— y despues: el
-- INSERT ya no lleva `link`.
--
-- `generar_recordatorios_inapp()` hace INSERT INTO notificaciones (..., link, ...)
-- y esa tabla NO tiene `link`. Revienta en la primera fila del bucle y se lleva
-- la transaccion entera, asi que nunca ha creado un solo aviso.
--
-- Medido sobre produccion el 30 de agosto de 2026, antes de tocar nada:
--
--   recordatorio_inapp_log ............... 0 filas
--   notificaciones, en toda su historia .. 0 filas
--   email_log con tipo t7d/t1d/t1h ....... 28 filas
--   eventos que hoy cumplen la condicion .. 11
--
-- Es decir: el recordatorio por CORREO sale y ha salido 28 veces; el de dentro
-- de la aplicacion no ha salido nunca. Esto es lo que MIGRACION-SUPABASE.md §2
-- llamaba «el recordatorio nunca ha funcionado», con la causa exacta.
--
-- Se quita `link` del INSERT en vez de anadir la columna a la tabla: el
-- frontend no la lee en ningun sitio —ni el widget de la campana ni la pagina
-- de notificaciones—, asi que la columna que sobra es la del INSERT.
--
-- El resto del cuerpo se deja EXACTO. Es un arreglo de una linea y no el
-- momento de reescribir la funcion: lo que la sustituye ya esta en
-- modules/recordatorios/index.js, para cuando los datos vivan en MySQL.
--
-- No es destructiva y no borra nada. Se puede aplicar en caliente.

create or replace function public.generar_recordatorios_inapp()
returns integer
language plpgsql
as $function$
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
      select ep.evento_id, ep.titulo, ep.slug, ep.tipo, ep.owner_id as user_id
      from eventos_proximos ep where ep.tipo is not null
      union
      select ep.evento_id, ep.titulo, ep.slug, ep.tipo, m.user_id
      from eventos_proximos ep
      join public.event_members m on m.evento_id = ep.evento_id and m.status = 'active' and m.user_id is not null
      where ep.tipo is not null
      union
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

    -- Sin `link`: era la unica diferencia, y la que lo rompia.
    insert into public.notificaciones (user_id, tipo, titulo, cuerpo, evento_id)
    values (
      v_rec.user_id,
      'sistema',
      'Recordatorio: ' || v_rec.titulo,
      'El evento empieza ' || v_label || '.',
      v_rec.evento_id
    );

    insert into public.recordatorio_inapp_log (evento_id, scope_id, tipo)
    values (v_rec.evento_id, v_rec.user_id, v_tipo);

    v_creadas := v_creadas + 1;
  end loop;

  return v_creadas;
end
$function$;
