/* De dónde vino una inscripción.
 *
 * ── Qué resuelve ─────────────────────────────────────────────────────────
 *
 * El organizador pega el botón de registro en su web, en un correo, en el
 * Instagram de la alcaldía y en el WhatsApp del gremio — y después no sabe
 * cuál le trajo gente. El `origen` es un código corto que viaja en el enlace
 * del botón y se guarda con la boleta.
 *
 * ── Por qué se limpia aquí y no en cada ruta ─────────────────────────────
 *
 * Lo escriben los tres caminos de compra (reserva, Mercado Pago, Wompi) y llega
 * de la URL, o sea de fuera. Tres copias de la limpieza acabarían aceptando
 * cosas distintas, y entonces «boton-home» y «Botón Home» serían dos canales
 * en el informe cuando son el mismo.
 *
 * Se recorta en vez de rechazar: un origen mal formado no puede tumbar una
 * compra. Lo peor que pasa es que esa inscripción cuente como directa.
 */

'use strict';

const LARGO_MAX = 40;

function limpiarOrigen(v) {
  if (typeof v !== 'string') return null;
  const limpio = v
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // sin tildes
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')                       // sólo lo que sobrevive a una URL
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, LARGO_MAX);
  return limpio || null;
}

module.exports = { limpiarOrigen, LARGO_MAX };
