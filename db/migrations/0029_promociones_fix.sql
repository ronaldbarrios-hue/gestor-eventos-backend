-- Promociones: la tabla YA EXISTE en producción, pero con dos problemas:
--   1) ticket_id apuntaba a tickets(id) (boletas emitidas) cuando el frontend
--      envía un TIPO de boleta → crear una promoción por tipo fallaba siempre
--      con violación de llave foránea.
--   2) RLS activo pero SIN políticas.
-- Esta migración es idempotente: crea la tabla si no existe y corrige lo demás.

create table if not exists promociones (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references eventos(id) on delete cascade,
  codigo        text not null,
  descripcion   text,
  tipo          text not null default 'porcentaje',   -- porcentaje | fijo
  valor         numeric not null default 0,
  ticket_id     uuid,
  min_cantidad  int not null default 1,
  limite_usos   int,
  usos          int not null default 0,
  vigente_desde timestamptz,
  vigente_hasta timestamptz,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (evento_id, codigo)
);
create index if not exists promociones_evento_idx on promociones (evento_id);

-- 1) Corregir la llave foránea: ticket_types, no tickets.
--    Se limpian primero valores que no existan en ticket_types para poder
--    crear la constraint sin fallar.
alter table promociones drop constraint if exists promociones_ticket_id_fkey;
update promociones p
   set ticket_id = null
 where p.ticket_id is not null
   and not exists (select 1 from ticket_types t where t.id = p.ticket_id);
alter table promociones
  add constraint promociones_ticket_id_fkey
  foreign key (ticket_id) references ticket_types(id) on delete set null;

-- 2) RLS: el backend usa service key (la ignora); esto es defensa en profundidad
--    para que nadie lea promociones de eventos ajenos desde la API pública.
alter table promociones enable row level security;
drop policy if exists promociones_owner_select on promociones;
create policy promociones_owner_select on promociones
  for select using (
    exists (select 1 from eventos e where e.id = promociones.evento_id and e.owner_id = auth.uid())
  );
