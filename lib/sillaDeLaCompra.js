'use strict';

/* Atar una silla a la boleta que se está emitiendo.
 *
 * ── Por qué esto es un módulo y no tres copias ───────────────────────────
 *
 * Hay TRES caminos para emitir una boleta y ninguno pasa por los otros:
 *
 *   /reservar         gratis, o pago simple por transferencia
 *   /comprar          Mercado Pago
 *   /comprar-wompi    Wompi
 *
 * La primera versión de esto vivía dentro de `/reservar`. O sea que un
 * concierto —que es de pago— habría emitido la boleta y dejado la silla
 * RETENIDA: caduca a los diez minutos y se vende a otra persona, con la
 * primera ya pagada. La forma exacta de la doble venta que todo el módulo
 * existe para impedir, entrando por la puerta de al lado.
 *
 * ── Cuándo pasa a vendida ────────────────────────────────────────────────
 *
 * Al crear la boleta, no al confirmar el pago.
 *
 * Suena mal y es lo correcto: la boleta YA ocupa sitio en cuanto existe —así
 * cuenta el aforo del evento, y así está escrito en `routes/pagos.js`—. Y el
 * viaje a la pasarela puede tardar más que la retención: si se esperara al
 * webhook, la silla caducaría a mitad del pago.
 *
 * La contrapartida es que una compra abandonada deja la silla ocupada hasta
 * que alguien anule la boleta. Es el mismo trato que ya tiene el aforo, y se
 * arregla por el mismo sitio: `liberarPorTicket` al anular.
 */

const supabase = require('./supabase.js');
const { sesionValida } = require('./espacios.js');

/* ── Antes de emitir ──────────────────────────────────────────────────────
 *
 * Devuelve `{ error, estado }` si algo no cuadra, o `{ espacioId, sesion }`
 * si la silla es suya y sigue viva. Se comprueba ANTES de crear la boleta para
 * que quien se quedó sin ella se entere cuando todavía puede elegir otra, y no
 * después de pagar.
 */
async function comprobarAntes({ body, eventoId, tipoId }) {
  const espacioId = body?.espacio_id || null;
  if (!espacioId) return { espacioId: null, sesion: null };

  const sesion = sesionValida(body?.sesion_espacio);
  if (!sesion) return { error: 'Falta identificar el carrito de la silla.', estado: 400 };

  const { data: reserva, error } = await supabase
    .from('espacio_reservas')
    .select('id, estado, expira_at, sesion_compra, espacio:espacios!espacio_id(id, nombre, evento_id)')
    .eq('espacio_id', espacioId).in('estado', ['retenido', 'vendido'])
    .maybeSingle();
  /* El error se mira: sin esto, una consulta fallida se leería como «no hay
     reserva» y la venta seguiría con una silla que puede ser de otro. */
  if (error) return { error: error.message, estado: 500 };

  if (!reserva || reserva.estado === 'vendido') {
    return { error: 'Esa silla ya se vendió. Elige otra en el plano.', estado: 409 };
  }
  if (reserva.sesion_compra !== sesion) {
    return { error: 'Esa silla la está comprando otra persona. Elige otra.', estado: 409 };
  }
  if (!reserva.expira_at || new Date(reserva.expira_at) <= new Date()) {
    return { error: 'Se acabó el tiempo para esa silla. Vuelve al plano y tómala otra vez.', estado: 409 };
  }
  if (reserva.espacio?.evento_id !== eventoId) {
    return { error: 'Esa silla no es de este evento.', estado: 400 };
  }

  /* Y que la silla sea de la localidad que se está comprando. Sin esto se paga
     una entrada de gradería y se guarda una silla de platea, y no falla nada:
     son dos tablas que nadie cruza. */
  const { data: loc, error: eLoc } = await supabase
    .from('ticket_type_espacios').select('ticket_type_id').eq('espacio_id', espacioId).maybeSingle();
  if (eLoc) return { error: eLoc.message, estado: 500 };
  if (loc && loc.ticket_type_id !== tipoId) {
    return { error: 'Esa silla no corresponde a la boleta que elegiste.', estado: 400 };
  }

  return { espacioId, sesion, nombre: reserva.espacio?.nombre || null };
}

/* ── Después de emitir ────────────────────────────────────────────────────
 *
 * `true` si quedó atada. `false` si la retención caducó en el hueco entre la
 * comprobación y esta línea —milisegundos, pero pasa— o si otra persona la
 * tomó. Quien llama tiene que deshacer la boleta: una venta sin sitio se
 * descubre en la puerta, con la persona delante y su asiento ocupado, y eso ya
 * no tiene arreglo técnico.
 */
async function confirmarDespues({ espacioId, sesion, ticketId }) {
  if (!espacioId) return true;
  const { data, error } = await supabase.rpc('confirmar_espacio', {
    p_espacio: espacioId, p_sesion: sesion, p_ticket: ticketId,
  });
  if (error) {
    console.error(`[silla] confirmar ${espacioId}: ${error.message}`);
    return false;
  }
  return Boolean(data);
}

/* ── Cuando la boleta deja de valer ───────────────────────────────────────
 *
 * Anular, reembolsar o dejar caducar una compra tiene que devolver la silla.
 * Sin esto, una compra abandonada la deja ocupada para siempre y la única
 * salida es que alguien la libere a mano desde el panel — que existe, pero
 * enterarse de que hace falta es el problema.
 *
 * No lanza: si esto falla, la anulación de la boleta ya ocurrió y hacerla
 * fracasar por la silla sería cambiar un problema pequeño por uno grande. Se
 * anota, que es lo que permite encontrarlo después.
 */
async function liberarPorTicket(ticketId) {
  if (!ticketId) return 0;
  const { data, error } = await supabase
    .from('espacio_reservas')
    .update({ estado: 'liberado', updated_at: new Date().toISOString() })
    .eq('ticket_id', ticketId).eq('estado', 'vendido')
    .select('id');
  if (error) {
    console.error(`[silla] liberar por ticket ${ticketId}: ${error.message}`);
    return 0;
  }
  return data?.length || 0;
}

/* El mensaje que se devuelve cuando la silla se pierde entre la comprobación y
   el cobro. Va aquí para que los tres caminos digan lo mismo: quien lo lee
   tiene que entender que no se le cobró y que puede volver a elegir. */
const SE_PERDIO = 'Se acabó el tiempo para esa silla y la tomó otra persona. No se te cobró nada; elige otra en el plano.';

module.exports = { comprobarAntes, confirmarDespues, liberarPorTicket, SE_PERDIO };
