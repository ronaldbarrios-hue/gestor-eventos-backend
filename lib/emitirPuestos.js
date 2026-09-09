'use strict';

/* Crear los puestos de una boleta recién emitida — en UN solo sitio.
 *
 * ── Por qué esto es una función y no seis trozos iguales ─────────────────
 *
 * Una boleta se emite en seis lugares distintos: la compra gratuita, la de
 * pasarela, la de Wompi, la cortesía del panel, la del agente y la del
 * autorregistro. Cada uno firma su QR por su cuenta.
 *
 * El modo de fallo de este proyecto es exactamente ése: una lista escrita a
 * mano en varios sitios que se separa, falta algo y NO salta ningún error. Si
 * los puestos se crearan en cinco de los seis, la mesa vendida por el sexto
 * llegaría a la puerta sin puestos y las otras tres personas se quedarían
 * fuera — sin que nada avisara hasta esa noche.
 *
 * Por eso hay una sola función, y una prueba que comprueba que todo archivo que
 * firma un QR de boleta también la llama.
 *
 * ── Y por qué nunca lanza ────────────────────────────────────────────────
 *
 * Esto corre justo después de cobrar. Hacer fracasar una venta ya pagada por no
 * poder escribir una fila sería cambiar un problema pequeño —una mesa que entra
 * con el modo de red del escáner— por uno grande: alguien pagó y no tiene nada.
 */

const puestos = require('./puestos.js');
const { signPuestoQR } = require('./qr.js');

/* `personas` es la capacidad de lo que se compró: 4 en una mesa, 1 en una
   entrada normal. `modo` sale del tipo de boleta (`modo_entrada`, 0118).
 *
 * Devuelve los puestos creados, o `[]` si algo falló o no hacía falta. */
async function emitirPuestos({ ticket, eventoId, personas = 1, modo = 'individual', titular = {} }) {
  const total = puestos.cuantosPuestos(personas);
  /* Una boleta de una sola persona no necesita puestos: es lo que la plataforma
     ya hacía, funciona, y llenar la tabla de filas de una en una sólo añadiría
     una consulta a cada compra del noventa y nueve por ciento de los casos. */
  if (total <= 1) return [];

  try {
    const supabase = require('./supabase.js');
    const filas = puestos.filasDePuestos({
      ticketId: ticket.id, eventoId, personas: total, modo, titular,
    });

    const { data, error } = await supabase.from('ticket_puestos').insert(filas).select('id, orden');
    if (error) {
      /* Se anota con el id de la boleta para poder repararla a mano: sin esta
         línea, una mesa sin puestos es invisible hasta la puerta. */
      console.error(`[puestos] boleta ${ticket.id}: ${error.message}`);
      return [];
    }

    /* Los tokens se firman DESPUÉS de insertar porque hacen falta los ids que la
       base acaba de dar. Firmar antes daría credenciales que no apuntan a nada.
     *
     * En `contador` no se firma ninguno a propósito: ese modo tiene una sola
     * credencial —la de la boleta— y la puerta lleva la cuenta. */
    if (modo === 'contador') return data;

    for (const p of data) {
      const qr_token = signPuestoQR({
        ticket_id: ticket.id, evento_id: eventoId, codigo: ticket.codigo,
        puesto_id: p.id, orden: p.orden,
      });
      await supabase.from('ticket_puestos').update({ qr_token }).eq('id', p.id);
    }
    return data;
  } catch (e) {
    console.error(`[puestos] boleta ${ticket?.id}: ${e.message}`);
    return [];
  }
}

/* El modo de entrada del tipo de boleta, en su PROPIA consulta a propósito.
 *
 * `modo_entrada` es de la 0118. Pedirla junto a las demás columnas del tipo
 * haría que, en un despliegue sin la migración aplicada, el select fallara
 * ENTERO y se perdiera también el nombre del tipo y la cuenta de vendidos —en
 * mitad de una compra—. Aquí, si falla, sólo se pierde el modo, y `individual`
 * es exactamente lo que la plataforma ya hacía. */
async function modoDelTipo(tipoId) {
  if (!tipoId) return 'individual';
  try {
    const supabase = require('./supabase.js');
    const { data } = await supabase.from('ticket_types').select('modo_entrada').eq('id', tipoId).maybeSingle();
    return data?.modo_entrada || 'individual';
  } catch { return 'individual'; }
}

module.exports = { emitirPuestos, modoDelTipo };
