/* Tests de la comparación entre Supabase y MySQL.

   Lo que se protege es la NORMALIZACIÓN, que es donde este script acierta o se
   vuelve inservible:

     · Si normaliza de menos, cada fila sale como diferente —los dos motores
       escriben las fechas y el JSON distinto— y el informe no dice nada.
     · Si normaliza de más, se come diferencias de verdad. Un texto truncado a
       255 o un null convertido en cadena vacía pasarían por iguales, que es
       exactamente lo que hay que cazar.

   Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { normalizar, ordenarClaves, huellaFila, TABLAS } = require('../scripts/comparar-bases.js');

/* ── Lo que SÍ tiene que igualar ──────────────────────────────────────── */

test('la misma fecha escrita por los dos motores es la misma', () => {
  /* Postgres devuelve `2026-09-01 10:00:00+00`; MySQL, `2026-09-01 10:00:00.000000`. */
  const pg = normalizar('2026-09-01 10:00:00+00');
  const my = normalizar('2026-09-01 10:00:00.000000');
  assert.equal(pg, my, `${pg} ≠ ${my}`);
});

test('un booleano y su TINYINT(1) son lo mismo', () => {
  assert.equal(normalizar(true), normalizar(1));
  assert.equal(normalizar(false), normalizar(0));
});

test('el mismo JSON con las claves en otro orden es el mismo dato', () => {
  /* Ningún motor garantiza el orden al devolverlo. */
  assert.equal(normalizar({ b: 2, a: 1 }), normalizar({ a: 1, b: 2 }));
  assert.equal(normalizar('{"b":2,"a":1}'), normalizar({ a: 1, b: 2 }));
});

test('el orden de claves se iguala también en profundidad', () => {
  const uno = { z: { y: 1, x: 2 }, a: [{ q: 1, p: 2 }] };
  const dos = { a: [{ p: 2, q: 1 }], z: { x: 2, y: 1 } };
  assert.equal(normalizar(uno), normalizar(dos));
});

test('un arreglo de Postgres y su JSON de MySQL son lo mismo', () => {
  assert.equal(normalizar(['a', 'b']), normalizar('["a","b"]'));
});

/* ── Lo que NO puede igualar ──────────────────────────────────────────── */

test('null NO es cadena vacía', () => {
  /* «No contestó» y «contestó vacío» son cosas distintas, y distinguirlas es
     parte de lo que se está vigilando. */
  assert.notEqual(normalizar(null), normalizar(''));
  assert.equal(normalizar(null), null);
});

test('un texto truncado NO pasa por igual', () => {
  /* El fallo clásico: una columna que en MySQL quedó VARCHAR(255) y en
     Postgres era TEXT. El conteo de filas cuadra y el dato está cortado. */
  const largo = 'x'.repeat(300);
  assert.notEqual(normalizar(largo), normalizar(largo.slice(0, 255)));
});

test('los espacios al final y las mayúsculas cuentan como diferencia', () => {
  /* No se normalizan a propósito: si la carga los cambió, eso es real. */
  assert.notEqual(normalizar('Ana '), normalizar('Ana'));
  assert.notEqual(normalizar('ANA'), normalizar('Ana'));
});

test('dos fechas que difieren en un segundo son distintas', () => {
  assert.notEqual(
    normalizar('2026-09-01 10:00:00+00'),
    normalizar('2026-09-01 10:00:01+00'),
  );
});

test('un número y su texto NO se confunden', () => {
  /* Una columna numérica cargada como texto es un fallo de la migración. */
  assert.notEqual(normalizar(10), normalizar('10'));
});

/* ── La huella ────────────────────────────────────────────────────────── */

test('dos filas equivalentes dan la misma huella aunque vengan distintas', () => {
  const cols = ['id', 'nombre', 'activo', 'creado', 'datos'];
  const pg = { id: 1, nombre: 'Ana', activo: true,  creado: '2026-09-01 10:00:00+00',      datos: { b: 2, a: 1 } };
  const my = { id: 1, nombre: 'Ana', activo: 1,     creado: '2026-09-01 10:00:00.000000',  datos: '{"a":1,"b":2}' };
  assert.equal(huellaFila(pg, cols), huellaFila(my, cols));
});

test('cambiar UNA columna cambia la huella', () => {
  const cols = ['id', 'nombre'];
  assert.notEqual(
    huellaFila({ id: 1, nombre: 'Ana' }, cols),
    huellaFila({ id: 1, nombre: 'Ana María' }, cols),
  );
});

test('la huella sólo mira las columnas que se le dan', () => {
  /* Una columna de más en MySQL no puede contar como diferencia: las que
     mandan son las que la aplicación lee hoy. */
  const cols = ['id', 'nombre'];
  assert.equal(
    huellaFila({ id: 1, nombre: 'Ana' }, cols),
    huellaFila({ id: 1, nombre: 'Ana', columna_extra: 'da igual' }, cols),
  );
});

test('ordenarClaves no pierde ni inventa nada', () => {
  const original = { z: 1, a: { c: 3, b: [1, { y: 2, x: 1 }] } };
  const ordenado = ordenarClaves(original);
  assert.deepEqual(
    JSON.parse(JSON.stringify(ordenado)),
    JSON.parse(JSON.stringify(original)),
    'mismo contenido, sólo cambia el orden',
  );
});

test('la lista de tablas no tiene repetidos', () => {
  /* Una tabla repetida se compararía dos veces y doblaría el tiempo de un
     script que ya es lento. */
  assert.equal(new Set(TABLAS).size, TABLAS.length);
  assert.ok(TABLAS.includes('eventos') && TABLAS.includes('tickets'));
});
