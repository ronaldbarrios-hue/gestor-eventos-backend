/* Las reglas de una puerta: qué boletas admite y quién la atiende.
 *
 * ── Qué se protege aquí ──────────────────────────────────────────────────
 *
 * Esto decide QUIÉN ENTRA. Una lectura vacía no sería una pantalla en blanco:
 * sería una puerta que deja pasar a cualquiera, o que no deja pasar a nadie.
 *
 * La 0096 movió la puerta a `zonas`; la 0098 mueve sus reglas. Mientras el
 * original siga en `page_json.accesos`, hay que leer los dos sitios — y ese
 * orden es lo único que separa «migración en curso» de «la puerta se quedó sin
 * reglas».
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

test('la puerta se lee de la tabla, con vuelta atrás al JSON', () => {
  const tabla = leer('lib/zonasTabla.js');
  assert.match(tabla, /async function leerPuerta/, 'ya no existe la lectura única de la puerta');
  const fn = tabla.slice(tabla.indexOf('async function leerPuerta'));
  assert.match(fn, /from\('zonas'\)/, 'leerPuerta dejó de mirar la tabla');
  assert.match(fn, /page_json/, 'leerPuerta perdió la vuelta atrás: una puerta sin reglas dejaría pasar a cualquiera');
});

test('el control de ingreso no lee `accesos` por su cuenta', () => {
  /* Si vuelve a leerlo directamente, tendremos dos verdades sobre quién entra
     — y la que se quede atrás será la que decida. */
  const clientes = leer('routes/clientes.js');
  const codigo = clientes
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/page_json\?\.accesos|page_json\.accesos/.test(codigo),
    'el check-in volvió a leer page_json.accesos directamente: usa leerPuerta');
});

test('las reglas viajan con la puerta al guardarla', () => {
  /* Sin esto, renombrar una puerta desde el panel dejaría la fila con el nombre
     nuevo y las reglas viejas. */
  const tabla = leer('lib/zonasTabla.js');
  const fn = tabla.slice(tabla.indexOf('async function sincronizarPuertas'), tabla.indexOf('async function conZonas'));
  assert.match(fn, /reglas:/, 'sincronizarPuertas dejó de espejar las reglas');
  assert.match(fn, /tipos/, 'las reglas ya no llevan los tipos de boleta admitidos');
});
