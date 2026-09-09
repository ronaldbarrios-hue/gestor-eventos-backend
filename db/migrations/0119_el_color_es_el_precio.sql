-- 0119 · El color es el precio
--
-- En el mapa de un concierto el color no decora: ES el precio. «La roja son 450
-- mil, la azul 180» es media decisión de compra, y hoy el plano de GESTEK sólo
-- distingue libre / ocupada / la mía — o sea, no dice lo único que importa
-- antes de elegir.
--
-- ── Por qué el color va en el tipo de boleta ───────────────────────────
--
-- Y no en la silla. Una localidad es un tipo de boleta aplicado a un conjunto
-- de espacios (`ticket_type_espacios`, 0117), así que cambiar el color de
-- «Platea» tiene que repintar sus dos mil sillas de una vez. Guardarlo en cada
-- silla sería copiar el mismo dato dos mil veces, y bastaría con que una se
-- quedara sin actualizar para que el plano mintiera sobre un precio.
--
-- ── Y por qué NO hace falta migración para las formas ──────────────────
--
-- Los bloques del primer nivel del mapa —«122», «GENERAL B», la tarima— y las
-- filas curvas de un teatro se guardan en `espacios.geometria`, que ya es
-- `jsonb` desde la 0117. Un polígono es `{ puntos: [[x,y], …] }` y una silla
-- girada es `{ x, y, rot }`: caben sin tocar el esquema.

alter table public.ticket_types
  add column if not exists color text;

-- Sólo `#rrggbb`. Es lo que entiende el SVG y lo que se puede guardar sin
-- sorpresas; un `red` o un `rgb(…)` viajarían bien y romperían el día que
-- alguien los compare, los ordene o los pinte en un PDF.
--
-- `null` es válido y es lo que tienen todos los tipos de hoy: sin color
-- elegido, la aplicación reparte uno de su paleta por posición. Así nada de lo
-- que existe cambia de aspecto hasta que alguien decida un color.
do $$
begin
  alter table public.ticket_types
    add constraint ticket_types_color_hex
    check (color is null or color ~* '^#[0-9a-f]{6}$');
exception
  when duplicate_object then null;
end $$;

-- ── Comprobación ───────────────────────────────────────────────────────
--
--   select column_name from information_schema.columns
--    where table_name='ticket_types' and column_name='color';
--
--   -- Y que la regla del color muerde:
--   -- esto tiene que FALLAR:
--   -- update public.ticket_types set color='rojo' where id = (select id from public.ticket_types limit 1);
--   -- y esto pasar:
--   -- update public.ticket_types set color='#dc2626' where id = (select id from public.ticket_types limit 1);
--
-- ── Vuelta atrás ───────────────────────────────────────────────────────
--
--   alter table public.ticket_types drop constraint if exists ticket_types_color_hex;
--   alter table public.ticket_types drop column if exists color;
--
-- Sin riesgo: una columna que nace nula. Ninguna boleta ni ningún plano
-- cambian de comportamiento hasta que alguien elija un color.
