/* Que el paso de lint del CI revise algo de verdad.
 *
 * ── De dónde sale ────────────────────────────────────────────────────────
 *
 * De un 500 en el registro de un evento en producción. En la rama de las
 * boletas GRATUITAS había una variable que no existe —`espacioId`—, y leerla
 * lanza `ReferenceError`: el registro moría con un 500 después de haber
 * insertado ya la boleta, así que la persona quedaba apuntada viendo un error y
 * lo intentaba otra vez.
 *
 * Lo que hace esto una prueba y no sólo un arreglo: el CI YA tenía un paso
 * llamado «Revisar codigo (Lint)» que corría `npm run lint --if-present`… y el
 * script no existía. Llevaba desde el primer día pasando en verde sin mirar una
 * sola línea. Un paso que no puede fallar es peor que no tenerlo, porque se
 * lee como una garantía.
 *
 * El mismo lint, el día que se puso, encontró un segundo fallo idéntico:
 * `GET /mcp/estado` —la ruta con la que alguien comprueba si su token sirve—
 * leía una constante que había desaparecido.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = (f) => path.join(__dirname, '..', f);
const leer = (f) => fs.readFileSync(raiz(f), 'utf8').replace(/\r/g, '');

/* Sin comentarios antes de medir.
 *
 * Las dos últimas pruebas de este archivo fallaron al escribirlas por esto
 * mismo: los comentarios que explican el fallo CITAN el código roto, así que
 * buscarlo en el archivo entero lo encuentra siempre — en su propia
 * explicación. Van cinco veces esta sesión que una prueba mide un comentario en
 * vez del código. */
const codigo = (f) => leer(f)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('existe el script `lint` que el CI invoca', () => {
  /* Sin él, `npm run lint --if-present` no hace nada y pasa. */
  const pkg = JSON.parse(leer('package.json'));
  assert.ok(pkg.scripts?.lint, 'no hay script `lint`: el paso del CI no revisa nada');
  assert.match(pkg.scripts.lint, /eslint/);
});

test('el CI llama al lint antes de las pruebas', () => {
  const ci = leer('.github/workflows/ci-cd.yml');
  assert.match(ci, /npm run lint/);
  assert.ok(ci.indexOf('npm run lint') < ci.indexOf('npm test'),
    'el lint va antes: un fallo de sintaxis o una variable inexistente se ve en un segundo');
});

test('hay configuración de eslint y `no-undef` frena', () => {
  /* Es la única regla que aquí siempre es un fallo: una variable que no existe
     no tiene lectura benigna. Si baja a aviso, el CI vuelve a pasar en verde
     con el registro roto. */
  const cfg = leer('eslint.config.mjs');
  assert.match(cfg, /'no-undef': 'error'/);
});

test('el lint no se salta el código que sirve las rutas', () => {
  /* Un `ignores` de más y volvemos al principio. `.claude` sí se ignora, y con
     motivo: lleva copias del propio repo. */
  const cfg = leer('eslint.config.mjs');
  const ignores = cfg.match(/ignores: \[([^\]]*)\]/)?.[1] || '';
  for (const carpeta of ['routes', 'lib', 'core', 'middleware']) {
    assert.equal(ignores.includes(carpeta), false, `el lint ignora ${carpeta}/`);
  }
});

test('el tope de avisos deja margen pero no es infinito', () => {
  /* `--max-warnings 200` con 55 avisos deja sitio para trabajar sin que la cifra
     crezca sin freno. Sin tope, la lista se vuelve papel pintado. */
  const pkg = JSON.parse(leer('package.json'));
  const tope = Number(pkg.scripts.lint.match(/--max-warnings (\d+)/)?.[1]);
  assert.ok(Number.isInteger(tope) && tope > 0 && tope <= 400, `tope raro: ${tope}`);
});

/* ── Y los dos fallos que lo provocaron, fijados ─────────────────────── */

test('el aforo de una reserva gratuita se cuenta con la silla que existe', () => {
  const ruta = codigo('routes/eventos.publicos.js');
  assert.match(ruta, /personasDeEspacio\(silla\.espacioId\)/);
  assert.equal(/personasDeEspacio\(espacioId\)/.test(ruta), false);
});

test('el estado del MCP cuenta las herramientas de ESE token', () => {
  const ruta = codigo('routes/mcp.js');
  assert.match(ruta, /herramientas: toolsDe\(req\.mcpScopes\)\.length/);
  assert.equal(/TOOLS_MCP/.test(ruta), false, 'quedó una referencia a la constante que ya no existe');
});
