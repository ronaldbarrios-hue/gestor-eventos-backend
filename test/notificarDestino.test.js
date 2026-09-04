/* A dónde lleva una notificación.
 *
 * ── Qué se protege aquí ──────────────────────────────────────────────────
 *
 * Dos cosas, y las dos ya mordieron una vez en este archivo:
 *
 *  1. **Que el aviso se cree.** `lib/notificar.js` insertaba una columna que la
 *     tabla no tenía, supabase-js no lanza cuando el INSERT falla —devuelve
 *     `{ error }`— y nadie lo miraba: durante meses no se creó ni una
 *     notificación, en ningún evento. Por eso el INSERT se reintenta sin la
 *     columna en vez de confiar en que la migración llegó primero.
 *  2. **Que el destino sea de esta aplicación.** El panel hace
 *     `navigate(n.link)` sin mirar. Una URL absoluta ahí es un redirector
 *     abierto.
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

/* `notificar.js` sólo requiere supabase, que necesita el .env. Se extrae la
   función pura y se evalúa: lo que se prueba es la decisión, no el viaje. */
function cargarDestinoValido() {
  const src = leer('lib/notificar.js');
  const i = src.indexOf('function destinoValido');
  assert.notEqual(i, -1, 'ya no existe `destinoValido`: los destinos entran sin comprobar');
  const fin = src.indexOf('\n}', i) + 2;
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(i, fin)}; return destinoValido;`)();
}
const destinoValido = cargarDestinoValido();

test('una ruta de la propia aplicación pasa', () => {
  assert.equal(destinoValido('/eventos/abc?s=zonas&t=aforo'), '/eventos/abc?s=zonas&t=aforo');
  assert.equal(destinoValido('/mi-espacio'), '/mi-espacio');
});

test('una URL absoluta no pasa: sería un redirector abierto', () => {
  for (const malo of ['https://otro.com', 'http://otro.com/x', 'javascript:alert(1)']) {
    assert.equal(destinoValido(malo), null, `«${malo}» se guardaría como destino`);
  }
});

test('`//otro.com` tampoco, que es el que se cuela', () => {
  /* Empieza por «/» y el navegador lo lee como https://otro.com. Comprobar
     sólo la primera barra deja pasar justo éste. */
  assert.equal(destinoValido('//otro.com/robar'), null);
});

test('lo que no es texto no revienta, se ignora', () => {
  for (const raro of [null, undefined, 42, {}, []]) {
    assert.equal(destinoValido(raro), null);
  }
});

test('el INSERT se reintenta sin `link` si la columna no está', () => {
  /* El código y la base se despliegan por separado. Si el código llega primero
     y no hubiera reintento, el INSERT falla por una columna que no existe y se
     dejan de crear TODAS las notificaciones — el fallo original, otra vez. */
  const src = leer('lib/notificar.js');
  assert.match(src, /const sinLink = filas\.map\(\(\{ link, \.\.\.resto \}\) => resto\)/,
    'no hay reintento sin `link`: si el código sale antes que la 0102, no se crea ninguna notificación');
  assert.match(src, /0102/, 'el reintento no dice de qué migración depende');
});

test('un fallo del INSERT se dice, no se traga', () => {
  const src = leer('lib/notificar.js');
  assert.match(src, /avisar\(donde, error\)/,
    'volvió a tragarse el error: eso es lo que escondió el fallo durante meses');
});

test('la migración está escrita y es reversible', () => {
  const sql = leer('db/migrations/0102_notificacion_con_destino.sql');
  assert.match(sql, /add column if not exists link text/i);
  assert.match(sql, /Rollback/);
});
