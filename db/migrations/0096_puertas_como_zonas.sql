-- 0096 · Las puertas pasan a ser zonas de tipo ingreso. (Frente Q · Q6, paso de datos)
--
-- Va DESPUÉS de la 0094 (que creó `zonas.tipo`) y de la 0092 (que dejó la tabla
-- `zonas` como única fuente). Las dos están aplicadas.
--
-- ── Qué se movió, medido antes ───────────────────────────────────────────
--
-- Una sola puerta en toda la base: «entrada inicial» (`acc_1bt62w4`), en
-- TechNova. FESTECH no tiene ninguna. Así que esto no es una migración masiva:
-- es abrir el camino con el único dato real que hay para comprobarlo.
--
-- ── El id se conserva, y ésa es la decisión que importa ──────────────────
--
-- La zona nace con el MISMO id que tenía la puerta (`acc_…`). `zonas.id` es
-- `text` justamente porque los ids de este modelo nunca fueron uuid, así que
-- cabe tal cual. Y con eso:
--
--   · los marcadores del plano (`page_json.mapa.marcadores`, tipo `acceso`,
--     con su `acceso_id`) siguen apuntando a algo que existe;
--   · los movimientos que se registraron con `zona_id = acc_…` dejan de ser
--     huérfanos;
--   · y `page_json.accesos` puede seguir intacto, que es lo que hace que esto
--     sea reversible: hoy nadie deja de leer de donde leía.
--
-- Cambiar el id habría obligado a reescribir las tres cosas a la vez, y
-- cualquiera de las tres que fallara se vería como un plano con un marcador
-- muerto.
--
-- ── Lo que este paso NO hace ─────────────────────────────────────────────
--
-- **No borra `page_json.accesos`.** Ahí siguen viviendo las reglas de la
-- puerta —qué tipos de boleta admite y qué staff la atiende— y ahí las lee el
-- control de ingreso (`routes/clientes.js`). Esta migración mueve **el sitio**,
-- no las reglas. Mientras las dos existan, el código las mantiene de acuerdo
-- (`sincronizarPuertas`), y el día que las reglas se muden también, el JSON se
-- podrá quitar como se quitó el de las zonas.
--
-- **Y una puerta no cuenta aforo.** `ocupacion()` deja fuera las zonas de tipo
-- ingreso: por una puerta se pasa, no se está. Sin eso, el tablero en vivo
-- diría que hay cuarenta personas «dentro de la entrada inicial».
--
-- ── Los cuatro movimientos huérfanos, que siguen huérfanos ───────────────
--
-- `ticket_movimientos` tiene 4 filas con `zona_id = 'acc_0uzjsj9'`: una puerta
-- que alguien borró del plano. No las adopta nadie, porque esa puerta ya no
-- existe en ninguna parte y **no hay dato del que reconstruir su nombre**. Se
-- dejan como están: borrarlas escondería que el 1 de septiembre entraron cuatro
-- personas por algún sitio. Esa tabla, además, no tiene clave foránea a `zonas`
-- —por eso pudieron quedarse—, y ponerla ahora exigiría decidir qué hacer con
-- ellas. No es la decisión de esta migración.

insert into public.zonas (id, evento_id, nombre, aforo_max, tipo, orden)
select
  a->>'id',
  e.id,
  nullif(trim(a->>'nombre'), ''),
  null,                      -- una puerta no declara aforo: no se llena, se cruza
  'ingreso',
  1000 + (ord - 1)           -- al final de la lista, en el orden en que estaban
from public.eventos e
cross join lateral jsonb_array_elements(e.page_json->'accesos') with ordinality as t(a, ord)
where e.page_json ? 'accesos'
  and nullif(a->>'id', '') is not null
  and nullif(trim(a->>'nombre'), '') is not null
on conflict (id) do nothing;   -- idempotente: correrla dos veces no duplica

-- ── Comprobación ─────────────────────────────────────────────────────────
--
--   select id, nombre, tipo from public.zonas where tipo = 'ingreso';
--
-- Tiene que salir «entrada inicial».
--
-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   delete from public.zonas where tipo = 'ingreso';
--
-- Sin pérdida: la puerta sigue entera en `page_json.accesos`, que es de donde
-- salió y donde el control de ingreso la sigue leyendo.
