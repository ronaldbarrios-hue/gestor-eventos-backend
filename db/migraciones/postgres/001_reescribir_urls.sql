-- 001_reescribir_urls.sql — cambiar el host de Supabase por el nuestro en las
-- 13 columnas donde la URL está guardada dentro de la fila.
--
-- ⚠ Esto corre contra POSTGRES (Supabase), no contra MySQL. Va aparte por eso.
--
-- ── Antes de correrlo, tres cosas ─────────────────────────────────────────
--
-- 1. Los archivos ya están copiados (`scripts/copiar-storage.js --aplicar`) y
--    las URLs NUEVAS responden. Si no, cada portada reescrita es un hueco en
--    una página pública.
-- 2. Las URLs VIEJAS siguen respondiendo. Las dos copias en paralelo durante
--    toda la ventana: esto se deshace, pero no instantáneamente.
-- 3. Hay copia de seguridad de la base. La transacción protege de un fallo a
--    mitad, no de haber puesto mal el host.
--
-- ── Cómo se usa ──────────────────────────────────────────────────────────
--
-- Sustituir NUEVO_HOST abajo y pegar todo esto en el editor SQL de Supabase.
-- Termina en ROLLBACK a propósito: la primera pasada enseña los conteos sin
-- cambiar nada. Cuando los números cuadren, se cambia ROLLBACK por COMMIT.
--
-- **Entero y de una vez.** No por trozos, y no con una herramienta que mande
-- cada sentencia por separado: si el BEGIN y el ROLLBACK caen en transacciones
-- distintas, los UPDATE se confirman y el ROLLBACK avisa de que no había nada
-- que deshacer. Es el único modo de que esta primera pasada «que no toca nada»
-- toque producción.
--
-- Los conteos de control se volvieron a medir el 29 de agosto y no han
-- cambiado: 16, 13, 5, 5, 4, 4, 3, 2, 1, 1, 1, 1, 1 — 57 filas.
--
-- ── La condición que no se puede saltar ──────────────────────────────────
--
-- Cinco de las trece columnas son JSON (`gallery`, `page_json`, `paginas`,
-- `branding`, `tickets.respuestas`). Se reescriben pasando por texto y
-- volviendo, y eso funciona porque la sustitución no cambia la estructura del
-- JSON ni introduce comillas. **El host nuevo no puede llevar caracteres que
-- haya que escapar en JSON.** Un host normal no los lleva; uno con una comilla
-- o una barra invertida rompería las cinco columnas a la vez.

BEGIN;

-- El prefijo viejo y el nuevo, en un solo sitio.
CREATE TEMP TABLE _sust (viejo text, nuevo text) ON COMMIT DROP;
INSERT INTO _sust VALUES (
  'https://yopontbwgdybfsniqawz.supabase.co/storage/v1/object/public/',
  'https://NUEVO_HOST/archivos/'
);

-- Comprobación de seguridad: si el host nuevo lleva algo que hay que escapar
-- en JSON, se para aquí y no se toca nada.
DO $$
DECLARE n text;
BEGIN
  SELECT nuevo INTO n FROM _sust;
  -- Comillas, barra invertida o espacios en blanco. Los guiones y los puntos
  -- de un host normal no dan problema y no se rechazan.
  IF n ~ '["\\]' OR n ~ '\s' THEN
    RAISE EXCEPTION 'El host nuevo lleva caracteres que hay que escapar en JSON: %', n;
  END IF;
  IF n LIKE '%NUEVO_HOST%' THEN
    RAISE EXCEPTION 'Falta sustituir NUEVO_HOST.';
  END IF;
END $$;

-- Para poder comparar al final contra los conteos medidos.
CREATE TEMP TABLE _hechas (tabla text, columna text, filas bigint, esperadas bigint) ON COMMIT DROP;

-- ── Las ocho de texto ─────────────────────────────────────────────────────

WITH s AS (SELECT * FROM _sust), u AS (
  UPDATE eventos SET cover_url = replace(cover_url, (SELECT viejo FROM s), (SELECT nuevo FROM s))
   WHERE cover_url LIKE '%/storage/v1/object/public/%' RETURNING 1)
INSERT INTO _hechas SELECT 'eventos', 'cover_url', count(*), 16 FROM u;

WITH s AS (SELECT * FROM _sust), u AS (
  UPDATE torneo_equipos SET foto_url = replace(foto_url, (SELECT viejo FROM s), (SELECT nuevo FROM s))
   WHERE foto_url LIKE '%/storage/v1/object/public/%' RETURNING 1)
INSERT INTO _hechas SELECT 'torneo_equipos', 'foto_url', count(*), 13 FROM u;

WITH s AS (SELECT * FROM _sust), u AS (
  UPDATE profiles SET empresa_logo_url = replace(empresa_logo_url, (SELECT viejo FROM s), (SELECT nuevo FROM s))
   WHERE empresa_logo_url LIKE '%/storage/v1/object/public/%' RETURNING 1)
INSERT INTO _hechas SELECT 'profiles', 'empresa_logo_url', count(*), 4 FROM u;

WITH s AS (SELECT * FROM _sust), u AS (
  UPDATE profiles SET avatar_url = replace(avatar_url, (SELECT viejo FROM s), (SELECT nuevo FROM s))
   WHERE avatar_url LIKE '%/storage/v1/object/public/%' RETURNING 1)
INSERT INTO _hechas SELECT 'profiles', 'avatar_url', count(*), 3 FROM u;

WITH s AS (SELECT * FROM _sust), u AS (
  UPDATE chat_messages SET file_url = replace(file_url, (SELECT viejo FROM s), (SELECT nuevo FROM s))
   WHERE file_url LIKE '%/storage/v1/object/public/%' RETURNING 1)
INSERT INTO _hechas SELECT 'chat_messages', 'file_url', count(*), 2 FROM u;

WITH s AS (SELECT * FROM _sust), u AS (
  UPDATE eventos SET pago_qr_url = replace(pago_qr_url, (SELECT viejo FROM s), (SELECT nuevo FROM s))
   WHERE pago_qr_url LIKE '%/storage/v1/object/public/%' RETURNING 1)
INSERT INTO _hechas SELECT 'eventos', 'pago_qr_url', count(*), 1 FROM u;

WITH s AS (SELECT * FROM _sust), u AS (
  UPDATE speakers SET foto_url = replace(foto_url, (SELECT viejo FROM s), (SELECT nuevo FROM s))
   WHERE foto_url LIKE '%/storage/v1/object/public/%' RETURNING 1)
INSERT INTO _hechas SELECT 'speakers', 'foto_url', count(*), 1 FROM u;

WITH s AS (SELECT * FROM _sust), u AS (
  UPDATE networking_expositores SET logo_url = replace(logo_url, (SELECT viejo FROM s), (SELECT nuevo FROM s))
   WHERE logo_url LIKE '%/storage/v1/object/public/%' RETURNING 1)
INSERT INTO _hechas SELECT 'networking_expositores', 'logo_url', count(*), 1 FROM u;

-- ── Las cinco de JSON ─────────────────────────────────────────────────────
-- Por texto y de vuelta. La URL puede estar a cualquier profundidad —`page_json`
-- es el constructor de páginas y la imagen puede vivir en cualquier bloque—, así
-- que no hay forma de llegar a ella por clave.

WITH s AS (SELECT * FROM _sust), u AS (
  UPDATE eventos SET gallery = replace(gallery::text, (SELECT viejo FROM s), (SELECT nuevo FROM s))::jsonb
   WHERE gallery::text LIKE '%/storage/v1/object/public/%' RETURNING 1)
INSERT INTO _hechas SELECT 'eventos', 'gallery', count(*), 5 FROM u;

WITH s AS (SELECT * FROM _sust), u AS (
  UPDATE tickets SET respuestas = replace(respuestas::text, (SELECT viejo FROM s), (SELECT nuevo FROM s))::jsonb
   WHERE respuestas::text LIKE '%/storage/v1/object/public/%' RETURNING 1)
INSERT INTO _hechas SELECT 'tickets', 'respuestas', count(*), 5 FROM u;

WITH s AS (SELECT * FROM _sust), u AS (
  UPDATE eventos SET page_json = replace(page_json::text, (SELECT viejo FROM s), (SELECT nuevo FROM s))::jsonb
   WHERE page_json::text LIKE '%/storage/v1/object/public/%' RETURNING 1)
INSERT INTO _hechas SELECT 'eventos', 'page_json', count(*), 4 FROM u;

WITH s AS (SELECT * FROM _sust), u AS (
  UPDATE eventos SET paginas = replace(paginas::text, (SELECT viejo FROM s), (SELECT nuevo FROM s))::jsonb
   WHERE paginas::text LIKE '%/storage/v1/object/public/%' RETURNING 1)
INSERT INTO _hechas SELECT 'eventos', 'paginas', count(*), 1 FROM u;

WITH s AS (SELECT * FROM _sust), u AS (
  UPDATE eventos SET branding = replace(branding::text, (SELECT viejo FROM s), (SELECT nuevo FROM s))::jsonb
   WHERE branding::text LIKE '%/storage/v1/object/public/%' RETURNING 1)
INSERT INTO _hechas SELECT 'eventos', 'branding', count(*), 1 FROM u;

-- ── El control ────────────────────────────────────────────────────────────
-- Los esperados son los medidos el 28 de agosto (SUPABASE.md §3.3). Si no
-- cuadran, PARAR: o alguien subió cosas desde entonces —y hay que volver a
-- medir— o hay filas que esta reescritura no está alcanzando.

SELECT tabla, columna, filas, esperadas,
       CASE WHEN filas = esperadas THEN 'ok' ELSE '⚠ NO CUADRA' END AS control
  FROM _hechas
 ORDER BY esperadas DESC, tabla, columna;

SELECT sum(filas) AS total_reescrito, sum(esperadas) AS total_esperado FROM _hechas;

-- Que nadie se quede atrás: después de esto, ninguna columna debería seguir
-- llevando el host viejo.
SELECT count(*) AS quedan_en_eventos FROM eventos
 WHERE cover_url LIKE '%/storage/v1/object/public/%'
    OR page_json::text LIKE '%/storage/v1/object/public/%'
    OR gallery::text LIKE '%/storage/v1/object/public/%';

-- Primera pasada: ROLLBACK. Cuando los conteos cuadren, cambiar por COMMIT.
ROLLBACK;
