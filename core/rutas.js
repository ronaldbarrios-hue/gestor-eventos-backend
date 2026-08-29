'use strict';

/* core/rutas.js — el censo de lo que la aplicación atiende de verdad.
 *
 * Express sabe exactamente qué rutas tiene registradas; lo que no hay es forma
 * de preguntárselo. Esta función recorre su árbol interno y devuelve la lista.
 *
 * Estaba dentro de `index.js` para imprimirla al arrancar. Sale aquí porque la
 * fase 7 la necesita: la prueba que comprueba que ninguna ruta se queda sin
 * declarar qué permiso exige tiene que mirar la lista real, no una copiada a
 * mano que se queda vieja a la semana.
 *
 * ── El prefijo de montaje, que en Express 5 hay que adivinar ──────────────
 *
 * Hasta Express 4 la capa de un router guardaba la expresión regular de su
 * montaje y el prefijo se sacaba de ahí. En Express 5 ya no: la capa sólo
 * lleva un `matcher`, que es una función cerrada sobre una regexp que no se
 * puede leer. Sin prefijo, `GET /` de `routes/categorias.js` y `GET /` de la
 * raíz son la misma cadena, y el censo pierde rutas por el camino — pasó: de
 * 279 rutas salían 273 identificadores.
 *
 * Así que el `matcher` se usa como oráculo. Los sitios donde esta aplicación
 * monta algo son literales en el código (`app.use('/categorias', …)`), se
 * sacan de ahí, y a cada router se le prueba cuál de ellos acepta. Gana el más
 * largo que encaje. No es elegante; es lo que hay, y falla del lado seguro: si
 * un prefijo no se reconoce, la ruta queda con el suyo propio y como mucho se
 * declara de más.
 */

const fs = require('fs');
const path = require('path');
const { marcaDe } = require('./permisos');

const RAIZ = path.join(__dirname, '..');

/* Los prefijos que aparecen literalmente en el código: `app.use('/x', …)` y
   `router.use('/x', …)`. Se leen una vez. */
let _candidatos = null;

function candidatos() {
  if (_candidatos) return _candidatos;

  const archivos = [path.join(RAIZ, 'index.js')];
  const dirRutas = path.join(RAIZ, 'routes');
  if (fs.existsSync(dirRutas)) {
    for (const f of fs.readdirSync(dirRutas)) {
      if (f.endsWith('.js')) archivos.push(path.join(dirRutas, f));
    }
  }

  const vistos = new Set();
  for (const archivo of archivos) {
    const texto = fs.readFileSync(archivo, 'utf8');
    for (const m of texto.matchAll(/\.use\(\s*'(\/[^']*)'/g)) {
      if (m[1] && m[1] !== '/') vistos.add(m[1]);
    }
  }

  /* Del más CORTO al más largo, y gana el primero que encaje.
   *
   * Parece al revés y no lo es: un router de Express casa por prefijo, así que
   * el montado en `/eventos/publicos` acepta también `/eventos/publicos/expositor`.
   * Quedarse con el más largo le robaba el prefijo al vecino —dos rutas
   * distintas acababan con el mismo identificador y una desaparecía del censo—.
   * El montaje real es siempre el más corto de los que aceptan. */
  _candidatos = [...vistos].sort((a, b) => a.length - b.length);
  return _candidatos;
}

function prefijoDe(capa) {
  const matcher = capa.matchers?.[0];

  /* Express 4 y anteriores: el prefijo estaba a la vista. */
  if (!matcher && capa.regexp?.source) {
    const m = capa.regexp.source.match(/^\^\\\/([^\\]+(?:\\\/[^\\]+)*)/);
    return m ? '/' + m[1].replace(/\\\//g, '/') : '';
  }
  if (typeof matcher !== 'function') return '';

  for (const p of candidatos()) {
    try { if (matcher(p)) return p; } catch { /* un candidato que no encaja */ }
  }
  return '';
}

/* Recorre la aplicación y llama a `visitar` con cada ruta.
 *
 * `heredadas` son las marcas de permisos puestas con `router.use(publica(…))`,
 * que valen para todas las rutas de ese router. Se arrastran hacia dentro.
 */
function recorrer(app, visitar) {
  function bajar(stack, prefijo, heredadas) {
    /* Las marcas del propio router se recogen antes de mirar sus rutas: una
       marca declarada al final del archivo vale igual que al principio. */
    const propias = [];
    for (const capa of stack || []) {
      if (!capa.route && capa.name !== 'router') {
        const m = marcaDe(capa.handle);
        if (m) propias.push(m);
      }
    }
    const enVigor = heredadas.concat(propias);

    for (const capa of stack || []) {
      if (capa.route) {
        const marcasRuta = (capa.route.stack || [])
          .map(c => marcaDe(c.handle))
          .filter(Boolean);

        for (const metodo of Object.keys(capa.route.methods)) {
          visitar({
            metodo: metodo.toUpperCase(),
            ruta  : `${prefijo}${capa.route.path}`,
            marcas: marcasRuta.concat(enVigor),
          });
        }
        continue;
      }

      if (capa.name === 'router' && capa.handle?.stack) {
        bajar(capa.handle.stack, prefijo + prefijoDe(capa), enVigor);
      }
    }
  }

  bajar(app._router?.stack || app.router?.stack || [], '', []);
}

/* [{ metodo, ruta, id, marcas }]. `id` es «MÉTODO /ruta», la clave con la que
   cada ruta se declara en el inventario de permisos. */
function listarRutas(app) {
  const rutas = [];
  recorrer(app, (r) => rutas.push({ ...r, id: `${r.metodo} ${r.ruta}` }));
  return rutas;
}

/* La forma vieja, para el mensaje del arranque: una línea por ruta. */
function comoTexto(app) {
  const porRuta = new Map();
  for (const r of listarRutas(app)) {
    if (!porRuta.has(r.ruta)) porRuta.set(r.ruta, []);
    porRuta.get(r.ruta).push(r.metodo);
  }
  return [...porRuta.entries()].map(([ruta, metodos]) => `${metodos.join('|').padEnd(7)} ${ruta}`);
}

module.exports = { listarRutas, comoTexto, recorrer, prefijoDe, _candidatos: candidatos };
