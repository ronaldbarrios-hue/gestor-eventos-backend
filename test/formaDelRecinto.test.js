/* La forma del recinto: arcos, bloques y colores.
 *
 * Una cuadrícula no es un recinto. En un teatro las filas son arcos que miran
 * al escenario, y en un estadio lo primero que se ve son bloques de color, no
 * sillas. Esto comprueba la geometría que lo hace posible.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../lib/geometriaDelPlano.js');

const cerca = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

/* ── El arco ──────────────────────────────────────────────────────────── */

test('un arco de una silla la deja en el eje, sin repartir nada', () => {
  const [p] = g.puntosDeArco({ cuantas: 1, cx: 0, cy: 0, r: 100, mirandoA: 'arriba' });
  cerca(p.x, 0);
  cerca(p.y, -100);
});

test('mirando arriba, la fila curva queda POR ENCIMA del centro', () => {
  /* En SVG la `y` crece hacia abajo. Es el error que se comete al escribir el
     segundo generador, y con él las sillas salen boca abajo. */
  const puntos = g.puntosDeArco({ cuantas: 9, cx: 0, cy: 0, r: 200, abertura: 90 });
  for (const p of puntos) assert.ok(p.y < 0, `y=${p.y} debería estar arriba`);
});

test('todas las sillas del arco están a la misma distancia del centro', () => {
  const puntos = g.puntosDeArco({ cuantas: 12, cx: 50, cy: 80, r: 300, abertura: 120 });
  for (const p of puntos) cerca(Math.hypot(p.x - 50, p.y - 80), 300);
});

test('la abertura se reparte entera: de un extremo al otro', () => {
  const puntos = g.puntosDeArco({ cuantas: 5, cx: 0, cy: 0, r: 100, abertura: 80 });
  const ang = (p) => (Math.atan2(p.y, p.x) * 180) / Math.PI;
  cerca(ang(puntos[0]), -130);
  cerca(ang(puntos[4]), -50);
});

test('cada silla sale girada para mirar al centro', () => {
  /* Sin `rot`, las sillas de los extremos quedan torcidas respecto a su fila —
     que es justo lo que delata un plano generado. */
  const puntos = g.puntosDeArco({ cuantas: 3, cx: 0, cy: 0, r: 100, abertura: 60 });
  cerca(puntos[0].rot, -30);
  cerca(puntos[1].rot, 0);   // la del centro no gira
  cerca(puntos[2].rot, 30);
});

test('las cuatro direcciones dan cuatro arcos distintos', () => {
  const uno = (mirandoA) => g.puntosDeArco({ cuantas: 1, r: 100, mirandoA })[0];
  cerca(uno('arriba').y, -100);
  cerca(uno('abajo').y, 100);
  cerca(uno('izquierda').x, -100);
  cerca(uno('derecha').x, 100);
});

test('una dirección inventada no rompe el plano: cae en «arriba»', () => {
  cerca(g.puntosDeArco({ cuantas: 1, r: 100, mirandoA: 'noroeste' })[0].y, -100);
});

test('cuantas inválido devuelve nada, no sillas en el origen', () => {
  /* Sillas todas en (0,0) serían un plano que parece vacío y no lo está. */
  for (const c of [0, -3, 2.5, null, 'ocho']) {
    assert.deepEqual(g.puntosDeArco({ cuantas: c }), [], String(c));
  }
});

/* ── El abanico ───────────────────────────────────────────────────────── */

test('las filas de atrás tienen más sillas, como en un teatro', () => {
  const filas = g.sillasEnAbanico({ filas: 4, radioPrimera: 200, abertura: 90 });
  assert.equal(filas.length, 4);
  for (let i = 1; i < filas.length; i++) {
    assert.ok(filas[i].length > filas[i - 1].length,
      `fila ${i} (${filas[i].length}) no tiene más que la ${i - 1} (${filas[i - 1].length})`);
  }
});

test('quien numera a mano puede fijar las sillas por fila', () => {
  const filas = g.sillasEnAbanico({ filas: 3, porFila: 10, radioPrimera: 200 });
  for (const f of filas) assert.equal(f.length, 10);
});

test('cada silla sabe su fila y su número', () => {
  const filas = g.sillasEnAbanico({ filas: 2, porFila: 3, radioPrimera: 200 });
  assert.deepEqual(filas[1].map(s => s.numero), [1, 2, 3]);
  assert.equal(filas[1][0].fila, 1);
});

test('las filas se alejan del escenario, no se encaraman', () => {
  const filas = g.sillasEnAbanico({ filas: 3, porFila: 5, radioPrimera: 200, separacion: 40 });
  const dist = (s) => Math.hypot(s.x, s.y);
  cerca(dist(filas[0][2]), 200);
  cerca(dist(filas[2][2]), 280);
});

/* ── Los bloques ──────────────────────────────────────────────────────── */

test('un rectángulo se guarda como polígono, no como x/y/ancho/alto', () => {
  /* Dos representaciones del mismo bloque acaban divergiendo. */
  const r = g.rectangulo({ x: 10, y: 20, ancho: 100, alto: 50 });
  assert.deepEqual(r.puntos, [[10, 20], [110, 20], [110, 70], [10, 70]]);
  assert.equal(g.formaDe(r), 'poligono');
});

test('un bloque curvo va por dentro y vuelve por fuera, sin cruzarse', () => {
  /* Al revés sale un lazo, que se dibuja como un nudo. */
  const b = g.bloqueCurvo({ rInterior: 100, rExterior: 200, desde: -30, hasta: 30, pasos: 4 });
  const d = (p) => Math.hypot(p[0], p[1]);
  const mitad = b.puntos.length / 2;
  for (let i = 0; i < mitad; i++) cerca(d(b.puntos[i]), 100);
  for (let i = mitad; i < b.puntos.length; i++) cerca(d(b.puntos[i]), 200);
});

test('sillas y bloques comparten eje: el recinto no sale girado 90 grados', () => {
  /* La trampa que no cazó ninguna prueba y sí cazó mirar el dibujo: las dos
     funciones hablaban en grados, pero las sillas contaban desde «arriba» y los
     bloques desde «la derecha». Cada una era correcta por separado; juntas, la
     gradería salía girada respecto a su propio patio de butacas. */
  const silla = g.puntosDeArco({ cuantas: 1, r: 300, mirandoA: 'arriba' })[0];
  const bloque = g.bloqueCurvo({ rInterior: 300, rExterior: 320, desde: 0, hasta: 0, pasos: 1 });
  cerca(bloque.puntos[0][0], silla.x);
  cerca(bloque.puntos[0][1], silla.y);

  /* Y con las cuatro direcciones, no sólo con la de por defecto. */
  for (const dir of ['arriba', 'abajo', 'izquierda', 'derecha']) {
    const s = g.puntosDeArco({ cuantas: 1, r: 200, mirandoA: dir })[0];
    const b = g.bloqueCurvo({ rInterior: 200, rExterior: 210, desde: 0, hasta: 0, pasos: 1, mirandoA: dir });
    cerca(b.puntos[0][0], s.x, 1);
    cerca(b.puntos[0][1], s.y, 1);
  }
});

/* ── Qué forma tiene cada cosa ────────────────────────────────────────── */

test('formaDe reconoce las dos formas y no se inventa una tercera', () => {
  assert.equal(g.formaDe({ x: 0, y: 0 }), 'punto');
  assert.equal(g.formaDe({ puntos: [[0, 0], [1, 0], [1, 1]] }), 'poligono');
  /* Lo que no se reconoce es null y no un error: un plano con una forma rara se
     dibuja sin ella, no se cae. */
  assert.equal(g.formaDe(null), null);
  assert.equal(g.formaDe({}), null);
  assert.equal(g.formaDe({ puntos: [[0, 0], [1, 1]] }), null);  // dos puntos no son un área
  assert.equal(g.formaDe({ x: 'ocho', y: 2 }), null);
});

/* ── El encuadre ──────────────────────────────────────────────────────── */

test('el encuadre abarca puntos y polígonos a la vez', () => {
  const caja = g.encuadre([
    { geometria: { x: 100, y: 100 } },
    { geometria: { puntos: [[0, 0], [50, 0], [50, 40]] } },
  ], 0);
  assert.equal(caja.x, 0);
  assert.equal(caja.y, 0);
  assert.equal(caja.w, 100 + g.LADO);
  assert.equal(caja.h, 100 + g.LADO);
});

test('sin nada dibujable no hay encuadre, y quien llama enseña la lista', () => {
  assert.equal(g.encuadre([]), null);
  assert.equal(g.encuadre([{ geometria: null }, { geometria: {} }]), null);
});

test('un punto con coordenadas rotas no arrastra el encuadre al infinito', () => {
  const caja = g.encuadre([
    { geometria: { x: 10, y: 10 } },
    { geometria: { puntos: [[0, 0], ['x', 5], [20, 20]] } },
  ], 0);
  assert.ok(Number.isFinite(caja.w) && Number.isFinite(caja.h));
});

/* ── El color, que es el precio ───────────────────────────────────────── */

test('siempre hay color: una localidad sin él se dibujaría invisible', () => {
  for (const i of [0, 3, 99, -1, null, 'dos']) {
    assert.match(g.colorPorDefecto(i), /^#[0-9A-Fa-f]{6}$/, String(i));
  }
});

test('la paleta da la vuelta en vez de quedarse sin colores', () => {
  assert.equal(g.colorPorDefecto(0), g.colorPorDefecto(g.PALETA.length));
});

test('sólo se guardan colores que el SVG entiende', () => {
  assert.equal(g.colorValido('#DC2626'), '#dc2626');
  assert.equal(g.colorValido(' #dc2626 '), '#dc2626');
  /* `red` y `rgb(…)` viajarían bien y romperían el día que alguien los compare
     o los pinte en un PDF. */
  assert.equal(g.colorValido('red'), null);
  assert.equal(g.colorValido('rgb(1,2,3)'), null);
  assert.equal(g.colorValido('#fff'), null);
  assert.equal(g.colorValido(null), null);
});

test('el paso de la rejilla lo sabe la geometría, no el dibujo', () => {
  /* Si sólo lo supiera el SVG, cambiarlo descolocaría los planos ya guardados. */
  assert.ok(g.PASO > g.LADO, 'sin pasillo entre sillas');
});
