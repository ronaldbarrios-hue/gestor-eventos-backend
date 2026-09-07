/* GESTEK — Las boletas que ya se vendieron y todavía no tienen equipo.
 *
 * ── El agujero que tapa ──────────────────────────────────────────────────
 *
 * Un tipo de boleta puede declarar que «crea un equipo» en un torneo. Quien lo
 * hace de verdad es un disparador de la base, `trg_equipo_desde_boleta`, y su
 * definición es la clave de todo esto:
 *
 *     AFTER INSERT OR UPDATE **OF estado** ON tickets
 *
 * O sea: sólo corre cuando la boleta nace o cambia de estado. Y eso deja un
 * hueco por el que se cae medio torneo:
 *
 *   1. El evento todavía no tiene torneo, así que el tipo se crea con «Nada
 *      más» —es lo único que el formulario deja guardar— y se empieza a vender.
 *   2. Días después se crea el torneo y se cambia el tipo a «Un equipo».
 *   3. Las boletas ya pagadas NO entran: su estado ya no va a cambiar, el
 *      disparador no vuelve a correr, y nadie ve un error.
 *
 * Es el modo de fallo de siempre: no falla nada, simplemente esos equipos no
 * existen — y se descubre el día de la competencia, contando sillas.
 *
 * ── Por qué esto no es «volver a disparar el trigger» ────────────────────
 *
 * Se podría tocar `estado` para que el disparador corriera solo. No se hace:
 * `estado` es el dato del que cuelgan el aforo, el cobro y la entrada, y
 * moverlo para provocar un efecto secundario es la clase de atajo que un día
 * marca cien boletas como pagadas. Se inserta el equipo directamente, con las
 * MISMAS reglas que el disparador — que están copiadas abajo a propósito, para
 * que se puedan comparar.
 */

'use strict';

/* Los estados en que una boleta ya cuenta como vendida. Mismo criterio que el
   disparador: sólo `pagado` crea equipo. `emitido` es una cortesía todavía sin
   confirmar y `usado` no aparece antes de que exista el equipo. */
const ESTADOS_CON_EQUIPO = ['pagado'];

/* El nombre de un equipo recién creado. Igual que en el disparador, incluido el
   texto de respaldo: si aquí dijera otra cosa, media lista del torneo se
   llamaría «Equipo por confirmar» y la otra media «Sin nombre», según por dónde
   hubiera entrado cada una. */
const NOMBRE_POR_DEFECTO = 'Equipo por confirmar';

function nombreDeEquipo(ticket) {
  const n = String(ticket?.guest_nombre || '').trim();
  return n || NOMBRE_POR_DEFECTO;
}

/* Qué boletas de este tipo se quedaron sin equipo.
 *
 * `conEquipo` es el conjunto de `ticket_id` que YA tienen uno. Se pasa de fuera
 * porque son dos consultas distintas y esto tiene que poder probarse sin base.
 */
function boletasSinEquipo(tickets = [], conEquipo = new Set()) {
  return tickets.filter(t =>
    ESTADOS_CON_EQUIPO.includes(t?.estado) && !conEquipo.has(t?.id));
}

/* Las filas a insertar. Mismas columnas y mismo orden de preferencia que el
   disparador. */
function filasDeEquipo(tickets = [], torneoId) {
  return tickets.map(t => ({
    torneo_id: torneoId,
    ticket_id: t.id,
    nombre: nombreDeEquipo(t),
    contacto_email: t.guest_email || null,
    contacto_user_id: t.user_id || null,
  }));
}

/* Lo que se le dice a quien está a punto de cambiar el tipo.
 *
 * Un número sin frase se lee mal en un aviso —«3» no dice si es bueno o malo—,
 * y la frase se escribe aquí y no en la pantalla para que el panel y el correo
 * digan lo mismo si algún día hay correo. */
function avisoDeBoletasSueltas(n) {
  if (!n) return null;
  return n === 1
    ? 'Ya hay 1 boleta vendida de este tipo. No entrará al torneo por su cuenta.'
    : `Ya hay ${n} boletas vendidas de este tipo. No entrarán al torneo por su cuenta.`;
}

module.exports = {
  ESTADOS_CON_EQUIPO, NOMBRE_POR_DEFECTO,
  nombreDeEquipo, boletasSinEquipo, filasDeEquipo, avisoDeBoletasSueltas,
};
