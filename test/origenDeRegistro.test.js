/* De dónde vino cada inscripción.
 *
 * El organizador pega el botón en su web, en un correo, en el Instagram de la
 * alcaldía y en el WhatsApp del gremio — y después no sabe cuál le trajo
 * gente. Sin esto, los botones son cuatro copias del mismo enlace: se pegan
 * una vez y se olvidan.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { limpiarOrigen } = require('../lib/origenDeRegistro.js');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');

test('dos formas de escribir el mismo canal cuentan como uno', () => {
  /* Si «Botón Home» y «boton-home» se guardaran distinto, el informe partiría
     un canal en dos y ninguno parecería funcionar. */
  assert.equal(limpiarOrigen('Botón Home'), 'boton-home');
  assert.equal(limpiarOrigen('boton-home'), 'boton-home');
  assert.equal(limpiarOrigen('  BOTON   HOME  '), 'boton-home');
});

test('lo que no sobrevive a una URL se cae', () => {
  assert.equal(limpiarOrigen('<script>'), 'script');
  assert.equal(limpiarOrigen('a/b?c=d'), 'a-b-c-d');
  assert.equal(limpiarOrigen('---'), null, 'un origen que se queda en nada es «directo», no una cadena vacía');
});

test('un origen imposible no tumba la compra', () => {
  /* Llega de la URL, o sea de fuera. Lo peor que puede pasar es que esa
     inscripción cuente como directa; rechazar la compra por eso sería perder
     una venta por una etiqueta. */
  assert.equal(limpiarOrigen(null), null);
  assert.equal(limpiarOrigen(12345), null);
  assert.equal(limpiarOrigen('x'.repeat(200)).length, 40);
});

test('los tres caminos de compra guardan el origen', () => {
  /* Si sólo lo guardara uno, un botón que lleva a una boleta de pago parecería
     no traer a nadie — y es justo el que más importa medir. */
  for (const [archivo, donde] of [
    ['routes/eventos.publicos.js', 'la reserva'],
    ['routes/pagos.js', 'Mercado Pago'],
    ['routes/wompi.js', 'Wompi'],
  ]) {
    const src = leer(archivo);
    assert.match(src, /limpiarOrigen\(req\.body\.origen\)/, `${donde} dejó de guardar el origen`);
  }
});

test('la limpieza vive en UN sitio', () => {
  /* Tres copias acabarían aceptando cosas distintas, y entonces el mismo botón
     contaría como dos canales según por dónde comprara la gente. */
  const usos = ['routes/eventos.publicos.js', 'routes/pagos.js', 'routes/wompi.js']
    .filter(f => leer(f).includes("require('../lib/origenDeRegistro.js')"));
  assert.equal(usos.length, 3, 'alguna ruta se escribió su propia limpieza');
});

test('«directo» se cuenta aparte y por su nombre', () => {
  /* Quien llegó a la página sin pasar por un botón es la mayoría. Meterlo con
     los demás, o esconderlo, daría dos cuadros distintos de la misma realidad. */
  const src = leer('routes/clientes.js');
  assert.match(src, /const k = t\.origen \|\| '__directo__';/);
  assert.match(src, /origen: t\.origen \|\| null/,
    'el «directo» dejó de distinguirse de un origen llamado literalmente así');
});

test('las pagadas se cuentan aparte de las totales', () => {
  /* Un botón que trae cien reservas sin pagar y otro que trae diez pagadas no
     son lo mismo, y el número grande es el que engaña. */
  const src = leer('routes/clientes.js');
  assert.match(src, /if \(t\.estado === 'pagado' \|\| t\.estado === 'usado'\)/);
});

test('la migración es aditiva', () => {
  const sql = leer('db/migrations/0111_de_donde_vino_la_inscripcion.sql');
  assert.match(sql, /add column if not exists origen text/);
  const soloSql = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(soloSql, /drop column/i);
  assert.match(sql, /-- Vuelta atrás/);
});
