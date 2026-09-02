-- 0083 · La escarapela impresa y la tarjeta digital dejan de ser dos diseños.
-- APLICADA el 2026-09-02. Comprobado antes y después contra producción:
--
--   antes:   33 eventos · 1 con `credenciales` · 0 con `wallet`
--   tocó:    1 fila (la que el WHERE selecciona)
--   después: 1 con `wallet.variantes` · 1 conserva `credenciales` · 0 pendientes
--
-- Se pudo aplicar sin miedo porque no destruye nada: **no borra
-- `credenciales`**, así que volver atrás es quitar la clave `wallet` y ya. Eso
-- y el `WHERE` —que la hace idempotente— eran las dos condiciones.
--
-- Y no era urgente, que es por lo que espero tanto: `walletVariantes()`
-- (frontend, `src/lib/wallet.js:127`) siempre devuelve al menos una variante, y
-- si no hay `wallet` pero sí `credenciales` lo traduce en caliente. El fallback
-- del código estaba haciendo el trabajo de esta migración. Lo que se gana es
-- dejar el dato en su forma nueva en vez de traducirlo en cada render.
--
-- Idempotente: se puede correr dos veces.
--
-- ── El problema ───────────────────────────────────────────────────────────
--
-- Son la misma escarapela: mismo `qr_token`, mismo portador, misma función —
-- entrar, sumar puntos, canjear—. Lo único separado era el DISEÑO, en dos
-- claves distintas del mismo `page_json`:
--
--   page_json.credenciales → papel   (tamaño, campos del formulario, borde)
--   page_json.wallet       → pantalla (estilo, colores, puntos)
--
-- Con dos editores y dos almacenes, el organizador la diseñaba dos veces y, si
-- cambiaba el logo en una, la otra se quedaba como estaba. Es el mismo patrón
-- que la foto/teléfono/ciudad de la 0081: un dato en dos sitios que no se
-- hablan siempre acaba discrepando.
--
-- ── Qué hace ──────────────────────────────────────────────────────────────
--
-- Convierte `credenciales` en la primera variante de `wallet`. `wallet` gana
-- porque ya sabía algo que `credenciales` no: variantes por público y por tipo
-- de boleta. Así la escarapela impresa de un VIP sale de la misma variante que
-- su tarjeta digital, en vez de ser un diseño plano para todos.
--
-- El `mostrar` anidado pasa a claves planas (`mostrar_qr`, `mostrar_logo`…),
-- que es lo que permite que un solo editor toque las dos salidas.
--
-- ── Medido antes de escribirla ────────────────────────────────────────────
--
-- 33 eventos: 1 con `credenciales`, 0 con `wallet`, 0 con ambos. Así que esto
-- toca UNA fila y no puede pisar ningún `wallet` existente. La condición del
-- WHERE lo garantiza igualmente, por si alguien diseña una tarjeta entre que
-- esto se escribe y se aplica.
--
-- No borra `credenciales`. El código ya no lo lee —lee la variante— pero
-- dejarlo cuesta nada y es la red por si hubiera que volver atrás. Se quita
-- en otra migración, cuando esto lleve tiempo funcionando.

begin;

update public.eventos
   set page_json = jsonb_set(
     page_json,
     '{wallet}',
     jsonb_build_object('variantes', jsonb_build_array(
       jsonb_strip_nulls(
         jsonb_build_object(
           'id',      'principal',
           'nombre',  'Asistentes',
           'publico', 'asistentes',
           'tipos',   '[]'::jsonb,
           /* Lo de papel, tal cual estaba. */
           'tamano',              coalesce(page_json->'credenciales'->>'tamano', '9x5'),
           'campos_extra',        coalesce(page_json->'credenciales'->'campos_extra',  '[]'::jsonb),
           'campos_libres',       coalesce(page_json->'credenciales'->'campos_libres', '[]'::jsonb),
           'colores',             coalesce(page_json->'credenciales'->'colores',       '{}'::jsonb),
           'fondo',               coalesce(page_json->'credenciales'->>'fondo',        '#FFFFFF'),
           'texto',               coalesce(page_json->'credenciales'->>'texto',        '#0F172A'),
           'banda_texto',         coalesce(page_json->'credenciales'->>'banda_texto',  '#FFFFFF'),
           'marca_agua_url',      coalesce(page_json->'credenciales'->>'marca_agua_url', ''),
           'marca_agua_opacidad', coalesce((page_json->'credenciales'->>'marca_agua_opacidad')::int, 12),
           'borde',               coalesce((page_json->'credenciales'->>'borde')::boolean, true),
           /* El logo es de la identidad, no del medio: lo comparten las dos. */
           'logo',                coalesce(page_json->'credenciales'->>'logo_url', ''),
           /* `mostrar` anidado → claves planas. */
           'mostrar_qr',     coalesce((page_json->'credenciales'->'mostrar'->>'qr')::boolean,     true),
           'mostrar_logo',   coalesce((page_json->'credenciales'->'mostrar'->>'logo')::boolean,   true),
           'mostrar_tipo',   coalesce((page_json->'credenciales'->'mostrar'->>'tipo')::boolean,   true),
           'mostrar_nombre', coalesce((page_json->'credenciales'->'mostrar'->>'nombre')::boolean, true),
           'mostrar_codigo', coalesce((page_json->'credenciales'->'mostrar'->>'codigo')::boolean, false)
         )
       )
     )),
     true
   )
 where page_json ? 'credenciales'
   and not (page_json ? 'wallet');

commit;

-- ── Si esto no se aplica ──────────────────────────────────────────────────
--
-- No pasa nada. `walletVariantes()` en el frontend lee `credenciales` como
-- variante al vuelo cuando no hay `wallet`, así que la escarapela se sigue
-- viendo igual. Esta migración sólo deja escrito lo que el código ya deduce,
-- para que el día que se quite esa lectura de compatibilidad no se pierda
-- ningún diseño. Mientras la plataforma siga sobre Supabase, no corre prisa.
