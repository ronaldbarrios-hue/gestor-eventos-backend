-- 0117 · La silla que se compra
--
-- Vender un sitio CONCRETO —la silla C-14, la mesa 3 de ringside, el palco
-- norte— y no «una entrada». Ver la nota 22 de la bóveda para el diseño entero.
--
-- ── Por qué tres tablas y no un campo ──────────────────────────────────
--
-- La tentación es poner `estado` en la silla: libre / vendida. No sirve, y no es
-- una cuestión de elegancia:
--
--   Un campo se LEE y luego se ESCRIBE. Entre las dos cosas cabe otra persona
--   comprando la misma silla, y las dos salen contentas. Eso es doble venta, y
--   en boletería es lo peor que puede pasar: se descubre en la puerta, con las
--   dos personas delante y el mismo asiento.
--
-- La reserva va en su propia tabla con un índice único parcial, de forma que
-- **el motor** impide la segunda. No la aplicación, que puede tener un fallo:
-- Postgres, que no lo tiene.
--
-- Y de paso queda el histórico —quién retuvo qué y cuándo—, sin el cual una
-- disputa («la compré y me la quitaron») no se puede resolver.

-- ── 1 · Los espacios ───────────────────────────────────────────────────
--
-- Un árbol. El recinto contiene pabellones, el pabellón secciones, la sección
-- filas, la fila sillas. O el pabellón contiene mesas. La profundidad la decide
-- el recinto, no el software.
--
-- Y lo importante: una silla, una mesa de ringside, un stand de feria y un local
-- de comida son EL MISMO TIPO DE COSA — una hoja que se asigna o se vende. Hoy
-- eso está resuelto de cuatro maneras distintas en la base (una zona con aforo,
-- un `stand` que es texto, una mesa de rueda que en realidad es el expositor, y
-- una silla que no existe). Esta tabla es la que las unifica; la migración de
-- las tres viejas va aparte y después, cuando ésta esté rodada.

create table if not exists public.espacios (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  parent_id   uuid references public.espacios(id) on delete cascade,
  nombre      text not null,
  -- Qué es. Libre a propósito: cada recinto nombra lo suyo («pabellón»,
  -- «gradería», «palco», «pesebrera»). Lo que el software mira es `modo`.
  tipo        text not null default 'zona',
  -- Qué se puede hacer con él:
  --   aforo      cuenta gente, no se asigna a nadie (una gradería)
  --   asignable  se le da a alguien sin cobrarlo aquí (un stand)
  --   vendible   se compra: silla, mesa, palco
  modo        text not null default 'aforo'
              check (modo in ('aforo', 'asignable', 'vendible')),
  aforo_max   int check (aforo_max is null or aforo_max > 0),
  -- Cuánta gente admite una unidad vendible. Una silla, 1. Una mesa de
  -- ringside, 4. Un palco, 8.
  --
  -- Una unidad vendible emite UNA boleta, y esa boleta admite `capacidad`
  -- personas.
  --
  -- El AFORO ya lo cuenta bien: `lib/cuantasPersonas.js` hace que doce mesas de
  -- cuatro sumen 48 al aforo del evento y 12 a `vendidos` del tipo de boleta,
  -- que son dos números distintos a propósito —el cupo se agota por unidades,
  -- el recinto se llena por personas—.
  --
  -- Lo que SIGUE pendiente es el escáner de la puerta: cuenta una entrada por
  -- boleta, así que un palco de ocho marca una sola asistencia. No es un
  -- problema de aforo (ése ya cuadra) sino de saber cuánta gente entró de
  -- verdad, y de decidir si el QR se escanea una vez o una por persona. Esa
  -- decisión es de producto, no de código.
  capacidad   int not null default 1 check (capacidad > 0),
  -- Dónde está dibujado. Sólo en las hojas que se pintan; un pabellón de feria
  -- no necesita coordenadas. { x, y, rot }
  geometria   jsonb,
  -- Accesible, visibilidad reducida, bloqueado por producción…
  atributos   jsonb not null default '{}'::jsonb,
  orden       int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists espacios_evento_idx on public.espacios (evento_id);
create index if not exists espacios_padre_idx  on public.espacios (parent_id);
-- El mapa público pide todas las unidades vendibles de un evento de una vez.
create index if not exists espacios_vendibles_idx
  on public.espacios (evento_id) where modo = 'vendible';

-- Un espacio no puede ser su propio padre. No cubre un ciclo de tres, pero sí
-- el error de un clic que es el que pasa de verdad.
alter table public.espacios drop constraint if exists espacios_no_es_su_padre;
alter table public.espacios add constraint espacios_no_es_su_padre
  check (parent_id is null or parent_id <> id);

-- ── 2 · Qué localidad es cada espacio ──────────────────────────────────
--
-- El precio vive en la LOCALIDAD, no en la silla: «Platea» es un tipo de boleta
-- a $180.000 asociado a la sección Platea, y todas sus sillas heredan ese
-- precio. Un sobreprecio de primera fila se hace con otro tipo de boleta sobre
-- menos espacios, no con un campo precio en cada silla — que obligaría a
-- reprecificar dos mil filas para subir un 10 %.

create table if not exists public.ticket_type_espacios (
  ticket_type_id uuid not null references public.ticket_types(id) on delete cascade,
  espacio_id     uuid not null references public.espacios(id) on delete cascade,
  primary key (ticket_type_id, espacio_id)
);

create index if not exists tte_espacio_idx on public.ticket_type_espacios (espacio_id);

-- ── 3 · La reserva ─────────────────────────────────────────────────────

create table if not exists public.espacio_reservas (
  id            uuid primary key default gen_random_uuid(),
  espacio_id    uuid not null references public.espacios(id) on delete cascade,
  evento_id     uuid not null references public.eventos(id) on delete cascade,
  estado        text not null check (estado in ('retenido', 'vendido', 'liberado')),
  ticket_id     uuid references public.tickets(id) on delete set null,
  -- Quién lo tiene retenido mientras paga. No es el usuario: alguien sin cuenta
  -- también compra, y la misma persona puede tener dos pestañas.
  sesion_compra text,
  expira_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── LA garantía ────────────────────────────────────────────────────────
--
-- Un espacio con una reserva viva no admite otra. Es un índice, o sea que lo
-- impide el motor durante la escritura: no hay ventana entre comprobar y
-- escribir, que es donde vive la doble venta.
--
-- Si alguien alguna vez "simplifica" esto a un campo en `espacios`, vuelve el
-- fallo. Hay una prueba en el backend que lo fija.
create unique index if not exists espacio_reservas_una_viva
  on public.espacio_reservas (espacio_id)
  where estado in ('retenido', 'vendido');

create index if not exists espacio_reservas_evento_idx
  on public.espacio_reservas (evento_id, estado);
-- Para el trabajo que libera lo caducado.
create index if not exists espacio_reservas_caducan_idx
  on public.espacio_reservas (expira_at) where estado = 'retenido';

-- ── 4 · Retener, que tiene que ser atómico ─────────────────────────────
--
-- Va en una función de Postgres y NO en el servidor por una razón concreta de
-- este montaje: `supabase-js` habla por PostgREST y no puede abrir una
-- transacción de varias sentencias. Y retener son dos pasos que tienen que ir
-- juntos:
--
--   1. liberar la retención caducada de ESA silla, si la hay;
--   2. insertar la nueva.
--
-- Separados desde el servidor, entre el uno y el dos cabe otra persona.
--
-- Nótese que el paso 1 va aquí y no sólo en un cron: si el cron falla o se
-- retrasa, las sillas se siguen liberando solas cuando alguien intenta tomarlas.
-- Un evento no puede depender de que un trabajo periódico esté vivo.

create or replace function public.retener_espacio(
  p_espacio  uuid,
  p_evento   uuid,
  p_sesion   text,
  p_minutos  int default 10
) returns public.espacio_reservas
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.espacio_reservas;
  v_modo text;
  v_evt  uuid;
begin
  select modo, evento_id into v_modo, v_evt
    from public.espacios where id = p_espacio;

  if v_modo is null then
    raise exception 'ESPACIO_NO_EXISTE';
  end if;
  if v_modo <> 'vendible' then
    raise exception 'ESPACIO_NO_VENDIBLE';
  end if;
  -- El evento llega del cliente; se comprueba contra el que dice el espacio.
  if v_evt <> p_evento then
    raise exception 'ESPACIO_DE_OTRO_EVENTO';
  end if;

  update public.espacio_reservas
     set estado = 'liberado', updated_at = now()
   where espacio_id = p_espacio
     and estado = 'retenido'
     and expira_at < now();

  insert into public.espacio_reservas
    (espacio_id, evento_id, estado, sesion_compra, expira_at)
  values
    (p_espacio, p_evento, 'retenido', p_sesion,
     now() + make_interval(mins => greatest(1, least(p_minutos, 30))))
  returning * into r;

  return r;
exception
  -- El índice único. Es la respuesta correcta y hay que decirla como es:
  -- «esa silla se acaba de tomar», no un error genérico.
  when unique_violation then
    raise exception 'ESPACIO_OCUPADO';
end $$;

-- ── 5 · Soltar y confirmar ─────────────────────────────────────────────

-- Soltar: sólo quien la tiene. Sin comprobar la sesión, cualquiera con el id de
-- un espacio podría liberar la silla que otro está pagando.
create or replace function public.liberar_espacio(
  p_espacio uuid,
  p_sesion  text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.espacio_reservas
     set estado = 'liberado', updated_at = now()
   where espacio_id = p_espacio
     and estado = 'retenido'
     and sesion_compra = p_sesion;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Confirmar: la retención pasa a venta cuando el pago se aprueba.
--
-- Devuelve `false` si ya no la tenía —caducó y otro la compró—. Ese caso NO es
-- teórico: pasa con 3-D Secure lento y con pagos en efectivo. Quien llama tiene
-- que decidir qué hacer (reasignar dentro de la misma localidad, o devolver), y
-- eso se decide arriba, no aquí.
create or replace function public.confirmar_espacio(
  p_espacio uuid,
  p_sesion  text,
  p_ticket  uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.espacio_reservas
     set estado = 'vendido', ticket_id = p_ticket,
         expira_at = null, updated_at = now()
   where espacio_id = p_espacio
     and estado = 'retenido'
     and sesion_compra = p_sesion
     and expira_at > now();
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Barrer lo caducado. Complementa —no sustituye— la liberación de
-- `retener_espacio`: sirve para que el mapa se vea al día aunque nadie intente
-- tomar esa silla.
create or replace function public.liberar_espacios_caducados()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.espacio_reservas
     set estado = 'liberado', updated_at = now()
   where estado = 'retenido' and expira_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ── 6 · Quién puede llamarlas ──────────────────────────────────────────
--
-- `anon` puede retener y soltar: quien compra una boleta no tiene cuenta.
-- Confirmar NO: eso sólo lo hace el servidor cuando el pago se aprueba, y por
-- eso va con la llave de servicio. Si `anon` pudiera confirmar, cualquiera se
-- queda una silla sin pagar.

revoke all on function public.retener_espacio(uuid, uuid, text, int) from public;
revoke all on function public.liberar_espacio(uuid, text) from public;
revoke all on function public.confirmar_espacio(uuid, text, uuid) from public;
revoke all on function public.liberar_espacios_caducados() from public;

-- Y por NOMBRE, que es lo que de verdad cierra la puerta.
--
-- `revoke ... from public` quita el permiso del pseudo-rol PUBLIC. No quita el
-- que Supabase concede a `anon` y `authenticated` por defecto sobre las
-- funciones nuevas del esquema `public`: ésos son roles con nombre y hay que
-- revocarlos uno a uno.
--
-- Comprobado contra la base después de aplicar la primera versión de esta
-- migración: `has_function_privilege('anon', 'confirmar_espacio', 'EXECUTE')`
-- devolvía **true**. O sea que cualquiera con la llave pública podía marcar una
-- silla como vendida SIN PAGAR — que es exactamente lo que estas cuatro líneas
-- de más abajo pretendían impedir.
--
-- Se comprueba, no se supone:
--   select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE')
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public' and p.proname like '%espacio%';
revoke execute on function public.confirmar_espacio(uuid, text, uuid) from anon, authenticated;
revoke execute on function public.liberar_espacios_caducados()        from anon, authenticated;

grant execute on function public.retener_espacio(uuid, uuid, text, int) to anon, authenticated, service_role;
grant execute on function public.liberar_espacio(uuid, text)            to anon, authenticated, service_role;
grant execute on function public.confirmar_espacio(uuid, text, uuid)    to service_role;
grant execute on function public.liberar_espacios_caducados()           to service_role;

-- ── 7 · Quién puede leer ───────────────────────────────────────────────
--
-- El mapa público necesita ver los espacios y qué está ocupado. Lo que NO puede
-- ver es de quién es cada reserva: `sesion_compra` identifica un carrito y
-- `ticket_id` lleva a una persona.

alter table public.espacios          enable row level security;
alter table public.espacio_reservas  enable row level security;
alter table public.ticket_type_espacios enable row level security;

drop policy if exists espacios_lectura on public.espacios;
create policy espacios_lectura on public.espacios
  for select using (true);

drop policy if exists tte_lectura on public.ticket_type_espacios;
create policy tte_lectura on public.ticket_type_espacios
  for select using (true);

-- Nada de select para anon sobre las reservas: el estado del mapa lo sirve el
-- backend ya agregado (id del espacio + libre/ocupado), sin filtrar quién.
-- Escribir sólo pasa por las funciones de arriba, que son `security definer`.

-- ── Comprobación ───────────────────────────────────────────────────────
--
--   select tablename from pg_tables where schemaname='public'
--    and tablename in ('espacios','espacio_reservas','ticket_type_espacios');
--
--   select indexname from pg_indexes where indexname = 'espacio_reservas_una_viva';
--
--   select proname from pg_proc where proname in
--    ('retener_espacio','liberar_espacio','confirmar_espacio','liberar_espacios_caducados');
--
--   -- Y la prueba que importa: retener dos veces la misma silla.
--   -- La segunda tiene que decir ESPACIO_OCUPADO.
--
-- ── Vuelta atrás ───────────────────────────────────────────────────────
--
--   drop function if exists public.liberar_espacios_caducados();
--   drop function if exists public.confirmar_espacio(uuid, text, uuid);
--   drop function if exists public.liberar_espacio(uuid, text);
--   drop function if exists public.retener_espacio(uuid, uuid, text, int);
--   drop table if exists public.espacio_reservas;
--   drop table if exists public.ticket_type_espacios;
--   drop table if exists public.espacios;
--
-- Sin riesgo para lo que ya existe: son tablas nuevas y no se toca ninguna
-- columna de las que ya había.
