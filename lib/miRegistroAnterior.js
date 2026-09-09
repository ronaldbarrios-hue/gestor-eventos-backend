'use strict';

/* Encontrar el registro anterior de quien está llenando el formulario.
 *
 * ── Dos llaves, y por qué ────────────────────────────────────────────────
 *
 * EL CÓDIGO de una boleta. Es una llave larga y aleatoria: quien lo tiene es
 * porque le llegó a su correo. No abre ninguna puerta nueva —`/ticket/:codigo`
 * ya enseña hoy esa boleta a quien lo tenga— así que basta por sí solo.
 *
 * EL DOCUMENTO, que NO basta por sí solo y ésa es la diferencia importante.
 * Una cédula no es un secreto: está impresa, se fotocopia, se deja en
 * porterías. Y lo que hay al otro lado son las respuestas del formulario, que
 * en un evento con ficha de caracterización incluyen fecha de nacimiento,
 * comuna, identidad de género, autorreconocimiento étnico, situación de
 * víctima y discapacidad. Eso es exactamente lo que la Ley 1581 llama datos
 * sensibles.
 *
 * Servir eso a quien teclee un número de cédula sería un buscador de personas.
 * Por eso el documento va SIEMPRE acompañado del correo: las dos cosas las
 * tiene quien es dueño de los datos, y ninguna de las dos sola abre nada.
 *
 * ── Y por qué la base de registrados y no el Excel ───────────────────────
 *
 * El padrón es una lista que el organizador sube a mano, y por tanto está
 * desactualizada desde el momento en que alguien se registra. Quien ya se
 * inscribió a una boleta de este evento está en `tickets`, con sus respuestas
 * tal como las escribió — que es el dato bueno.
 */

/* Las preguntas de tipo documento de un formulario. En plural porque un evento
   puede preguntar «documento del titular» y «documento del acompañante», y hay
   que mirar las dos: buscar sólo en la primera dejaría fuera a quien se
   registró por la otra. */
const camposDocumento = (campos = []) => campos.filter(c => c.tipo === 'documento');

/* Un documento comparable: sin puntos, sin espacios, sin guiones.
   «1.099.123-4» y «10991234» son la misma cédula escrita por dos personas. */
const normalizar = (v) => String(v ?? '').replace(/[^0-9a-zA-Z]/g, '').toUpperCase();

/* La boleta anterior de esta persona en este evento, buscando por documento Y
 * correo.
 *
 * Se busca PRIMERO por correo y luego se comprueba el documento, y no al revés,
 * por dos razones que apuntan a lo mismo: `guest_email` acota a un puñado de
 * filas —una persona tiene pocas boletas— mientras que el documento vive dentro
 * de un `jsonb` y buscarlo obligaría a recorrer las boletas del evento. Y
 * porque así el documento nunca decide solo: es la segunda comprobación, no la
 * primera.
 *
 * Devuelve `null` cuando no cuadra, sin decir cuál de las dos falló.
 */
async function porDocumentoYCorreo({ eventoId, campos, documento, email }) {
  const doc = normalizar(documento);
  const correo = String(email || '').trim().toLowerCase();
  if (!doc || !correo.includes('@')) return null;

  const preguntas = camposDocumento(campos);
  if (!preguntas.length) return null;

  /* El require va AQUÍ y no arriba: `supabase.js` exige credenciales al
     importarse, y con él en la cabecera este archivo no se puede probar sin
     un `.env`. Ya pasó con `auditarAgente.js`, y una pieza que decide sobre
     datos sensibles es justo la que hay que poder probar. */
  const supabase = require('./supabase.js');

  const { data, error } = await supabase
    .from('tickets')
    .select('respuestas, guest_nombre, guest_email, created_at')
    .eq('evento_id', eventoId)
    .eq('guest_email', correo)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error(`[prellenar] boletas de ${eventoId}: ${error.message}`);
    return null;
  }

  /* La más reciente que cuadre: si alguien se registró dos veces, lo último que
     escribió es lo que quiere volver a usar. */
  for (const t of data || []) {
    const suyo = preguntas.some(c => normalizar(t.respuestas?.[c.id]) === doc);
    if (suyo) return t;
  }
  return null;
}

module.exports = { camposDocumento, normalizar, porDocumentoYCorreo };
