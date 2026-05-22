/* GESTEK — Gamificación.
   Las tablas points_log / user_badges / missions ya existen (0001_init.sql).
   Esto agrega:
   - profiles.puntos_total : cache del total (para ranking sin agregaciones caras)
   - Backfill del cache desde points_log
   - RLS extra para que el ranking sea legible por usuarios autenticados
*/

alter table public.profiles
  add column if not exists puntos_total integer not null default 0;

/* Backfill: suma histórica de points_log a la cache */
update public.profiles p
set puntos_total = coalesce((
  select sum(pl.puntos) from public.points_log pl where pl.user_id = p.id
), 0);

create index if not exists profiles_puntos_idx
  on public.profiles (puntos_total desc) where puntos_total > 0;

/* Ranking: cualquier usuario autenticado puede leer nombre+avatar+puntos
   de los demás (solo esas columnas, vía la policy de abajo no — RLS es a nivel
   fila, no columna). Para no exponer todo el profile, el backend usa
   service_role y selecciona solo columnas públicas. Dejamos la policy
   existente intacta; el ranking se sirve desde el backend. */

/* user_badges: permitir que el dueño vea las suyas ya está en 0001.
   Agregamos índice para el conteo por usuario. */
create index if not exists user_badges_user_idx
  on public.user_badges (user_id);
