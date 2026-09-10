/* Siete listas se cortaban en silencio.
 *
 *   asistentes              de 100 en 100, y el panel no mandaba página ni la
 *                           enseñaba. Con 386 boletas se veían las primeras
 *                           100 y la lista simplemente terminaba.
 *   inscritos de un taller  tope de 500, sin decirlo
 *   auditoría del evento    tope de 100, sin decirlo — que en un evento con
 *                           equipo es un día, así que «quién tocó qué»
 *                           contestaba sobre hoy y parecía contestar sobre el
 *                           evento entero
 *   registro de correos     tope de 100, y se viene aquí a preguntar «¿le
 *                           llegó a ésta?»
 *   historial de stands     tope de 100; un stand con cola escanea eso en una
 *                           tarde
 *   API pública (×2)        50 y 200, sin total — y quien lee es un programa,
 *                           que no sospecha
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
/* Sin comentarios: los comentarios de estas rutas explican por que NO se usa
   `!inner` y citan el `Math.min` viejo, asi que una prueba que los mide se
   pone verde midiendo la explicacion del arreglo en vez del arreglo. Ya ha
   pasado en este repo mas de una vez. */
const sinComentarios = (f) => leer(f)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
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
  /* El registro de correos. Un evento manda un correo por boleta, así que en
     uno de 400 personas los últimos cien son un cuarto — y aquí se viene con
     una pregunta concreta: «¿le llegó a ésta?». */
  { archivo: 'routes/emails.js', desde: "/emails/envios'", hasta: 'Estado de la cola' },
  /* El historial de los stands: un stand con cola escanea cien en una tarde. */
  { archivo: 'routes/interacciones.js', desde: "router.get('/:eventoId/interacciones'", hasta: 'expositores/ranking' },
];

/* La campana y la API pública se miden aparte: mantienen sus valores de
   siempre a propósito —cambiarlos le cambiaría la respuesta a integraciones que
   ya existen— así que no encajan en la comprobación de arriba. */

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

test('buscar en un taller mira también la boleta, no sólo la inscripción', () => {
  /* El CÓDIGO de la boleta vive sólo en `tickets`, y es por lo que se busca a
     alguien el día del taller: es lo que tiene en la mano. La pantalla lo
     ofrecía —«nombre, correo o código»— y filtrando sólo por las columnas de
     `sesion_inscripciones` no habría encontrado ni uno: un buscador que
     contesta «nadie» sobre una lista llena.
     (El nombre y el correo sí suelen estar copiados en la inscripción; buscar
     también por la boleta cubre las filas donde falten.) */
  const src = sinComentarios('routes/sesiones.js');
  const busca = src.slice(src.indexOf('if (q) {'), src.indexOf('const { data, count, error } = await query;'));
  assert.match(busca, /from\('tickets'\)/, 'no busca en las boletas: no se puede buscar por código');
  assert.match(busca, /codigo\.ilike/, 'no se puede buscar por código de boleta');
  assert.match(busca, /ticket_id\.in\./);
  /* Sin `!inner`: convertir la relación en obligatoria dejaría fuera a las
     inscripciones sin boleta, que existen a propósito —siempre llega quien
     aparece en el taller sin haber pasado por la entrada general—. */
  assert.doesNotMatch(busca, /!inner/);
  /* Y con tope: los ids viajan en la URL de PostgREST y una búsqueda de una
     letra casaría con el evento entero. */
  assert.match(busca, /\.limit\(200\)/);
});

test('la campana puede pedir la tanda siguiente sin alargarse para todos', () => {
  /* Nadie baja treinta avisos buscando uno viejo, así que el por-defecto sigue
     siendo 30: subirlo alargaría la campana de todo el mundo por una función
     que casi nadie usa. Lo que faltaba era poder pedir más y saber cuántos hay
     — para quien vuelve después de una semana fuera. */
  const src = leer('routes/notificaciones.js');
  assert.match(src, /tramoPedido\(req\.query, \{ porDefecto: 30, tope: 100 \}\)/);
  assert.match(src, /datosDelTramo\(tramo, total\)/);
  /* Y `no_leidas` sigue siendo el contador de NO leídas, no el total de la
     página: son dos números distintos y el de la campana es el primero. */
  assert.match(src, /no_leidas: count \?\? 0/);
});

test('la API pública dice cuántos hay, sin cambiarle la respuesta a nadie', () => {
  /* Aquí cortar en silencio es peor que en el panel: quien lee es un programa.
     Una persona que ve una lista cortada puede sospechar; un script que pide
     los asistentes, recibe 500 de 7.000 y no ve señal de que falten,
     sincroniza 500 y da el trabajo por hecho. */
  const src = leer('routes/api.js');
  assert.match(src, /tramoPedido\(req\.query, \{ porDefecto: 50, tope: 100 \}\)/, 'eventos cambió su tamaño de página');
  assert.match(src, /tramoPedido\(req\.query, \{ porDefecto: 200, tope: 500 \}\)/, 'asistentes cambió su tamaño de página');
  /* Los dos endpoints devuelven `meta`, y `data` se queda donde estaba: quien
     no mire `meta` recibe exactamente lo mismo que ayer. */
  assert.equal((src.match(/meta: datosDelTramo\(tramo, count\)/g) || []).length, 2);
  assert.doesNotMatch(src, /Math\.min\(Number\(req\.query\.limit\)/);
});

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
