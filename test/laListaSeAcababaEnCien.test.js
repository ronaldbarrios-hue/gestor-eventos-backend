/* La lista de asistentes se acababa en la 100 y no lo decía.
 *
 * El servidor servía de cien en cien y el panel no mandaba página ni la
 * enseñaba. En un evento de 386 boletas se veían las primeras 100 y la lista
 * simplemente terminaba: sin error, sin aviso, sin nada que dijera que había
 * 286 más. Quien buscaba a alguien de la mitad concluía que no estaba
 * inscrito — y eso es peor que un error, porque se actúa sobre ello.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://x';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'y';
const { _test } = require('../routes/clientes.js');
const { tramoPedido, paraBuscar, POR_PAGINA, MAXIMO_POR_PAGINA } = _test;

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
  /* Antes era `(Number(page) - 1) * Number(limit)`: con `page=abc` daba `NaN`,
     y `range(NaN, NaN)` no devuelve una lista vacía — rompe la consulta. Un
     parámetro raro en la URL tumbaba la pantalla entera. */
  for (const raro of [{ page: 'abc' }, { page: 0 }, { page: -5 }, { page: '' }, { limit: 'x' }, { limit: 0 }, { limit: -1 }]) {
    const t = tramoPedido(raro);
    assert.ok(Number.isInteger(t.desde) && t.desde >= 0, `desde inválido con ${JSON.stringify(raro)}`);
    assert.ok(Number.isInteger(t.hasta) && t.hasta >= t.desde, `hasta inválido con ${JSON.stringify(raro)}`);
    assert.ok(t.porPagina > 0);
  }
});

test('hay tope: nadie se trae el evento entero en una petición', () => {
  assert.equal(tramoPedido({ limit: 99999 }).porPagina, MAXIMO_POR_PAGINA);
  /* Y el tope deja sitio para la exportación por tandas del panel, que pide
     200 por vuelta para armar el PDF completo. */
  assert.equal(tramoPedido({ limit: 200 }).porPagina, 200);
});

test('una coma en la búsqueda ya no devuelve un 400', () => {
  /* La coma separa las condiciones de un `or()` de PostgREST: buscar
     «Pérez, Juan» rompía la consulta entera, en la cara de quien sólo estaba
     buscando a alguien. Los paréntesis la delimitan, así que también. */
  for (const c of [',', '(', ')', '"', '\\']) {
    assert.doesNotMatch(paraBuscar(`ana${c}luis`), new RegExp(`\\${c}`),
      `«${c}» sigue llegando al filtro`);
  }
  /* Se cambian por `%`, que en un `ilike` es «lo que sea»: así «Pérez, Juan»
     encuentra a «Pérez Juan». */
  assert.equal(paraBuscar('Pérez, Juan'), 'Pérez% Juan');
});

test('la búsqueda tiene un largo máximo', () => {
  assert.ok(paraBuscar('x'.repeat(500)).length <= 120);
});

test('nada de esto se queda sin usar en la ruta', () => {
  /* Un saneador que existe y no se llama es peor que no tenerlo: parece que
     el problema está resuelto. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes/clientes.js'), 'utf8').replace(/\r/g, '');
  const ruta = src.slice(src.indexOf("router.get('/:eventoId/clientes'"), src.indexOf('ESTADOS_QUE_OCUPAN'));
  assert.match(ruta, /tramoPedido\(req\.query\)/);
  assert.match(ruta, /paraBuscar\(q\)/);
  assert.doesNotMatch(ruta, /ilike\.%\$\{q\}%/, 'la búsqueda vuelve a interpolar lo que llegue sin sanear');

  /* Y la respuesta tiene que decir en qué tramo va, o el panel no puede
     pintar «51-100 de 386» ni saber si hay una página siguiente. */
  for (const clave of ['pagina,', 'por_pagina:', 'paginas:', 'total:']) {
    assert.ok(ruta.includes(clave), `la respuesta no dice ${clave}`);
  }
  /* Los tipos de boleta viajan con la lista: el filtro tiene que ofrecer
     exactamente los que esta consulta reconoce. */
  assert.match(ruta, /tipos: tipos \|\| \[\]/);
});
