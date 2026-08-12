-- 0063 · #49 · Buzón de sugerencias para los catálogos.
--
-- El problema: los tipos de evento (`categorias`) y los roles de vacante
-- (`vacante_roles`) son listas cerradas que decidimos nosotros. Cuando alguien
-- monta algo que no está —un torneo de pesca, una feria de adopción, un rol de
-- "operador de dron"— elige "Otro" y ahí muere. Nadie se entera de qué falta,
-- y la lista se amplía adivinando.
--
-- Esto es la forma barata de dejar de adivinar: un buzón donde la persona
-- escribe lo que buscaba en el momento en que no lo encuentra, y queda con su
-- contexto (qué estaba haciendo, qué lista miraba).
--
-- No es un sistema de tickets ni tiene respuesta pública. Es una libreta:
-- entra texto, se lee de vez en cuando, y de ahí salen altas de catálogo. Por
-- eso `estado` tiene sólo cuatro valores y no hay hilo de conversación.

create table if not exists public.sugerencias_catalogo (
  id         uuid primary key default gen_random_uuid(),
  /* Qué lista se quedó corta. Abierto a propósito: si mañana hay un tercer
     catálogo, se añade un valor y no una tabla. */
  catalogo   text not null check (catalogo in ('evento', 'vacante')),
  texto      text not null,
  /* Lo que la persona estaba mirando: la categoría que sí eligió, el evento
     desde el que escribió… Sirve para entender la sugerencia meses después,
     cuando ya nadie recuerda el contexto. */
  contexto   jsonb not null default '{}'::jsonb,
  user_id    uuid references public.profiles(id) on delete set null,
  estado     text not null default 'nueva'
             check (estado in ('nueva', 'vista', 'aceptada', 'descartada')),
  created_at timestamptz not null default now()
);

create index if not exists sugerencias_catalogo_idx
  on public.sugerencias_catalogo (catalogo, estado, created_at desc);
create index if not exists sugerencias_catalogo_user_idx
  on public.sugerencias_catalogo (user_id) where user_id is not null;

comment on table public.sugerencias_catalogo is
  'Buzón: qué tipo de evento o de vacante buscaba alguien y no encontró.';

/* ── RLS ──────────────────────────────────────────────────────────────
   Cada quien ve lo suyo y nada más. No es información sensible, pero una
   sugerencia lleva el texto que escribió una persona identificable y no hay
   razón para que la lea otro usuario. La revisión se hace con la service key
   desde el backend, que se salta la RLS.

   Se escriben políticas de verdad en vez de dejar la tabla con RLS activada y
   sin ninguna, que es la trampa anotada en la deuda técnica: deniega todo y
   el día que haga falta leerla desde el navegador falla sin explicación. */
alter table public.sugerencias_catalogo enable row level security;

drop policy if exists sugerencias_propias_select on public.sugerencias_catalogo;
create policy sugerencias_propias_select on public.sugerencias_catalogo
  for select using (user_id = auth.uid());

drop policy if exists sugerencias_propias_insert on public.sugerencias_catalogo;
create policy sugerencias_propias_insert on public.sugerencias_catalogo
  for insert with check (user_id = auth.uid());
