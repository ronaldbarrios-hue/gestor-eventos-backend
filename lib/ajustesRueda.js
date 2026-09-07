/* GESTEK — Los tres ajustes de la rueda de negocios.
 *
 * Van juntos porque los tres contestan a «cómo se usa esta rueda» y ninguno
 * cabe en una tabla propia: si esta rueda existe, cuántas citas puede tener una
 * misma empresa, y qué franjas están bloqueadas.
 *
 * Todo lo que hay aquí es puro —recibe datos y devuelve datos— para que las
 * pruebas puedan correrlo sin base ni .env. Las consultas viven en la ruta.
 */

'use strict';

/* ── 1 · Si este evento tiene rueda ──────────────────────────────────────
 *
 * Hasta la 0113 esto lo decidía la CATEGORÍA del evento, y la lista estaba
 * escrita dos veces —aquí y en el frontend—. Dos copias de una regla acaban
 * separándose, pero el problema de fondo era otro: la categoría no manda aquí.
 * Una cámara de comercio organiza ruedas de agroindustria, de turismo o de
 * salud; ninguna de esas categorías existe en el catálogo, así que un evento
 * así cae en «Otros» y se quedaba sin rueda. Y al revés: un taller de
 * tecnología no tiene rueda ninguna y la pestaña le salía igual.
 *
 * Ahora lo decide quien organiza (`eventos.networking_activo`). La lista de
 * abajo sobrevive por UNA razón: si el código sube antes que la migración, la
 * columna no existe y hay que seguir contestando lo que se contestaba ayer.
 * Sin esto, el día del despliegue toda rueda existente diría «este evento no
 * tiene rueda» — el modo de fallo de siempre: el valor se mudó, alguien lee
 * donde estaba, y no falla nada; simplemente no hay nada.
 */
const CATEGORIAS_HEREDADAS = ['negocios', 'marketing', 'tecnologia'];

const MENSAJE_APAGADA =
  'Este evento no tiene rueda de negocios. Se activa desde los ajustes del evento.';

/* `evento` es la fila leída; `columnaExiste` dice si la 0113 está aplicada.
   Se pasa aparte porque `undefined` en la fila y `false` en la columna
   significan cosas distintas, y confundirlas es exactamente el error que este
   comentario intenta evitar. */
function ruedaEncendida(evento, { columnaExiste = true } = {}) {
  if (!evento) return false;
  if (!columnaExiste || evento.networking_activo === undefined || evento.networking_activo === null) {
    return CATEGORIAS_HEREDADAS.includes(evento?.categoria?.slug);
  }
  return evento.networking_activo === true;
}

/* ── 2 · Tope de citas por participante ──────────────────────────────────
 *
 * Nada impedía que una empresa acaparase quince citas y dejara a otras sin
 * ninguna. El tope es del EVENTO y no de cada mesa: la regla es la misma para
 * todos o no es una regla.
 *
 * NULL = sin tope, que es como funciona hoy y como sigue funcionando para
 * quien no lo necesite.
 */
const TOPE_MAX = 200;

function topeValido(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > TOPE_MAX) return undefined;   // inválido
  return n;
}

/* Las canceladas NO cuentan. Si contaran, cancelar una cita no devolvería el
   cupo y el tope se convertiría en un contador de intentos: quien se equivoca
   dos veces al elegir la hora se queda sin rueda. */
function cuentaParaElTope(cita) {
  return cita?.estado === 'confirmada' || cita?.estado === 'solicitada';
}

function alcanzoElTope({ citas = [], tope = null, exceptoId = null } = {}) {
  if (!tope) return false;
  const n = citas.filter(c => cuentaParaElTope(c) && c.id !== exceptoId).length;
  return n >= tope;
}

function mensajeDeTope(tope) {
  return tope === 1
    ? 'Esta rueda permite una sola cita por participante.'
    : `Esta rueda permite un máximo de ${tope} citas por participante.`;
}

/* ── 3 · Franjas bloqueadas ──────────────────────────────────────────────
 *
 * «Esta empresa no está de 11 a 12» sólo se podía decir borrando esos
 * horarios. Borrar pierde el porqué y obliga a recrear la franja a mano si la
 * persona vuelve. Marcar es reversible, y en la parrilla se ve como lo que es:
 * una casilla que existe y no se puede pedir.
 */
function estaBloqueado(horario) {
  return horario?.bloqueado === true;
}

function mensajeDeBloqueo(horario) {
  const motivo = (horario?.bloqueo_motivo || '').trim();
  return motivo
    ? `Esa franja no está disponible: ${motivo}.`
    : 'Esa franja no está disponible.';
}

/* El motivo se guarda corto a propósito: sale dentro de una casilla de la
   parrilla, y un párrafo ahí no se lee — se corta. */
const MOTIVO_MAX = 80;

function limpiarMotivo(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim().slice(0, MOTIVO_MAX);
  return s || null;
}

module.exports = {
  CATEGORIAS_HEREDADAS, MENSAJE_APAGADA, ruedaEncendida,
  TOPE_MAX, topeValido, cuentaParaElTope, alcanzoElTope, mensajeDeTope,
  estaBloqueado, mensajeDeBloqueo, MOTIVO_MAX, limpiarMotivo,
};
