'use strict';

const crypto = require('crypto');

/* El código corto de una boleta, en un solo sitio.
 *
 * ── Por qué existe este archivo ───────────────────────────────────────────
 *
 * Estaba copiado en cinco: `routes/clientes.js`, `routes/eventos.publicos.js`,
 * `routes/pagos.js`, `routes/wompi.js` y `lib/agente.js`. Cinco funciones
 * idénticas que generan **la credencial con la que se entra al evento** —el
 * backend acepta el código corto además del token firmado (`ticketLookup.js`)—.
 *
 * Cinco copias de algo así no es un problema de aseo: es que el día que haya
 * que alargarlo, cambiar el alfabeto o arreglar el generador, hay que acordarse
 * de cinco sitios, y el que se olvide sigue emitiendo códigos de la forma
 * vieja. Y no se notaría: los códigos viejos y los nuevos se ven igual.
 *
 * ── Y de paso, el generador ──────────────────────────────────────────────
 *
 * Las cinco copias usaban `Math.random()`, que **no es criptográfico**: su
 * estado interno se puede reconstruir observando suficientes salidas, y de ahí
 * predecir las siguientes. Para un color de fondo da igual; para algo que abre
 * una puerta, no — sobre todo cuando los códigos se emiten en tanda y salen
 * impresos uno detrás de otro.
 *
 * `crypto.randomBytes` no tiene ese problema. Cuesta lo mismo.
 *
 * ── Sin sesgo, y sin darle vueltas ───────────────────────────────────────
 *
 * El alfabeto tiene **32** símbolos y 256 es múltiplo exacto de 32, así que
 * `byte % 32` reparte los 32 símbolos por igual: no hay que descartar bytes ni
 * repetir la tirada. Si alguien cambia el alfabeto a un número que no divida a
 * 256 —por ejemplo quitando una letra— aparece un sesgo silencioso, y por eso
 * la comprobación de abajo salta al cargar el módulo en vez de dejarlo pasar.
 */

/* Sin `I`, `O`, `0` ni `1`: este código se lee en voz alta en una puerta y se
   teclea desde el móvil. Un cero y una O se confunden a la primera. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

if (256 % ALFABETO.length !== 0) {
  throw new Error(
    `[codigos] el alfabeto tiene ${ALFABETO.length} símbolos y 256 no es múltiplo suyo: `
    + 'el reparto quedaría sesgado. Ajusta el alfabeto o implementa el descarte.',
  );
}

const LARGO_DEFECTO = 8;

/* Un código nuevo. 32^8 ≈ 1,1 billones de combinaciones: adivinar uno a ciegas
   no es un camino, y por eso el largo se queda en 8 —lo que cabe en una tira de
   escarapela y se puede dictar por teléfono—. */
function generarCodigo(largo = LARGO_DEFECTO) {
  const bytes = crypto.randomBytes(largo);
  let salida = '';
  for (let i = 0; i < largo; i++) salida += ALFABETO[bytes[i] % ALFABETO.length];
  return salida;
}

/* Para comparar lo que alguien teclea contra lo guardado: mayúsculas y sin los
   espacios que mete el móvil al pegar. No corrige confusiones (`0`→`O`) a
   propósito: si un código con cero llegara a existir, «arreglarlo» aquí lo
   convertiría en otro código válido distinto. */
function normalizarCodigo(texto) {
  return String(texto || '').trim().toUpperCase().replace(/\s+/g, '');
}

module.exports = { generarCodigo, normalizarCodigo, ALFABETO, LARGO_DEFECTO };
