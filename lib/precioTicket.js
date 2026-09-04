'use strict';

/* Cuánto cuesta una boleta, en un solo sitio.
 *
 * ── Lo que estaba pasando ────────────────────────────────────────────────
 *
 * El panel deja crear promociones («FESTECH20, 20 %»), la lista se ve, se
 * activan y se desactivan. Hay hasta un endpoint público que dice si un código
 * es válido. Y **nadie descontaba nada**: el cobro salía de
 *
 *     hasEarly ? tipo.early_bird_precio : tipo.precio
 *
 * escrito tal cual en `routes/pagos.js`, otra vez en `routes/wompi.js` y una
 * tercera en la pantalla pública. El código de descuento no entraba en la
 * compra por ningún lado — `promociones.validar` no lo llamaba ni un archivo.
 *
 * O sea: una función que se vende como que existe, que el organizador anuncia
 * a su gente, y que cobra el precio entero. Eso no es una pantalla a medias:
 * es una promesa de dinero que no se cumple.
 *
 * ── La regla que no se rompe ─────────────────────────────────────────────
 *
 * **El precio lo pone el servidor.** El navegador manda un CÓDIGO, nunca un
 * importe. Si mandara el importe, cualquiera compraría a mil pesos cambiando
 * un número en las herramientas del navegador — y la pasarela cobraría eso,
 * porque a la pasarela le decimos nosotros cuánto cobrar.
 *
 * Por eso `validar` (lo que ve quien compra, antes de pagar) y el cobro de
 * verdad usan LA MISMA función de aquí. Si se separan, un día uno dirá que el
 * código vale y el otro cobrará como si no.
 */

const supabase = require('./supabase.js');

/* El precio de lista: `early_bird` mientras esté vigente, si no el normal.
   Estaba copiado en tres archivos; cuando alguien cambie la regla —«que el
   early bird valga hasta agotar cupo», por ejemplo— va a cambiarla en uno. */
function precioLista(tipo) {
  const vigente = tipo?.early_bird_precio != null
    && tipo?.early_bird_hasta
    && new Date(tipo.early_bird_hasta) > new Date();
  return {
    precio     : Number(vigente ? tipo.early_bird_precio : tipo?.precio) || 0,
    early_bird : Boolean(vigente),
  };
}

/* Redondeo a peso entero. Un 33 % sobre 10.000 son 6.700, no 6.700,000000001,
   y a la pasarela hay que darle una cifra que se pueda cobrar. */
const aPeso = (n) => Math.max(0, Math.round(Number(n) || 0));

/* Busca la promoción y dice si sirve PARA ESTA compra.
   Devuelve `{ promocion }` o `{ motivo }` — el motivo es para enseñarlo, no
   para el log: quien escribe un código quiere saber por qué no le vale. */
async function buscarPromocion({ eventoId, codigo, ticketTypeId, cantidad }) {
  const limpio = String(codigo || '').trim().toUpperCase();
  if (!limpio) return {};

  const { data: p, error } = await supabase.from('promociones')
    .select('*')
    .eq('evento_id', eventoId)
    .eq('codigo', limpio)
    .maybeSingle();

  /* Se mira el error. Si la consulta falló no se puede decir «código inválido»
     como si la base hubiera contestado que no existe: son cosas distintas y la
     segunda hace que alguien busque el error en el sitio equivocado. */
  if (error) return { motivo: 'No se pudo comprobar el código ahora mismo.' };
  if (!p)          return { motivo: 'Ese código no existe para este evento.' };
  if (!p.activo)   return { motivo: 'Ese código ya no está activo.' };

  const ahora = new Date();
  if (p.vigente_desde && new Date(p.vigente_desde) > ahora)
    return { motivo: 'Ese código todavía no empieza.' };
  if (p.vigente_hasta && new Date(p.vigente_hasta) < ahora)
    return { motivo: 'Ese código ya venció.' };
  if (p.limite_usos != null && (p.usos || 0) >= p.limite_usos)
    return { motivo: 'Ese código ya se usó el máximo de veces.' };
  if (p.ticket_id && String(p.ticket_id) !== String(ticketTypeId || ''))
    return { motivo: 'Ese código es para otro tipo de boleta.' };
  if ((Number(cantidad) || 1) < (p.min_cantidad || 1))
    return { motivo: `Ese código pide comprar al menos ${p.min_cantidad} boletas.` };

  return { promocion: p };
}

/* Lo que se va a cobrar de verdad.
 *
 * `lista` es el precio sin descuento y `precio` el que se cobra: los dos hacen
 * falta, porque en el recibo y en la pantalla hay que poder tachar el primero.
 *
 * Un descuento nunca deja el precio por debajo de cero, y —esto importa— un
 * 100 % deja la boleta en 0: eso NO se manda a la pasarela, que rechaza cobros
 * de cero. Quien llama tiene que mirar `gratis`. */
async function precioDeCompra({ eventoId, tipo, codigo, cantidad }) {
  const { precio: lista, early_bird } = precioLista(tipo);

  const { promocion, motivo } = await buscarPromocion({
    eventoId, codigo, ticketTypeId: tipo?.id, cantidad,
  });

  if (!promocion) {
    return { lista, precio: lista, early_bird, promocion: null, motivo: motivo || null, gratis: lista <= 0 };
  }

  const valor = Number(promocion.valor) || 0;
  const precio = promocion.tipo === 'fijo'
    ? aPeso(lista - valor)
    : aPeso(lista * (1 - valor / 100));

  return {
    lista,
    precio,
    early_bird,
    gratis: precio <= 0,
    promocion: {
      id: promocion.id, codigo: promocion.codigo, tipo: promocion.tipo,
      valor, descripcion: promocion.descripcion || null,
      ahorro: lista - precio,
    },
    motivo: null,
  };
}

/* Quema un uso, y se hace CUANDO SE PAGA, no al abrir el checkout.
 *
 * Si se contara al abrirlo, diez personas que miran y se van dejarían un código
 * de diez usos agotado sin haber vendido nada.
 *
 * Va por RPC porque `usos = usos + 1` desde el cliente serían dos viajes —leer
 * y escribir— y dos compras a la vez se pisarían el número. El `where` de
 * dentro también comprueba el límite: si dos pagos entran a la vez con el
 * último uso, sólo uno lo consume.
 *
 * Y si el límite ya estaba agotado NO se deshace nada: el dinero ya entró. Se
 * anota y se sigue — cobrar y luego decirle a la persona que su código no valía
 * sería lo peor de las dos opciones. */
async function consumirPromocion(promocionId) {
  if (!promocionId) return false;
  const { data, error } = await supabase.rpc('promocion_consumir', { p_id: promocionId });
  if (error) {
    console.warn('[promocion] no se pudo contar el uso:', error.message);
    return false;
  }
  if (data === false) console.warn('[promocion] uso por encima del límite:', promocionId);
  return data !== false;
}

module.exports = { precioLista, precioDeCompra, buscarPromocion, consumirPromocion };
