/* Tres listas del panel se cortaban en silencio.
 *
 *   asistentes              de 100 en 100, y el panel no mandaba página ni la
 *                           enseñaba. Con 386 boletas se veían las primeras
 *                           100 y la lista simplemente terminaba.
 *   inscritos de un taller  tope de 500, sin decirlo
 *   auditoría del evento    tope de 100, sin decirlo — que en un evento con
 *                           equipo es un día, así que «quién tocó qué»
 *                           contestaba sobre hoy y parecía contestar sobre el
 *                           evento entero
 *
 * Una lista que se corta sin avisar es peor que un error y peor que una lista
 * vacía: el error se arregla, el vacío se nota, y esto se cree. Quien buscaba a
 * alguien de la mitad concluía que no estaba inscrito.
 *
 * Y cada una tenía su propio saneado a mano, cada uno distinto. Tres copias es
 * cómo nace la cuarta lista otra vez sin paginar.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const { tramoPedido, datosDelTramo, paraBuscar, POR_PAGINA, MAXIMO } = require('../lib/tramoDeLista.js');

/* ── El saneado, una vez ─────────────────────────────────────────────── */

test('sin pedir nada, una página de 50', () => {
  assert.deepEqual(tramoPedido({}), { porPagina: 50, pagina: 1, desde: 0, hasta: 49 });
  assert.equal(POR_PAGINA, 50);
});

test('la página tres son las filas 100 a 149', () => {
  const t = tramoPedido({ limit: 50, page: 3 });
  assert.equal(t.desde, 100);
  assert.equal(t.hasta, 149);
});

test('lo que no es un número no revienta la consulta', () => {
  /* `(Number(page) - 1) * Number(limit)` con `page=abc` da `NaN`, y
     `range(NaN, NaN)` no devuelve una lista vacía: rompe la consulta. Un
     parámetro raro en la URL tumbaba la pantalla entera. */
  const raros = [{ page: 'abc' }, { page: 0 }, { page: -5 }, { page: '' }, { page: 1.7 },
    { limit: 'x' }, { limit: 0 }, { limit: -1 }, { limit: null }, {}];
  for (const raro of raros) {
    const t = tramoPedido(raro);
    assert.ok(Number.isInteger(t.desde) && t.desde >= 0, `desde inválido con ${JSON.stringify(raro)}`);
    assert.ok(Number.isInteger(t.hasta) && t.hasta >= t.desde, `hasta inválido con ${JSON.stringify(raro)}`);
    assert.ok(Number.isInteger(t.porPagina) && t.porPagina > 0, `porPagina inválido con ${JSON.stringify(raro)}`);
  }
});

test('hay tope, y una lista puede pedir el suyo sin reescribir la aritmética', () => {
  assert.equal(tramoPedido({ limit: 99999 }).porPagina, MAXIMO);
  /* El panel recorre la lista entera por tandas de 200 para armar el PDF de
     asistentes: si el tope bajara de ahí, ese PDF empezaría a salir corto. */
  assert.equal(tramoPedido({ limit: 200 }).porPagina, 200);
  /* Y el por-defecto de una lista concreta nunca puede saltarse el tope. */
  assert.equal(tramoPedido({}, { porDefecto: 5000, tope: 200 }).porPagina, 200);
  assert.equal(tramoPedido({}, { porDefecto: 25 }).porPagina, 25);
});

test('lo que se devuelve deja claro cuánta lista queda', () => {
  const t = tramoPedido({ limit: 50, page: 8 });
  assert.deepEqual(datosDelTramo(t, 386), { total: 386, pagina: 8, por_pagina: 50, paginas: 8 });
  /* Una lista vacía es UNA página, no cero: «página 1 de 0» no significa nada. */
  assert.equal(datosDelTramo(tramoPedido({}), 0).paginas, 1);
  /* Y un total que no llega no se convierte en `NaN` páginas. */
  assert.equal(datosDelTramo(tramoPedido({}), undefined).paginas, 1);
  assert.equal(datosDelTramo(tramoPedido({}), null).total, 0);
});

test('una coma en la búsqueda ya no devuelve un 400', () => {
  /* La coma separa las condiciones de un `or()` de PostgREST y los paréntesis
     lo delimitan: buscar «Pérez, Juan» rompía la consulta entera. */
  for (const c of [',', '(', ')', '"', '\\']) {
    assert.doesNotMatch(paraBuscar(`ana${c}luis`), new RegExp(`\\${c}`),
      `«${c}» sigue llegando al filtro`);
  }
  assert.equal(paraBuscar('Pérez, Juan'), 'Pérez% Juan');
  assert.ok(paraBuscar('x'.repeat(500)).length <= 120);
});

/* ── Y las tres listas la usan ───────────────────────────────────────── */

const LISTAS = [
  { archivo: 'routes/clientes.js', desde: "router.get('/:eventoId/clientes'", hasta: 'ESTADOS_QUE_OCUPAN' },
  { archivo: 'routes/sesiones.js', desde: "/inscripciones'", hasta: 'Marcar asistencia a UN sub-evento' },
  { archivo: 'routes/auditoria.js', desde: "router.get('/:eventoId/auditoria'", hasta: 'module.exports' },
];

for (const l of LISTAS) {
  test(`${l.archivo.split('/').pop()} sirve por tramos y dice cuántas hay`, () => {
    const src = leer(l.archivo);
    const ruta = src.slice(src.indexOf(l.desde), src.indexOf(l.hasta));
    assert.ok(ruta.length > 100, 'no se encontró la ruta: cambió el ancla de esta prueba');

    assert.match(ruta, /tramoPedido\(req\.query\)/, 'sanea el tramo a mano o no lo sanea');
    assert.match(ruta, /\.range\(tramo\.desde, tramo\.hasta\)/, 'sigue usando `.limit()`, que corta sin decirlo');
    assert.match(ruta, /count: 'exact'/, 'sin el total no se puede saber si hay más');
    assert.match(ruta, /datosDelTramo\(tramo, count\)/, 'no dice en qué tramo va');

    /* Y ninguna vuelve a tener su propio `Math.min(Number(limit) || …)`: es de
       donde salían los tres topes distintos. */
    assert.doesNotMatch(ruta, /Math\.min\(Number\(req\.query\.limit\)/,
      'volvió el saneado a mano, con su propio tope');
  });
}

test('nadie interpola la búsqueda sin sanearla', () => {
  for (const f of ['routes/clientes.js', 'routes/sesiones.js', 'routes/auditoria.js']) {
    const src = leer(f);
    assert.doesNotMatch(src, /ilike\.%\$\{q\}%/, `${f} interpola \`q\` cruda en un or()`);
    assert.doesNotMatch(src, /ilike\('[a-z_]+', `%\$\{q\}%`\)/, `${f} interpola \`q\` cruda en un ilike`);
  }
});

test('el filtro de la auditoría se ofrece con lo que hay, no con una lista a mano', () => {
  /* Una lista de acciones posibles escrita a mano acaba ofreciendo una que ya
     nadie escribe y faltándole la nueva — el modo de fallo del proyecto. Se
     leen las que existen en el evento. */
  const src = leer('routes/auditoria.js');
  assert.match(src, /new Set\(\(vistas \|\| \[\]\)\.map\(v => v\.accion\)/);
  assert.match(src, /acciones,/, 'no viajan al panel: el filtro no se puede pintar');
  /* Por acción EXACTA: un `ilike` sobre el vocabulario devolvería
     «boleta.borrar» buscando «borrar», incluido dentro del correo del actor. */
  assert.match(src, /query\.eq\('accion', accion\)/);
});
