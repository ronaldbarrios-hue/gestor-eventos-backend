'use strict';

/* Las cuatro cuentas de aforo por zona, en SQL de MySQL.
 *
 * Paso 4 de la fase 6. Hoy son funciones de Postgres que el backend llama por
 * RPC (`aforo_zonas`, `aforo_zonas_resumen`, `aforo_zonas_serie`,
 * `aforo_zonas_estancia`, migración 0079).
 *
 * ── Por qué siguen siendo SQL y no JavaScript ─────────────────────────────
 *
 * Los contadores de `modules/contadores/` se sacaron de la base porque
 * ESCRIBEN y necesitaban control de la transacción. Éstas sólo leen, y la
 * razón por la que se hicieron en la base sigue en pie: el propio comentario
 * de la 0079 lo dice — antes se traían todas las filas al backend y se sumaban
 * en JavaScript, y PostgREST devuelve 1.000 por defecto, así que a partir del
 * movimiento 1.001 el aforo mentía por lo bajo justo en el evento grande.
 *
 * Se agregan en la base. Lo único que cambia es que el SQL vive aquí, donde se
 * lee y se prueba, en vez de dentro de una función que hay que ir a buscar.
 *
 * ── Las tres traducciones que no son mecánicas ────────────────────────────
 *
 *   1. `filter (where …)` → `CASE WHEN`, igual que en las vistas (004).
 *   2. `array_agg(x order by y desc)[1]` no existe. Es «el nombre más
 *      reciente», y en MySQL 8 sale con una función de ventana.
 *   3. `to_timestamp(floor(epoch/n)*n)` para las franjas → `FROM_UNIXTIME`
 *      con `UNIX_TIMESTAMP`. Mismo redondeo, distinta escritura.
 *
 * ── Estado ────────────────────────────────────────────────────────────────
 *
 * No se llama desde ninguna ruta todavía: los datos siguen en Supabase y allí
 * están las RPC. `lib/aforoZonas.js` es quien las consume, y será el único
 * archivo que haya que tocar el día del corte.
 */

const { bd } = require('../../core/db/mysql.js');

/* La clave de una zona es su id; las filas anteriores a la 0079 que no se
   pudieron emparejar caen de vuelta al nombre. Es lo mismo que hace el
   original, y es lo que evita que la misma zona cuente doble. */
const CLAVE = 'COALESCE(mv.zona_id, mv.zona)';

/* ── 1 · Ocupación viva ───────────────────────────────────────────────────
 *
 * Sólo cuenta lo POSTERIOR al último corte de esa zona. «Limpiar el aforo» no
 * borra nada —el reporte del día vive de esos movimientos—: escribe un corte y
 * la cuenta empieza desde ahí.
 *
 * `personas` cuenta boletas distintas y `dentro` suma cantidades: un conteo
 * manual de 30 no tiene boleta, así que suma a `dentro` y no a `personas`. Son
 * dos números distintos a propósito.
 */
async function ocupacionViva(eventoId) {
  return bd('datos').consultar(`
    WITH m AS (
      SELECT ${CLAVE} AS clave, mv.zona AS nombre, mv.tipo, mv.ticket_id,
             COALESCE(mv.cantidad, 1) AS cantidad, mv.created_at
        FROM ticket_movimientos mv
       WHERE mv.evento_id = ?
         AND (mv.zona_id IS NOT NULL OR mv.zona IS NOT NULL)
    ),
    c AS (
      -- Sólo 'reset' cuenta como corte de la ocupación viva (migración 0087):
      -- un reporte manual o automático también escribe en zona_cortes, para
      -- el histórico, y no debe poner el contador en cero.
      SELECT COALESCE(zc.zona_id, zc.zona) AS clave, MAX(zc.created_at) AS corte_at
        FROM zona_cortes zc
       WHERE zc.evento_id = ?
         AND zc.tipo = 'reset'
       GROUP BY 1
    ),
    /* El nombre más reciente de cada zona. En Postgres era
       array_agg(nombre ORDER BY created_at DESC)[1]. */
    n AS (
      SELECT clave, nombre FROM (
        SELECT clave, nombre,
               ROW_NUMBER() OVER (PARTITION BY clave ORDER BY created_at DESC) AS rn
          FROM m
      ) x WHERE rn = 1
    )
    SELECT m.clave,
           n.nombre AS zona,
           COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.cantidad ELSE 0 END), 0) AS entradas,
           COALESCE(SUM(CASE WHEN m.tipo = 'salida'  THEN m.cantidad ELSE 0 END), 0) AS salidas,
           COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.cantidad ELSE -m.cantidad END), 0) AS dentro,
           COUNT(DISTINCT CASE WHEN m.tipo = 'entrada' THEN m.ticket_id END) AS personas,
           MAX(m.created_at) AS ultima_at,
           MAX(c.corte_at)   AS corte_at
      FROM m
      LEFT JOIN c ON c.clave = m.clave
      LEFT JOIN n ON n.clave = m.clave
     WHERE c.corte_at IS NULL OR m.created_at > c.corte_at
     GROUP BY m.clave, n.nombre
  `, [eventoId, eventoId]);
}

/* ── 2 · Totales del día, corte incluido ──────────────────────────────────
 *
 * Lo que pide un reporte: aquí NO se descuenta el corte, porque el corte es
 * una decisión de operación y el reporte quiere el día entero.
 */
async function resumen(eventoId) {
  return bd('datos').consultar(`
    WITH n AS (
      SELECT clave, nombre FROM (
        SELECT COALESCE(mv.zona_id, mv.zona) AS clave, mv.zona AS nombre,
               ROW_NUMBER() OVER (PARTITION BY COALESCE(mv.zona_id, mv.zona) ORDER BY mv.created_at DESC) AS rn
          FROM ticket_movimientos mv
         WHERE mv.evento_id = ? AND (mv.zona_id IS NOT NULL OR mv.zona IS NOT NULL)
      ) x WHERE rn = 1
    )
    SELECT ${CLAVE} AS clave,
           n.nombre AS zona,
           COALESCE(SUM(CASE WHEN mv.tipo = 'entrada' THEN COALESCE(mv.cantidad,1) ELSE 0 END), 0) AS entradas,
           COALESCE(SUM(CASE WHEN mv.tipo = 'salida'  THEN COALESCE(mv.cantidad,1) ELSE 0 END), 0) AS salidas,
           COUNT(DISTINCT CASE WHEN mv.tipo = 'entrada' THEN mv.ticket_id END) AS personas,
           COALESCE(SUM(CASE WHEN mv.origen = 'manual' THEN COALESCE(mv.cantidad,1) ELSE 0 END), 0) AS manuales,
           MIN(mv.created_at) AS primera_at,
           MAX(mv.created_at) AS ultima_at
      FROM ticket_movimientos mv
      LEFT JOIN n ON n.clave = COALESCE(mv.zona_id, mv.zona)
     WHERE mv.evento_id = ?
       AND (mv.zona_id IS NOT NULL OR mv.zona IS NOT NULL)
     GROUP BY 1, n.nombre
  `, [eventoId, eventoId]);
}

/* ── 3 · La curva del día ─────────────────────────────────────────────────
 *
 * Entradas y salidas por franjas de N minutos. Con esto se dibuja la curva y
 * se saca el pico de ocupación acumulando en orden.
 *
 * `GREATEST(minutos, 1)` porque una franja de 0 minutos sería una división por
 * cero, y el parámetro viene de fuera.
 */
async function serie(eventoId, minutos = 15) {
  const m = Math.max(1, Math.min(Number(minutos) || 15, 1440));
  return bd('datos').consultar(`
    SELECT ${CLAVE} AS clave,
           FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(mv.created_at) / (? * 60)) * (? * 60)) AS bucket,
           COALESCE(SUM(CASE WHEN mv.tipo = 'entrada' THEN COALESCE(mv.cantidad,1) ELSE 0 END), 0) AS entradas,
           COALESCE(SUM(CASE WHEN mv.tipo = 'salida'  THEN COALESCE(mv.cantidad,1) ELSE 0 END), 0) AS salidas
      FROM ticket_movimientos mv
     WHERE mv.evento_id = ?
       AND (mv.zona_id IS NOT NULL OR mv.zona IS NOT NULL)
     GROUP BY 1, 2
     ORDER BY 2
  `, [m, m, eventoId]);
}

/* ── 4 · Cuánto se queda la gente ─────────────────────────────────────────
 *
 * Empareja cada entrada con la salida SIGUIENTE de la misma boleta en la misma
 * zona. `LEAD` funciona igual en MySQL 8 que en Postgres.
 *
 * Los conteos manuales no tienen boleta, así que no cuentan aquí — y por eso
 * se devuelve también `tramos`: sin ese número, «media de 40 minutos» no dice
 * si se midió sobre 500 personas o sobre 3. Estaba en el original a propósito
 * y se conserva.
 */
async function estancia(eventoId) {
  return bd('datos').consultar(`
    WITH pares AS (
      SELECT ${CLAVE} AS clave, mv.tipo, mv.created_at,
             LEAD(mv.tipo)       OVER (PARTITION BY mv.ticket_id, ${CLAVE} ORDER BY mv.created_at) AS sig_tipo,
             LEAD(mv.created_at) OVER (PARTITION BY mv.ticket_id, ${CLAVE} ORDER BY mv.created_at) AS sig_at
        FROM ticket_movimientos mv
       WHERE mv.evento_id = ?
         AND mv.ticket_id IS NOT NULL
         AND (mv.zona_id IS NOT NULL OR mv.zona IS NOT NULL)
    )
    SELECT clave,
           ROUND(AVG(TIMESTAMPDIFF(SECOND, created_at, sig_at)) / 60, 1) AS minutos_prom,
           ROUND(MAX(TIMESTAMPDIFF(SECOND, created_at, sig_at)) / 60, 1) AS minutos_max,
           COUNT(*) AS tramos
      FROM pares
     WHERE tipo = 'entrada' AND sig_tipo = 'salida'
     GROUP BY clave
  `, [eventoId]);
}

module.exports = { ocupacionViva, resumen, serie, estancia, CLAVE };
