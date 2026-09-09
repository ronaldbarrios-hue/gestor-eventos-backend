-- 0118 · Una boleta, varios puestos
--
-- Hasta ahora la unidad más pequeña era la boleta. Con mesas y palcos hace falta
-- una menor: una mesa de ringside se vende como UNA boleta y entran cuatro
-- personas. Ver las notas 23 y 24 de la bóveda.
--
-- ── Qué desbloquea ─────────────────────────────────────────────────────
--
-- Los tres modelos de entrada que usa el sector dejan de ser tres desarrollos y
-- pasan a ser configuración del tipo de boleta:
--
--   individual  los N puestos nacen con los datos del comprador, un QR cada uno
--   contador    los N nacen vacíos, una sola credencial y la puerta cuenta
--   anfitrion   los N nacen vacíos y se llenan por un enlace que se comparte
--
-- Y la reventa controlada, que es transferir UN puesto: cambia de titular, se
-- rota su código, y el anterior deja de abrir la puerta.
--
-- ── Lo que esta migración NO decide ────────────────────────────────────
--
-- Nada de la política de reventa: si se permite, con qué tope de precio,
-- cuántas veces, hasta cuándo. Eso está sin decidir a propósito (nota 24) y
-- vive en `ticket_types`, no aquí. Esta tabla sólo hace posible las dos cosas.

-- ── 1 · El puesto ──────────────────────────────────────────────────────

create table if not exists public.ticket_puestos (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets(id) on delete cascade,
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  -- 1..N dentro de la boleta. Sirve para nombrarlos («puesto 2 de 4») sin
  -- depender del orden en que se llenaron.
  orden       int not null default 1 check (orden > 0),

  -- Quién lo ocupa. Vacío es un estado legítimo y frecuente: una mesa comprada
  -- en septiembre para diciembre no sabe todavía quién va.
  nombre      text,
  email       text,
  -- En eventos DEPORTIVOS el Decreto 1622 de 2022 obliga a atar la boleta al
  -- documento de quien la usa. No se exige aquí —hay eventos donde no aplica y
  -- pedirlo de más ahuyenta ventas— pero la columna tiene que existir para que
  -- la regla se pueda encender por evento.
  documento   text,

  -- Su credencial. Se firma igual que la de la boleta (`lib/qr.js`), así que
  -- rotarlo invalida el anterior por construcción: es lo que hace que una
  -- transferencia sea de verdad y no un cambio de nombre.
  qr_token    text,

  estado      text not null default 'libre'
              check (estado in ('libre', 'asignado', 'usado', 'transferido')),
  asignado_at timestamptz,
  usado_at    timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists ticket_puestos_ticket_idx on public.ticket_puestos (ticket_id);
create index if not exists ticket_puestos_evento_idx on public.ticket_puestos (evento_id, estado);

-- Dos puestos con el mismo número en la misma boleta son un error de escritura,
-- no un caso de uso: «puesto 2 de 4» dejaría de identificar a nadie.
create unique index if not exists ticket_puestos_orden_unico
  on public.ticket_puestos (ticket_id, orden);

-- El escáner busca por el token. Sin esto, cada escaneo recorre la tabla.
create unique index if not exists ticket_puestos_token_idx
  on public.ticket_puestos (qr_token) where qr_token is not null;

-- ── 2 · El rastro de las transferencias ────────────────────────────────
--
-- Va en su propia tabla y no como columnas del puesto, por lo mismo que la
-- reserva de un espacio no es un campo del espacio: hace falta el HISTÓRICO.
--
-- Sin él no hay control, sólo una función de traspaso. «¿Cuántas veces circuló
-- esta boleta?» y «¿a quién se la compró?» son las dos preguntas que se hacen
-- cuando algo sale mal en la puerta, y las dos necesitan las filas anteriores.

create table if not exists public.puesto_transferencias (
  id          uuid primary key default gen_random_uuid(),
  puesto_id   uuid not null references public.ticket_puestos(id) on delete cascade,
  evento_id   uuid not null references public.eventos(id) on delete cascade,

  -- De quién a quién. Se guarda el texto y no una referencia a `profiles`
  -- porque quien recibe casi nunca tiene cuenta: es alguien a quien le pasaron
  -- un enlace por WhatsApp.
  de_nombre   text,
  de_email    text,
  a_nombre    text,
  a_email     text,
  a_documento text,

  -- Cuánto se pagó, si se pagó. `null` es «me la regalaron», que va a ser la
  -- mayoría. El tope se comprueba al transferir; aquí sólo queda anotado.
  monto       numeric(12,2),
  currency    text,

  -- Quién la hizo: el titular desde su boleta, o alguien del equipo desde el
  -- panel. Una transferencia hecha por el organizador es legítima y tiene que
  -- distinguirse de una hecha por el titular.
  via         text not null default 'titular' check (via in ('titular', 'panel', 'agente')),
  actor_id    uuid,

  created_at  timestamptz not null default now()
);

create index if not exists puesto_transf_puesto_idx on public.puesto_transferencias (puesto_id, created_at);
create index if not exists puesto_transf_evento_idx on public.puesto_transferencias (evento_id, created_at);

-- ── 3 · Cómo se entra con este tipo de boleta ──────────────────────────
--
-- El modo vive en el tipo de boleta y no en el evento: el ringside de un
-- concierto puede ser «contador» y el palco corporativo del mismo concierto,
-- «anfitrión».
--
-- `individual` es el valor por defecto y es lo que hace hoy la plataforma con
-- una boleta de una persona, así que nada cambia para lo que ya existe.

alter table public.ticket_types
  add column if not exists modo_entrada text not null default 'individual'
  check (modo_entrada in ('individual', 'contador', 'anfitrion'));

-- ── Comprobación ───────────────────────────────────────────────────────
--
--   select tablename from pg_tables where schemaname='public'
--    and tablename in ('ticket_puestos','puesto_transferencias');
--
--   select column_name from information_schema.columns
--    where table_name='ticket_types' and column_name='modo_entrada';
--
--   -- Y que las boletas de hoy no cambiaron de comportamiento:
--   select modo_entrada, count(*) from public.ticket_types group by 1;
--   -- tiene que salir 'individual' para todas.
--
-- ── Vuelta atrás ───────────────────────────────────────────────────────
--
--   alter table public.ticket_types drop column if exists modo_entrada;
--   drop table if exists public.puesto_transferencias;
--   drop table if exists public.ticket_puestos;
--
-- Sin riesgo: dos tablas nuevas y una columna con valor por defecto. Ninguna
-- boleta existente cambia de comportamiento — `individual` es lo que ya hacían.
--
-- ── Y lo que hace falta DESPUÉS de aplicarla ───────────────────────────
--
-- Nada. Esta migración no enciende nada por sí sola: sin código que cree
-- puestos, la tabla se queda vacía y la plataforma sigue igual. Se aplica ahora
-- para que las decisiones de la nota 24 —tope de precio, cuántas veces, si hay
-- dinero— se puedan tomar sin volver a tocar el esquema.
