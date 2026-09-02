-- 0087 · zona_cortes: tipo (reset/auto/manual), foto y nota del "tomar reporte".
-- Idempotente. APLICADA — verificado contra produccion el 2026-09-02
-- (information_schema, solo lectura): existen zona_cortes.tipo y foto_url.
--
-- Hasta ahora `zona_cortes` sólo servía para un "limpiar el contador"
-- (motivo implícito: reset). El Camino unitario del 2026-09-01 agrega el
-- reporte manual del staff (con foto de evidencia y nota) y deja listo el
-- terreno para el reporte automático por cron (Fase 3 del plan): los dos
-- escriben una fila en esta misma tabla para quedar en el histórico junto a
-- los resets, PERO —a diferencia de un reset— no deben poner la ocupación
-- en cero.
--
-- `aforo_zonas()` es la ÚNICA función que lee `zona_cortes` para decidir
-- desde cuándo contar la ocupación viva (las demás —resumen/serie/estancia—
-- ya usan TODO el histórico a propósito). Se actualiza para que sólo un
-- corte tipo 'reset' mueva ese punto; sin este cambio, cada reporte manual
-- pondría el contador en vivo en cero.

begin;

alter table public.zona_cortes
  add column if not exists tipo     text not null default 'reset',
  add column if not exists foto_url text,
  add column if not exists nota     text,
  add column if not exists contexto jsonb;

alter table public.zona_cortes drop constraint if exists zona_cortes_tipo_check;
alter table public.zona_cortes add constraint zona_cortes_tipo_check
  check (tipo in ('reset', 'auto', 'manual'));

create or replace function public.aforo_zonas(p_evento uuid)
returns table (
  clave text, zona text,
  entradas bigint, salidas bigint, dentro bigint,
  personas bigint, ultima_at timestamptz, corte_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  with m as (
    select coalesce(mv.zona_id, mv.zona) as clave,
           mv.zona as nombre, mv.tipo, mv.ticket_id,
           coalesce(mv.cantidad, 1) as cantidad, mv.created_at
      from public.ticket_movimientos mv
     where mv.evento_id = p_evento
       and (mv.zona_id is not null or mv.zona is not null)
  ),
  c as (
    /* Sólo 'reset' cuenta como corte de la ocupación viva: un reporte manual
       o automático escribe aquí para el histórico, no para vaciar la zona. */
    select coalesce(zc.zona_id, zc.zona) as clave, max(zc.created_at) as corte_at
      from public.zona_cortes zc
     where zc.evento_id = p_evento
       and zc.tipo = 'reset'
     group by 1
  )
  select m.clave,
         (array_agg(m.nombre order by m.created_at desc))[1],
         coalesce(sum(m.cantidad) filter (where m.tipo = 'entrada'), 0)::bigint,
         coalesce(sum(m.cantidad) filter (where m.tipo = 'salida'), 0)::bigint,
         coalesce(sum(case when m.tipo = 'entrada' then m.cantidad else -m.cantidad end), 0)::bigint,
         count(distinct m.ticket_id) filter (where m.tipo = 'entrada')::bigint,
         max(m.created_at),
         max(c.corte_at)
    from m left join c on c.clave = m.clave
   where c.corte_at is null or m.created_at > c.corte_at
   group by m.clave;
$$;

revoke all on function public.aforo_zonas(uuid) from public, anon, authenticated;
grant execute on function public.aforo_zonas(uuid) to service_role;

commit;
