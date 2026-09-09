-- 0120 · El recinto se dibuja una vez
--
-- Dibujar el Movistar Arena son horas: doscientos bloques, la general, los
-- palcos, y calcarlo todo sobre el plano oficial. Hoy ese trabajo vive dentro
-- de UN evento y muere con él. El siguiente concierto en el mismo sitio vuelve
-- a empezar de cero.
--
-- Esta tabla es lo que separa «una herramienta de dibujo» de «una plataforma de
-- recintos»: el recinto se guarda una vez, y cada evento parte de una COPIA.
--
-- ── Por qué una copia y no una referencia ──────────────────────────────
--
-- Es la decisión de fondo, y va a favor de la copia por una razón que no es de
-- comodidad: **cada montaje es distinto**. El mismo arena tiene el escenario a
-- un extremo un sábado y en redondo el domingo; se cierran tribunas por
-- producción, se quita la general, se añaden palcos VIP.
--
-- Con una referencia viva, tocar la plantilla cambiaría el plano de eventos que
-- YA VENDIERON boletas: alguien compró «Tribuna 104, fila F» y el recinto
-- decide que la 104 ahora está en otro sitio. Eso no se arregla.
--
-- Con copia, la plantilla es un punto de partida y cada evento es dueño de su
-- plano. Lo que se pierde —propagar una corrección a todos— es justo lo que no
-- se debe poder hacer.
--
-- ── Y por qué el plano va como jsonb y no como filas ───────────────────
--
-- Porque una plantilla no se vende. No hay reservas contra ella, ni boletas, ni
-- aforo: es un dibujo. Guardarla como filas de `espacios` obligaría a que cada
-- consulta de espacios supiera distinguir «esto es de un evento» de «esto es
-- una plantilla», y esa distinción olvidada en un solo sitio serviría al
-- público sillas de un recinto que no existe.

create table if not exists public.recintos (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,

  nombre      text not null,
  -- Dónde está. Sirve para reconocerlo en una lista de veinte: «Movistar Arena»
  -- a secas se repite entre ciudades.
  ciudad      text,
  direccion   text,

  -- El aforo legal del edificio, que NO es la suma de las sillas de un montaje:
  -- un arena de 14.000 monta 6.000 para un show acústico. Se guarda para poder
  -- avisar cuando un montaje se pasa.
  aforo_legal int check (aforo_legal is null or aforo_legal > 0),

  -- El dibujo: la lista de espacios con su forma, tal como los guarda el editor.
  -- Sin ids de evento dentro; los ids se generan al copiar.
  plano       jsonb not null default '[]'::jsonb,
  -- La imagen del plano oficial que se calcó, para poder seguir calcando en la
  -- copia. Va aquí y no en el evento porque es del edificio, no del concierto.
  fondo       jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists recintos_owner_idx on public.recintos (owner_id, nombre);

-- Dos recintos con el mismo nombre en la misma cuenta son un error de tecleo,
-- no un caso de uso: al elegir en una lista, no se distinguirían.
create unique index if not exists recintos_nombre_unico
  on public.recintos (owner_id, lower(nombre));

-- ── Quién ve qué ───────────────────────────────────────────────────────
--
-- Un recinto es de quien lo dibujó. No es público: el plano de un edificio con
-- sus palcos y sus accesos es trabajo, y de paso información de un cliente.

alter table public.recintos enable row level security;

do $$
begin
  create policy recintos_solo_su_dueno on public.recintos
    for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
exception
  when duplicate_object then null;
end $$;

-- ── Comprobación ───────────────────────────────────────────────────────
--
--   select tablename, rowsecurity from pg_tables
--    where schemaname='public' and tablename='recintos';
--   -- rowsecurity tiene que salir true.
--
--   select polname from pg_policies where tablename='recintos';
--
-- ── Vuelta atrás ───────────────────────────────────────────────────────
--
--   drop table if exists public.recintos;
--
-- Sin riesgo: tabla nueva y nadie depende de ella. Ningún evento cambia.
