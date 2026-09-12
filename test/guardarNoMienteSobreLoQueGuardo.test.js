'use strict';

/* Guardar un evento no puede decir que guardó lo que descartó.
 *
 * ── El fallo ─────────────────────────────────────────────────────────────
 *
 * `PATCH /eventos/:id` filtra los campos que tu rol no abre y responde 200.
 * Quien cambiaba la portada junto al título veía «Guardado», el título
 * cambiaba, y la portada se quedaba igual.
 *
 * Medido en producción: 102 roles pueden editar el evento y 34 de ellos no
 * tienen `gestionar_imagenes`, que es el único que abre `cover_url`.
 *
 * Es la peor forma del fallo de siempre en esta base. Los otros esconden una
 * función a quien puede usarla —molesto, pero visible en cuanto alguien
 * pregunta «¿dónde se hace esto?»—. Éste dice que guardó algo que no guardó, y
 * no hay ninguna pregunta que lo destape: se descubre mirando la portada un mes
 * después.
 *
 * ── Por qué no basta con rechazar lo no permitido ────────────────────────
 *
 * Diez pantallas mandan el evento ENTERO para tocar una cosa —el plano, los
 * stands, la acreditación—. Funcionan porque lo que no pueden tocar llega con
 * el mismo valor que ya está guardado. Rechazar por mandarlo las rompería
 * todas, así que la pregunta es si CAMBIARÍA algo.
 *
 * Lo que se vigila aquí es esa frontera: que ningún falso «sí cambió»
 * convierta un guardado que hoy funciona en un 403.
 *
 * Correr: npm test */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mismoValor, loQueDeVerdadCambia, canonico } = require('../lib/mismoValor.js');

test('lo que llega igual que está guardado no cambia nada', () => {
  /* El caso de las diez pantallas: mandan el evento entero sin tocar lo suyo. */
  assert.ok(mismoValor('Feria del Libro', 'Feria del Libro'));
  assert.ok(mismoValor(null, null));
});

test('los tres falsos «sí cambió» que romperían pantallas que hoy funcionan', () => {
  /* 1 · la base guarda null, el formulario manda '' */
  assert.ok(mismoValor(null, ''), 'null y cadena vacía son la misma ausencia');
  assert.ok(mismoValor(undefined, ''));

  /* 2 · un input de número manda texto */
  assert.ok(mismoValor(120, '120'));
  assert.ok(mismoValor(1.5, '1.50'));

  /* 3 · el mismo objeto con las claves en otro orden */
  assert.ok(mismoValor({ a: 1, b: 2 }, { b: 2, a: 1 }));
  assert.ok(mismoValor({ x: { p: 1, q: 2 } }, { x: { q: 2, p: 1 } }));

  /* Y una fecha escrita de dos maneras es el mismo instante */
  assert.ok(mismoValor('2026-09-18T10:00:00Z', '2026-09-18T10:00:00.000Z'));
});

test('y lo que sí es un cambio se ve como un cambio', () => {
  assert.ok(!mismoValor('Feria', 'Feria del Libro'));
  assert.ok(!mismoValor(null, 'algo'));
  assert.ok(!mismoValor('', 'algo'), 'poner valor donde no había es un cambio');
  assert.ok(!mismoValor('algo', ''), 'vaciar un campo también');
  assert.ok(!mismoValor(120, 121));

  /* En una lista el orden es el que se ve en pantalla: moverlo es un cambio. */
  assert.ok(!mismoValor(['a', 'b'], ['b', 'a']));

  /* Y un objeto con una clave de más, aunque las comunes coincidan. */
  assert.ok(!mismoValor({ a: 1 }, { a: 1, b: 2 }));

  /* `0` y `false` no son «vacío»: son valores. */
  assert.ok(!mismoValor(0, ''));
  assert.ok(!mismoValor(false, ''));
  /* Un booleano y su texto SÍ son lo mismo: un `<select>` manda 'false' y la
     columna guarda false, y llamar a eso un cambio rompería el guardado. */
  assert.ok(mismoValor(false, 'false'));
  assert.ok(mismoValor(true, 'true'));
  /* Pero un booleano y un número no: `true` y `1` se parecen en JavaScript y no
     son el mismo valor guardado. */
  assert.ok(!mismoValor(true, 1), 'un booleano no es un número');
});

test('«marzo» no es una fecha, y dos textos distintos no se vuelven iguales', () => {
  /* `Date.parse` acepta cosas raras. Si se dejara suelto, dos textos que no
     tienen nada que ver pasarían por el mismo instante y un cambio de verdad se
     guardaría en silencio — el fallo al revés. */
  assert.ok(!mismoValor('marzo', 'abril'));
  assert.ok(!mismoValor('5', 'mayo'));
});

test('loQueDeVerdadCambia nombra sólo lo que cambia', () => {
  const guardado = { cover_url: 'https://a/1.jpg', titulo: 'Feria', aforo_total: 500 };
  const entrante = { cover_url: 'https://a/2.jpg', titulo: 'Feria', aforo_total: '500' };
  assert.deepEqual(
    loQueDeVerdadCambia(['cover_url', 'titulo', 'aforo_total'], entrante, guardado),
    ['cover_url'],
    'el título no cambió y el aforo llegó como texto: sólo la portada es un cambio');
});

test('la ruta rechaza entero, y sin poder tumbar el guardado', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'eventos.js'), 'utf8');
  const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(sinComentarios, /const noPermitidos = CAMPOS_EDITABLES\.filter/,
    'la ruta ya no mira qué se mandó sin permiso');
  assert.match(sinComentarios, /res\.status\(403\)/,
    'lo que no se puede cambiar vuelve a descartarse en silencio');
  assert.match(sinComentarios, /No se guardó nada\./,
    'el mensaje no dice que no se guardó nada: a medias es peor');

  /* La consulta extra va aparte y con red. Metida en el `select` de arriba,
     una columna que falte —un despliegue sin su migración— rompería el select
     y con él la pantalla de editar. Una comprobación de más no puede ser lo
     que tumbe el guardado. */
  const i = sinComentarios.indexOf('const noPermitidos');
  const zona = sinComentarios.slice(i, i + 900);
  assert.match(zona, /try \{/, 'la consulta de comprobación no está protegida');
  assert.match(zona, /if \(guardado\) \{/,
    'si la comprobación no se puede hacer, tiene que seguirse como siempre');
});

test('el mensaje nombra los campos en palabras', () => {
  /* «No autorizado» no se puede ni preguntar. «No puedes cambiar la portada»
     dice qué quitar para que el guardado pase. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'eventos.js'), 'utf8');
  assert.match(src, /cover_url: 'la portada'/);
  assert.match(src, /function enPalabras/);
  /* Y los que no estén en la tabla caen a su nombre técnico, que es feo pero
     cierto: mejor un nombre que se puede buscar que ninguno. */
  assert.match(src, /NOMBRE_DEL_CAMPO\[c\] \|\| c/);
});

test('una lista vacía y un campo sin poner son lo mismo', () => {
  /* Cierra el cuarto falso «sí cambió»: la base con null y el formulario
     mandando `[]`. Hoy no pasa —los 15 eventos guardan `[]`, ninguno null— pero
     un evento nuevo o una columna futura lo traería, y sería un 403 donde hoy
     se guarda bien. */
  assert.ok(mismoValor(null, []));
  assert.ok(mismoValor(null, {}));
  assert.ok(mismoValor([], null));
  assert.ok(mismoValor({}, null));

  /* Y no esconde vaciar algo que tenía contenido, que sí es un cambio. */
  assert.ok(!mismoValor(['foto.jpg'], []));
  assert.ok(!mismoValor({ color: '#fff' }, {}));
});
