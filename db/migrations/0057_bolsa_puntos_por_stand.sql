-- 0057 · Bolsa de puntos del evento y cuota por stand. Idempotente.
--
-- Desde 0037 cada expositor tiene su cartera: los puntos que da un stand son
-- suyos y no se canjean en otro. Lo que no había era techo. Un stand podía
-- otorgar puntos sin límite, así que la economía del evento dependía de que
-- nadie se pasara — y la gracia de una gamificación es justo que el organizador
-- controle cuánto se reparte.
--
-- Aquí el organizador define una bolsa total del evento y le asigna una cuota a
-- cada stand. Un stand solo puede dar hasta su cuota.
--
-- Sobre dónde vive el consumo: NO se guarda un contador. Se calcula sumando
-- ticket_interacciones, que es la única fuente de verdad de lo que se otorgó.
-- Un contador aparte se desincroniza el día que alguien borre una interacción a
-- mano, y entonces la cuota miente sin que nadie lo note. Para eso está el
-- índice de 0037 (idx_interacciones_expositor).

/* La bolsa del evento. Una fila por evento. */
create table if not exists public.evento_bolsa_puntos (
  evento_id  uuid primary key references public.eventos(id) on delete cascade,
  /* Total que el organizador decide repartir. Null = sin bolsa definida, que es
     el comportamiento de siempre: nadie tiene techo. */
  total      integer,
  /* Cuota que se le pone por defecto a un stand nuevo. Null = sin cuota. */
  cuota_defecto integer,
  nota       text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.evento_bolsa_puntos enable row level security;

drop policy if exists evento_bolsa_puntos_rw on public.evento_bolsa_puntos;
create policy evento_bolsa_puntos_rw on public.evento_bolsa_puntos
  for all using (
    exists (
      select 1 from public.eventos e
      where e.id = evento_bolsa_puntos.evento_id and e.owner_id = auth.uid()
    )
  );

/* La cuota de cada stand. */
alter table public.networking_expositores
  add column if not exists cuota_puntos integer;

comment on column public.networking_expositores.cuota_puntos is
  'Tope de puntos que este stand puede otorgar en total. Null = sin tope.';

/* La ficha del stand: teníamos apuntado que "hoy solo hay nombre, número,
   descripción, logo y web". No es así. Comprobado contra la base:
   contacto_nombre, contacto_email, contacto_telefono, tipo_persona, sitio_web,
   redes (jsonb) y categoria_negocio ya existen, y CAMPOS_STAND en
   routes/networking.js los acepta al guardar desde el principio.

   Lo que pasaba es que el SELECT del listado no los devolvía, así que el panel
   no los veía y parecía que no existieran. Eso se arregla en el código, no aquí.

   Lo único que falta de verdad es la galería. */
alter table public.networking_expositores
  add column if not exists galeria jsonb not null default '[]'::jsonb;

comment on column public.networking_expositores.galeria is
  'URLs de imágenes del stand. Array de texto en jsonb.';

/* ── Cuánto ha otorgado cada stand ────────────────────────────────────
   Se suma de ticket_interacciones. Solo cuentan los puntos positivos: un
   motivo negativo resta al asistente pero no consume bolsa del stand. */
/* security_invoker: sin él la vista se evalúa con los permisos de quien la creó
   y se salta la RLS de quien consulta. Es el default de Postgres y el linter lo
   marca como error — pasó con v_participacion_sesiones en la 0055. */
create or replace view public.v_consumo_puntos_stand
with (security_invoker = true) as
select
  x.evento_id,
  x.id                                    as expositor_id,
  x.nombre,
  x.stand,
  x.cuota_puntos,
  coalesce(sum(i.puntos) filter (where i.puntos > 0), 0)::integer as otorgados,
  count(i.id) filter (where i.puntos > 0)                         as veces,
  count(distinct i.ticket_id)                                     as asistentes_distintos,
  case
    when x.cuota_puntos is null then null
    else greatest(0, x.cuota_puntos - coalesce(sum(i.puntos) filter (where i.puntos > 0), 0))::integer
  end                                                             as disponibles
from public.networking_expositores x
left join public.ticket_interacciones i on i.expositor_id = x.id
group by x.evento_id, x.id, x.nombre, x.stand, x.cuota_puntos;

/* ── El tope, aplicado en la base ─────────────────────────────────────
   Va en un trigger y no solo en el backend a propósito: el portal del expositor
   escribe con la service key, y si mañana alguien añade otro camino para otorgar
   puntos —una importación, un script, otra ruta— el tope tiene que seguir
   valiendo. Comprobarlo solo en una ruta es confiar en que nadie escriba una
   segunda. */
create or replace function private.fn_verificar_cuota_stand()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cuota integer;
  v_otorgados integer;
begin
  /* Solo aplica a lo que otorga un stand y suma puntos. */
  if new.expositor_id is null or coalesce(new.puntos, 0) <= 0 then
    return new;
  end if;

  select cuota_puntos into v_cuota
  from public.networking_expositores where id = new.expositor_id;

  if v_cuota is null then
    return new;
  end if;

  select coalesce(sum(puntos) filter (where puntos > 0), 0) into v_otorgados
  from public.ticket_interacciones
  where expositor_id = new.expositor_id
    and (tg_op <> 'UPDATE' or id <> new.id);

  if v_otorgados + new.puntos > v_cuota then
    raise exception 'CUOTA_STAND_AGOTADA: este stand ya repartió % de sus % puntos; le quedan %.',
      v_otorgados, v_cuota, greatest(0, v_cuota - v_otorgados)
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_verificar_cuota_stand on public.ticket_interacciones;
create trigger trg_verificar_cuota_stand
  before insert or update on public.ticket_interacciones
  for each row execute function private.fn_verificar_cuota_stand();

/* ── Resumen de la bolsa por evento ── */
create or replace view public.v_bolsa_evento
with (security_invoker = true) as
select
  e.id                                        as evento_id,
  b.total                                     as bolsa_total,
  b.cuota_defecto,
  coalesce(sum(c.cuota_puntos), 0)::integer   as repartido_en_cuotas,
  coalesce(sum(c.otorgados), 0)::integer      as otorgado_real,
  case
    when b.total is null then null
    else (b.total - coalesce(sum(c.cuota_puntos), 0))::integer
  end                                         as sin_asignar,
  count(c.expositor_id)                       as stands,
  count(c.expositor_id) filter (where c.cuota_puntos is null) as stands_sin_cuota
from public.eventos e
left join public.evento_bolsa_puntos b on b.evento_id = e.id
left join public.v_consumo_puntos_stand c on c.evento_id = e.id
where e.deleted_at is null
group by e.id, b.total, b.cuota_defecto;
