'use strict';

/* Cuándo pasó de verdad un escaneo que llega tarde.
 *
 * ── Por qué el cliente manda la hora ─────────────────────────────────────
 *
 * En la puerta se escanea sin internet: los escaneos se guardan en el teléfono
 * y se mandan al reconectar, que pueden ser veinte minutos después. Si el
 * servidor sellara la hora de llegada, todos los ingresos de ese corte
 * aparecerían apelotonados en el minuto en que volvió el wifi — y con eso el
 * informe de puerta deja de servir para lo que existe: saber a qué hora entró
 * la gente y cuánta había dentro en cada momento.
 *
 * ── Por qué se valida, si viene del propio panel ─────────────────────────
 *
 * Porque es una hora que decide un teléfono, y un teléfono puede tener el
 * reloj mal puesto —o a alguien tocándolo—. Sin límites, un `at` en 2019
 * ensuciaría el histórico y uno en 2030 dejaría un ingreso que nunca vence.
 *
 * Los márgenes son deliberados: un minuto hacia delante absorbe la diferencia
 * normal entre el reloj del teléfono y el del servidor; treinta días hacia
 * atrás cubre de sobra cualquier corte de red de un evento y descarta el resto.
 *
 * Ante la duda, la hora del servidor: llegar tarde con la hora de ahora es un
 * dato impreciso, pero aceptar cualquier fecha es un dato falso.
 *
 * Vive aquí y no dentro de una ruta porque lo usan el control de ingreso y la
 * puerta de los sub-eventos, y dos copias de una validación de fechas acaban
 * separándose.
 */

const MINUTO = 60 * 1000;
const TREINTA_DIAS = 30 * 24 * 3600 * 1000;

function horaDelEscaneo(at, ahora = Date.now()) {
  if (typeof at === 'string') {
    const t = new Date(at).getTime();
    if (Number.isFinite(t) && t <= ahora + MINUTO && t > ahora - TREINTA_DIAS) {
      return new Date(t).toISOString();
    }
  }
  return new Date(ahora).toISOString();
}

module.exports = { horaDelEscaneo };
