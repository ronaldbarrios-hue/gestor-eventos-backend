-- 0079 · Aforo por zonas: entradas/salidas, corte ("limpiar") y reportes.
-- Idempotente. PENDIENTE DE APLICAR.
--
-- Qué cambia y por qué:
--
-- 1. `ticket_movimientos.zona_id`. El aforo por zona se contaba por el NOMBRE
--    de la zona. Renombrar "VIP" a "Zona VIP" partía la cuenta en dos y el
--    histórico quedaba huérfano. Ahora manda el id estable de
--    `page_json.zonas`; el nombre se conserva como foto del momento para que
--    el reporte diga cómo se llamaba la zona ese día. Los movimientos viejos
--    se rellenan abajo emparejando por nombre.
--
-- 2. `ticket_id` deja de ser obligatorio, y aparece `cantidad`. El control de
--    una zona no siempre pasa por una boleta: el staff de la puerta de la
--    tarima cuenta gente. Un movimiento manual es una fila sin ticket, con
--    `origen = 'manual'` y la cantidad que se marcó de golpe.
--
-- 3. `zona_cortes`. "Limpiar el aforo" no puede ser un DELETE: el reporte del
--    día vive de esos movimientos. Un corte es una marca de tiempo; la
--    ocupación se cuenta desde el último corte, el histórico queda entero.
--
-- 4. Cuatro funciones de agregación. La cuenta se hacía trayendo todas las
--    filas al backend y sumándolas en JS: PostgREST devuelve 1.000 filas por
--    defecto, así que a partir del movimiento 1.001 el aforo mentía por lo
--    bajo — justo en el evento grande, que es cuando importa. Se agrega en
--    Postgres.
--
-- Nada de esto bloquea un ingreso: pasarse del aforo está permitido a
-- propósito (se avisa, se registra, y la gente sigue entrando).

begin;

-- ── 1 · Movimientos: zona estable, conteo manual ──
alter table public.ticket_movimientos add column if not exists zona_id  text;
alter table public.ticket_movimientos add column if not exists cantidad integer not null default 1;
alter table public.ticket_movimientos add column if not exists origen   text not null default 'qr';
alter table public.ticket_movimientos add column if not exists nota     text;
alter table public.ticket_movimientos alter column ticket_id drop not null;

create index if not exists ticket_movimientos_zona_id_idx
  on public.ticket_movimientos(evento_id, zona_id, created_at);

/* Relleno del zona_id de lo ya registrado, emparejando por nombre contra las
   zonas declaradas en el evento. Sin esto, la misma zona tendría dos claves
   (id para lo nuevo, nombre para lo viejo) y el aforo saldría duplicado. */
update public.ticket_movimientos m
   set zona_id = z.id
  from public.eventos e,
       lateral jsonb_to_recordset(
         case when jsonb_typeof(e.page_json->'zonas') = 'array'
              then e.page_json->'zonas' else '[]'::jsonb end
       ) as z(id text, nombre text)
 where m.evento_id = e.id
   and m.zona_id is null
   and m.zona is not null
   and z.nombre = m.zona;

-- ── 2 · Cortes de aforo ("limpiar", sin perder el histórico) ──
create table if not exists public.zona_cortes (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.eventos(id) on delete cascade,
  zona_id    text,
  zona       text,
  motivo     text,
  dentro_antes integer,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists zona_cortes_evento_idx on public.zona_cortes(evento_id, zona_id, created_at);
alter table public.zona_cortes enable row level security;

-- ── 3 · Agregados ──
-- La clave de una zona es su id; las filas anteriores a esta migración que no
-- se pudieron emparejar caen de vuelta al nombre.

/* Ocupación viva: sólo cuenta lo posterior al último corte de esa zona. */
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
    select coalesce(zc.zona_id, zc.zona) as clave, max(zc.created_at) as corte_at
      from public.zona_cortes zc
     where zc.evento_id = p_evento
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

/* Totales de TODO el histórico, corte incluido: es lo que pide un reporte. */
create or replace function public.aforo_zonas_resumen(p_evento uuid)
returns table (
  clave text, zona text,
  entradas bigint, salidas bigint, personas bigint,
  manuales bigint, primera_at timestamptz, ultima_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(mv.zona_id, mv.zona),
         (array_agg(mv.zona order by mv.created_at desc))[1],
         coalesce(sum(coalesce(mv.cantidad, 1)) filter (where mv.tipo = 'entrada'), 0)::bigint,
         coalesce(sum(coalesce(mv.cantidad, 1)) filter (where mv.tipo = 'salida'), 0)::bigint,
         count(distinct mv.ticket_id) filter (where mv.tipo = 'entrada')::bigint,
         coalesce(sum(coalesce(mv.cantidad, 1)) filter (where mv.origen = 'manual'), 0)::bigint,
         min(mv.created_at), max(mv.created_at)
    from public.ticket_movimientos mv
   where mv.evento_id = p_evento
     and (mv.zona_id is not null or mv.zona is not null)
   group by 1;
$$;

/* Serie temporal por franjas: con esto se dibuja la curva del día y se saca
   el pico de ocupación (acumulando entradas menos salidas en orden). */
create or replace function public.aforo_zonas_serie(p_evento uuid, p_minutos integer default 15)
returns table (clave text, bucket timestamptz, entradas bigint, salidas bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(mv.zona_id, mv.zona),
         to_timestamp(floor(extract(epoch from mv.created_at) / (greatest(p_minutos, 1) * 60))
                      * (greatest(p_minutos, 1) * 60)),
         coalesce(sum(coalesce(mv.cantidad, 1)) filter (where mv.tipo = 'entrada'), 0)::bigint,
         coalesce(sum(coalesce(mv.cantidad, 1)) filter (where mv.tipo = 'salida'), 0)::bigint
    from public.ticket_movimientos mv
   where mv.evento_id = p_evento
     and (mv.zona_id is not null or mv.zona is not null)
   group by 1, 2
   order by 2;
$$;

/* Cuánto se queda la gente: empareja cada entrada con la salida siguiente de
   la misma boleta en la misma zona. Los conteos manuales no tienen boleta, así
   que no cuentan aquí — y por eso se devuelve también cuántos tramos se
   midieron, para que el número se pueda leer con contexto. */
create or replace function public.aforo_zonas_estancia(p_evento uuid)
returns table (clave text, minutos_prom numeric, minutos_max numeric, tramos bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with pares as (
    select coalesce(mv.zona_id, mv.zona) as clave,
           mv.tipo,
           mv.created_at,
           lead(mv.tipo)       over (partition by mv.ticket_id, coalesce(mv.zona_id, mv.zona) order by mv.created_at) as sig_tipo,
           lead(mv.created_at) over (partition by mv.ticket_id, coalesce(mv.zona_id, mv.zona) order by mv.created_at) as sig_at
      from public.ticket_movimientos mv
     where mv.evento_id = p_evento
       and mv.ticket_id is not null
       and (mv.zona_id is not null or mv.zona is not null)
  )
  select clave,
         round(avg(extract(epoch from (sig_at - created_at)) / 60)::numeric, 1),
         round(max(extract(epoch from (sig_at - created_at)) / 60)::numeric, 1),
         count(*)::bigint
    from pares
   where tipo = 'entrada' and sig_tipo = 'salida'
   group by clave;
$$;

/* Sólo el backend (service_role) las llama. Dejarlas abiertas expondría la
   ocupación de cualquier evento en /rest/v1/rpc/ con sólo saber su id. */
do $$
declare f text;
begin
  foreach f in array array[
    'public.aforo_zonas(uuid)',
    'public.aforo_zonas_resumen(uuid)',
    'public.aforo_zonas_serie(uuid, integer)',
    'public.aforo_zonas_estancia(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
