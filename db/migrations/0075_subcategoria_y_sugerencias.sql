/* 0075 — El nivel libre debajo de la categoría, y por dónde pedir uno nuevo.

   ── La subcategoría ──────────────────────────────────────────────────
   La categoría del espacio ya existe (`agenda_sessions.tipo`: charla, taller,
   competencia, stand…) y la pone la plataforma. Eso NO se toca, y a propósito:
   es lo que permite que un torneo active sus llaves y una charla pida ponente.
   Si el nivel de arriba fuera texto libre, la plataforma tendría que decidir el
   comportamiento comparando contra lo que cada quien escribiera —«Torneo»,
   «torneo», «Torneos»—, que es justo adaptar la plataforma a cada evento.

   Lo que faltaba es el nivel de abajo, que sí es de cada organizador:

     competencia → Deportes    → Fútbol, Pádel
     competencia → Gaming      → FIFA, Fortnite
     competencia → Habilidades → Hackatón, Mejor stand

   Es texto libre porque nadie puede predecir esa lista, y es UNA COLUMNA y no
   una tabla porque no tiene atributos propios: es una etiqueta para agrupar y
   filtrar. Una tabla de catálogo obligaría a crear la subcategoría antes de
   poder usarla, que es fricción para algo que se escribe una vez.

   ── Las sugerencias ──────────────────────────────────────────────────
   La consecuencia honesta de que la categoría la fije la plataforma es que
   cuando alguien monta un show de stand-up no encuentra su dinámica. Sin un
   sitio donde pedirla, la salida es elegir «Otro» y apañárselas — y nosotros
   no nos enteramos nunca de qué falta.

   Por eso la tabla guarda `como_funciona`: lo caro de implementar una dinámica
   no es saber que se llama stand-up, es saber qué necesita —¿tiene inscritos?
   ¿turnos? ¿votación del público?—. Pedir eso en el momento de la solicitud
   ahorra la conversación de vuelta. */

alter table agenda_sessions
  add column if not exists subcategoria text;

comment on column agenda_sessions.subcategoria is
  'Agrupacion libre del organizador dentro del tipo (Deportes, Gaming...). El tipo lo fija la plataforma.';

/* Filtrar «todos los de Gaming» dentro de un evento. Parcial porque la enorme
   mayoria de sesiones no tendra subcategoria y no tiene sentido indexarlas. */
create index if not exists idx_agenda_sessions_subcategoria
  on agenda_sessions (evento_id, subcategoria)
  where subcategoria is not null;

create table if not exists sugerencias_dinamica (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  evento_id     uuid references eventos(id) on delete set null,

  titulo        text not null,
  como_funciona text not null,
  /* Con qué se apañó mientras tanto. Dice cuánto duele: quien puso «Otro» y
     siguió no es lo mismo que quien dejó de usar la plataforma para eso. */
  alternativa   text,

  estado        text not null default 'nueva'
                check (estado in ('nueva', 'leida', 'planeada', 'hecha', 'descartada')),
  respuesta     text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_sugerencias_estado on sugerencias_dinamica (estado, created_at desc);
create index if not exists idx_sugerencias_owner  on sugerencias_dinamica (owner_id, created_at desc);

alter table sugerencias_dinamica enable row level security;

/* Cada quien ve y escribe las suyas. La lectura del equipo va por la clave de
   servicio, que se salta RLS — no hay rol de plataforma en esta base. */
drop policy if exists sugerencias_propias on sugerencias_dinamica;
create policy sugerencias_propias on sugerencias_dinamica
  for select using (auth.uid() = owner_id);

drop policy if exists sugerencias_crear on sugerencias_dinamica;
create policy sugerencias_crear on sugerencias_dinamica
  for insert with check (auth.uid() = owner_id);
