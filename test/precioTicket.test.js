/* El precio de una boleta.
 *
 * ── Qué se protege aquí ──────────────────────────────────────────────────
 *
 * Dos cosas, y la primera es de dinero de verdad:
 *
 *  1. **El importe lo pone el servidor.** Si una ruta de cobro leyera el precio
 *     del cuerpo de la petición, cualquiera compraría a mil pesos cambiando un
 *     número en las herramientas del navegador — porque a la pasarela le
 *     decimos nosotros cuánto cobrar. Del cuerpo sale el CÓDIGO y nada más.
 *  2. **Una sola regla de precio.** `early_bird ? early_bird_precio : precio`
 *     estaba escrito en `routes/pagos.js`, otra vez en `routes/wompi.js` y una
 *     tercera en la pantalla pública. La copia de la pantalla es inevitable
 *     —hay que pintar algo antes de llamar— pero las dos del servidor no.
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

/* Sin comentarios: este archivo y los que revisa EXPLICAN lo que ya no se hace,
   y ese texto contiene justo las palabras que las pruebas prohíben. Un
   comentario que cuenta lo que no se hace no puede contar como haberlo hecho. */
function sinComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

const COBRO = ['routes/pagos.js', 'routes/wompi.js'];

test('ninguna ruta de cobro coge el importe del cuerpo de la petición', () => {
  for (const f of COBRO) {
    const src = sinComentarios(leer(f));
    /* `req.body.precio`, `body.monto`, `body.amount`… en cualquier forma. */
    const malo = src.match(/req\.body\.(precio|monto|amount|total|importe)\b/g);
    assert.equal(malo, null, `${f} lee el importe del cuerpo: ${malo}`);
  }
});

test('las rutas de cobro sí aceptan el código, que es lo único que puede venir de fuera', () => {
  for (const f of COBRO) {
    assert.match(sinComentarios(leer(f)), /req\.body\.promocion_codigo/,
      `${f} no acepta un código de descuento: la promoción no llega al cobro`);
  }
});

test('la regla del early bird se escribe una sola vez en el servidor', () => {
  const copias = [];
  for (const f of fs.readdirSync(path.join(RAIZ, 'routes'))) {
    if (!f.endsWith('.js')) continue;
    /* La expresion concreta, no las dos palabras sueltas: un `select` que
       nombra la columna `early_bird_hasta` no es una copia de la regla. La
       primera version de esta prueba aplanaba el archivo en una sola linea y
       el `.*` cruzaba de la linea 438 a la 1114 - senalaba a un archivo que ya
       estaba arreglado. */
    if (/early_bird_hasta\)\s*>\s*new Date\(\)/.test(sinComentarios(leer(`routes/${f}`))))
      copias.push(`routes/${f}`);
  }
  assert.deepEqual(copias, [], `la regla del early bird está copiada en: ${copias.join(', ')}`);
  assert.match(leer('lib/precioTicket.js'), /early_bird_hasta/,
    'y donde debería estar, no está');
});

test('el uso de la promoción se cuenta al pagar, no al abrir el checkout', () => {
  assert.match(sinComentarios(leer('lib/confirmarTicket.js')), /consumirPromocion/,
    'nadie cuenta el uso cuando entra el dinero');
  for (const f of COBRO) {
    assert.doesNotMatch(sinComentarios(leer(f)), /consumirPromocion/,
      `${f} cuenta el uso al abrir el checkout: diez que miran y se van agotan el código`);
  }
});

test('validar y cobrar usan la misma función, no dos copias de las condiciones', () => {
  const val = sinComentarios(leer('routes/promociones.js'));
  assert.match(val, /precioDeCompra/, 'el validar público tiene su propia copia de las reglas');
  assert.doesNotMatch(val, /vigente_desde.*<=.*ahora/s,
    'el validar público sigue comprobando la vigencia por su cuenta');
});

test('el cálculo del descuento sale de la tabla, y no deja precios negativos', () => {
  const src = leer('lib/precioTicket.js');
  assert.match(src, /promocion\.tipo === 'fijo'/, 'no distingue descuento fijo de porcentaje');
  assert.match(src, /Math\.max\(0/, 'un descuento mayor que el precio dejaría un importe negativo');
});

test('la migración que hace falta está escrita y es reversible', () => {
  const sql = leer('db/migrations/0099_promocion_en_la_compra.sql');
  assert.match(sql, /add column if not exists promocion_id/, 'no añade dónde guardar la promoción');
  assert.match(sql, /create or replace function public\.promocion_consumir/, 'no crea el contador atómico');
  assert.match(sql, /Rollback/, 'sin rollback escrito');
});
