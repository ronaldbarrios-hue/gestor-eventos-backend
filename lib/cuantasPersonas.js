'use strict';

/* Cuánta gente entra con una boleta.
 *
 * ── Por qué no siempre es una ────────────────────────────────────────────
 *
 * Desde la 0117 una unidad vendible puede admitir más de una persona: una mesa
 * de ringside son cuatro, un palco son ocho. Se vende UNA boleta y entran ocho.
 *
 * El aforo se sumaba de uno en uno en cuatro sitios distintos, así que doce
 * mesas vendidas dejaban `aforo_vendido: 12` — y por la puerta iban a pasar 48
 * personas. En un recinto con aforo legal eso no es un número mal puesto: es el
 * organizador creyendo que le quedan 36 sitios que no existen.
 *
 * ── La distinción que hay que mantener ───────────────────────────────────
 *
 *   ticket_types.vendidos  cuántas UNIDADES se vendieron   → 12 mesas
 *   eventos.aforo_vendido  cuánta GENTE va a entrar        → 48 personas
 *
 * No son el mismo número y confundirlos rompe una de las dos cuentas. El cupo
 * de un tipo de boleta se agota por unidades («quedan 3 mesas»); el aforo del
 * recinto se llena por personas.
 */

/* Cuánta gente admite la boleta `ticketId`.
 *
 * Devuelve 1 si no tiene sitio asignado —que es la inmensa mayoría de las
 * boletas— o si algo falla. Nunca lanza: esto se llama en mitad de una compra,
 * y hacer fracasar una venta por no poder contar sería cambiar un problema
 * pequeño por uno grande. Un aforo que se queda corto se corrige; una venta
 * perdida, no.
 */
async function personasDeTicket(ticketId) {
  if (!ticketId) return 1;
  try {
    const supabase = require('./supabase.js');
    const { data, error } = await supabase
      .from('espacio_reservas')
      .select('espacio:espacios!espacio_id(capacidad)')
      .eq('ticket_id', ticketId).eq('estado', 'vendido')
      .maybeSingle();
    if (error) {
      console.error(`[aforo] capacidad de ${ticketId}: ${error.message}`);
      return 1;
    }
    const n = Number(data?.espacio?.capacidad);
    return Number.isInteger(n) && n > 0 ? n : 1;
  } catch (e) {
    console.error(`[aforo] capacidad de ${ticketId}: ${e.message}`);
    return 1;
  }
}

/* Lo mismo, cuando todavía no hay boleta: en la compra se conoce el espacio
   antes de emitir. Evita una consulta de más y, sobre todo, evita tener que
   emitir primero para poder contar. */
async function personasDeEspacio(espacioId) {
  if (!espacioId) return 1;
  try {
    const supabase = require('./supabase.js');
    const { data } = await supabase
      .from('espacios').select('capacidad').eq('id', espacioId).maybeSingle();
    const n = Number(data?.capacidad);
    return Number.isInteger(n) && n > 0 ? n : 1;
  } catch { return 1; }
}

module.exports = { personasDeTicket, personasDeEspacio };
