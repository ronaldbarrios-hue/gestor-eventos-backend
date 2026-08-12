-- 0062 · #48 · Torneos por categorías anidadas.
--
-- Hasta ahora la clasificación de un torneo era `torneos.disciplina`: una
-- etiqueta de texto libre. Con tres torneos vale; con treinta —una convención
-- con deportes, juegos de mesa y gaming a la vez— deja de servir, porque no
-- hay forma de agrupar "contacto", "pesca" y "caminata" bajo "deportes" ni de
-- navegar de lo general a lo concreto.
--
-- Lo que pidió el equipo: Torneos → deportes / juegos de mesa / gaming →
-- contacto, pesca, caminata… → los torneos concretos, "con tantos niveles
-- como haga falta". Eso es un árbol, no una lista.
--
-- Decisiones:
--
--   · El árbol es POR EVENTO (`evento_id`). Una taxonomía global obligaría a
--     ponerse de acuerdo entre organizadores que no se conocen, y cada evento
--     nombra sus cosas a su manera. El precio es que quien organice lo mismo
--     cada mes reconstruye el árbol; se compensa con "duplicar evento", que ya
--     copia la configuración.
--   · `padre_id` apunta a la misma tabla: un nivel o diez, da igual.
--     `on delete cascade` sobre el padre — borrar "deportes" se lleva sus
--     hijos, que es lo que espera quien lo borra.
--   · `torneos.categoria_id` es NULL-able y `on delete set null`: un torneo
--     sin clasificar sigue existiendo y sigue apareciendo, sólo que suelto.
--     Ningún torneo puede desaparecer por tocar el árbol.
--   · `disciplina` NO se toca. Sigue siendo la etiqueta corta que se pinta al
--     lado del nombre ("Smash Bros", "Boxeo") y no significa lo mismo que la
--     rama del árbol. Quitarla sería una migración destructiva a cambio de
--     nada.

create table if not exists public.torneo_categorias (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.eventos(id) on delete cascade,
  padre_id   uuid references public.torneo_categorias(id) on delete cascade,
  nombre     text not null,
  orden      integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists torneo_categorias_evento_idx
  on public.torneo_categorias (evento_id, orden);
create index if not exists torneo_categorias_padre_idx
  on public.torneo_categorias (padre_id) where padre_id is not null;

/* Dos hermanas no pueden llamarse igual: "deportes › contacto" y
   "deportes › contacto" serían indistinguibles en el selector. Bajo padres
   distintos sí se repite —"gaming › fútbol" y "deportes › fútbol" son cosas
   distintas—, y por eso el único va sobre (evento, padre, nombre).

   `padre_id` nulo en las raíces obligaría a un índice aparte: en Postgres,
   NULL nunca es igual a NULL y un unique normal dejaría crear dos raíces con
   el mismo nombre. Se resuelve con dos índices parciales. */
create unique index if not exists torneo_categorias_unica_hija
  on public.torneo_categorias (evento_id, padre_id, lower(nombre))
  where padre_id is not null;
create unique index if not exists torneo_categorias_unica_raiz
  on public.torneo_categorias (evento_id, lower(nombre))
  where padre_id is null;

alter table public.torneos
  add column if not exists categoria_id uuid references public.torneo_categorias(id) on delete set null;

create index if not exists torneos_categoria_idx
  on public.torneos (categoria_id) where categoria_id is not null;

comment on table public.torneo_categorias is
  'Árbol de categorías de torneos, por evento. padre_id nulo = raíz. Profundidad libre.';
comment on column public.torneos.categoria_id is
  'Rama del árbol donde cuelga el torneo. NULL = sin clasificar, se muestra suelto.';

/* ── RLS ──────────────────────────────────────────────────────────────
   El árbol se lee desde la página pública del evento, así que necesita
   política de lectura de verdad y no quedarse como las catorce tablas con
   RLS activada y ninguna política. Escribir, sólo el dueño del evento; el
   backend entra con la service key y se salta esto igualmente. */
alter table public.torneo_categorias enable row level security;

drop policy if exists torneo_categorias_select on public.torneo_categorias;
create policy torneo_categorias_select on public.torneo_categorias
  for select using (
    exists (
      select 1 from public.eventos e
      where e.id = torneo_categorias.evento_id
        and e.deleted_at is null
        and (e.estado = 'publicado' or e.owner_id = auth.uid())
    )
  );

drop policy if exists torneo_categorias_write_owner on public.torneo_categorias;
create policy torneo_categorias_write_owner on public.torneo_categorias
  for all using (
    exists (select 1 from public.eventos e
            where e.id = torneo_categorias.evento_id and e.owner_id = auth.uid())
  );
