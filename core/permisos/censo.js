'use strict';

/* core/permisos/censo.js — qué declara cada ruta, y cuáles no declaran nada.
 *
 * Recorre las rutas que Express tiene REGISTRADAS —no las que alguien apuntó en
 * un documento— y mira si cada una lleva la marca de `exige()` o la de
 * `publica()`. Lo que no lleva ninguna es lo que hay que ir arreglando.
 *
 * Se compara contra `inventario.json`, que es la foto de la última vez. De ahí
 * salen las dos cosas que la prueba necesita saber:
 *
 *   · **Rutas nuevas sin declarar.** Falla siempre. Arreglarlo el día que se
 *     escribe la ruta es barato; el día del evento, no.
 *   · **Cuántas quedan del montón viejo.** Ese número sólo puede bajar. No
 *     obliga a declarar 249 rutas hoy, pero impide que sean 250 mañana.
 */

const fs = require('fs');
const path = require('path');
const { listarRutas } = require('../rutas.js');

const RUTA_INVENTARIO = path.join(__dirname, 'inventario.json');

/* El estado real, leído de la aplicación viva. */
function censar(app) {
  return listarRutas(app).map(r => {
    const exige = r.marcas.find(m => m.tipo === 'exige');
    const publica = r.marcas.find(m => m.tipo === 'publica');
    return {
      metodo  : r.metodo,
      ruta    : r.ruta,
      id      : r.id,
      /* `exige` gana a `publica`: si una ruta concreta pide un permiso dentro
         de un router declarado público, manda la de la ruta. */
      estado  : exige ? 'exige' : (publica ? 'publica' : 'pendiente'),
      acciones: exige?.acciones || null,
      motivo  : publica?.motivo || null,
    };
  });
}

function leerInventario() {
  if (!fs.existsSync(RUTA_INVENTARIO)) return null;
  return JSON.parse(fs.readFileSync(RUTA_INVENTARIO, 'utf8'));
}

function guardarInventario(inventario) {
  fs.writeFileSync(RUTA_INVENTARIO, `${JSON.stringify(inventario, null, 2)}\n`);
}

/* Compara lo que hay con lo anotado, ya masticado para el mensaje de error. */
function comparar(app, inventario = leerInventario()) {
  const actuales = censar(app);
  const conocidas = new Set(Object.keys(inventario?.rutas || {}));

  const nuevas = actuales.filter(r => !conocidas.has(r.id));
  const desaparecidas = [...conocidas].filter(id => !actuales.some(r => r.id === id));
  const pendientes = actuales.filter(r => r.estado === 'pendiente');

  return {
    actuales,
    nuevas,
    desaparecidas,
    pendientes,
    /* Una ruta nueva ya declarada no molesta a nadie; la que se cuela sin
       declarar es la que hay que cazar. */
    nuevasSinDeclarar: nuevas.filter(r => r.estado === 'pendiente'),
    tope: inventario?.pendientes_maximo ?? Infinity,
  };
}

module.exports = { censar, comparar, leerInventario, guardarInventario, RUTA_INVENTARIO };
