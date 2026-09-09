/* El mapa de un concierto: tarima, general, tribunas y palcos.
 *
 * Un plano de boda son mesas y uno de teatro son butacas. Un concierto tiene su
 * propio vocabulario, y la prueba que más importa aquí es de FORMA: que el
 * recinto mire a su escenario. La primera versión lo dibujaba al revés —la
 * general daba la vuelta y pasaba por detrás de la tarima— y eso no lo caza un
 * `assert` sobre nombres: hay que medir dónde cae cada cosa.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { plantillaDeConcierto, PIEZAS, MEDIDAS } = require('../lib/recintoDeConcierto.js');
const geo = require('../lib/geometriaDelPlano.js');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');

const de = (esp, tipo) => esp.filter(e => e.tipo === tipo);
const puntos = (e) => e.geometria.puntos;
const ys = (e) => puntos(e).map(p => p[1]);

/* ── Lo que trae ──────────────────────────────────────────────────────── */

test('la plantilla trae tarima, general, tribunas y nada más si no se pide', () => {
  const { espacios } = plantillaDeConcierto({ anillos: 1, porAnillo: 4 });
  assert.equal(de(espacios, 'tarima').length, 1);
  assert.equal(de(espacios, 'pista').length, 2, 'la general nace partida en A y B');
  assert.equal(de(espacios, 'tribuna').length, 4);
  assert.equal(de(espacios, 'palco').length, 0);
});

test('la general nace partida en dos, no entera', () => {
  /* La general de un concierto casi nunca es un solo precio, y partirla después
     obliga a redibujarla con boletas ya emitidas. */
  const nombres = de(plantillaDeConcierto({}).espacios, 'pista').map(e => e.nombre);
  assert.deepEqual(nombres, ['General A', 'General B']);
});

test('las tribunas se numeran como la señalética: 101… y 201…', () => {
  /* Quien llega con su boleta busca el número pintado en la pared, no una
     numeración bonita. */
  const { espacios } = plantillaDeConcierto({ anillos: 2, porAnillo: 3 });
  assert.deepEqual(de(espacios, 'tribuna').map(e => e.nombre),
    ['101', '102', '103', '201', '202', '203']);
});

test('un palco se vende entero y entra más de una persona', () => {
  const [palco] = de(plantillaDeConcierto({ palcos: 2 }).espacios, 'palco');
  assert.equal(palco.modo, 'vendible');
  assert.ok(palco.capacidad > 1, 'un palco con capacidad 1 descuadra el aforo');
});

test('la tarima y las tribunas NO se venden', () => {
  /* Una tribuna es un contenedor: lo que se vende son sus butacas. Si naciera
     vendible, alguien podría comprar «la tribuna 103». */
  const { espacios } = plantillaDeConcierto({ anillos: 1, porAnillo: 2 });
  for (const e of espacios.filter(x => x.tipo !== 'palco')) {
    assert.notEqual(e.modo, 'vendible', e.nombre);
  }
});

/* ── La forma: que el recinto mire a su escenario ─────────────────────── */

test('nada se dibuja ENCIMA de la tarima', () => {
  /* EL fallo de la primera versión, y se veía de lejos: el centro de los arcos
     estaba entre el público en vez de en la tarima, así que la general daba la
     vuelta y se dibujaba sobre el escenario.
     La invariante buena es ésta y no «nadie por detrás»: en un arena de 240°
     los bloques laterales SÍ rebasan la línea del escenario —así son los
     recintos de verdad— pero ninguno puede pisarlo. */
  const dentroDeLaTarima = (tarima, punto) => {
    const xs = tarima.geometria.puntos.map(p => p[0]);
    const yy = ys(tarima);
    return punto[0] > Math.min(...xs) && punto[0] < Math.max(...xs)
        && punto[1] > Math.min(...yy) && punto[1] < Math.max(...yy);
  };

  for (const abertura of [120, 180, 240, 300, 360]) {
    const { espacios } = plantillaDeConcierto({ abertura, anillos: 2, porAnillo: 8, palcos: 6 });
    const [tarima] = de(espacios, 'tarima');
    for (const e of espacios.filter(x => x.tipo !== 'tarima')) {
      for (const punto of puntos(e)) {
        assert.equal(dentroDeLaTarima(tarima, punto), false,
          `«${e.nombre}» pisa la tarima con ${abertura}°`);
      }
    }
  }
});

test('con el escenario contra la pared, el público está delante', () => {
  /* Hasta 180° el escenario está en un extremo y detrás no va nadie. */
  const { espacios } = plantillaDeConcierto({ abertura: 180, anillos: 2, porAnillo: 8, palcos: 6 });
  const [tarima] = de(espacios, 'tarima');
  const fondoDeLaTarima = Math.min(...ys(tarima));
  for (const e of espacios.filter(x => x.tipo !== 'tarima')) {
    assert.ok(Math.min(...ys(e)) >= fondoDeLaTarima,
      `«${e.nombre}» se dibuja por detrás de la tarima`);
  }
});

test('cada anillo se aleja del escenario, no se encarama al anterior', () => {
  const { espacios } = plantillaDeConcierto({ anillos: 3, porAnillo: 4 });
  const dist = (e) => Math.min(...puntos(e).map(p => Math.hypot(p[0], p[1])));
  const tribunas = de(espacios, 'tribuna');
  const anillo1 = dist(tribunas[0]);
  const anillo2 = dist(tribunas[4]);
  const anillo3 = dist(tribunas[8]);
  assert.ok(anillo2 > anillo1 && anillo3 > anillo2, `${anillo1} ${anillo2} ${anillo3}`);
});

test('la general va delante de las tribunas, no detrás', () => {
  const { espacios } = plantillaDeConcierto({ anillos: 1, porAnillo: 4 });
  const lejos = (e) => Math.max(...puntos(e).map(p => Math.hypot(p[0], p[1])));
  const cerca = (e) => Math.min(...puntos(e).map(p => Math.hypot(p[0], p[1])));
  assert.ok(cerca(de(espacios, 'tribuna')[0]) >= lejos(de(espacios, 'pista')[1]) - 1);
});

test('los palcos quedan fuera del último anillo', () => {
  const { espacios } = plantillaDeConcierto({ anillos: 2, porAnillo: 4, palcos: 4 });
  const lejos = (e) => Math.max(...puntos(e).map(p => Math.hypot(p[0], p[1])));
  const cerca = (e) => Math.min(...puntos(e).map(p => Math.hypot(p[0], p[1])));
  const ultimaTribuna = Math.max(...de(espacios, 'tribuna').map(lejos));
  assert.ok(Math.min(...de(espacios, 'palco').map(cerca)) >= ultimaTribuna - 1);
});

test('los bloques de un anillo no se pisan entre sí', () => {
  /* Sin hueco, un anillo de diez tribunas se ve como una sola banda de color y
     no se distingue la 104 de la 105. */
  const { espacios } = plantillaDeConcierto({ abertura: 180, anillos: 1, porAnillo: 6 });
  const trib = de(espacios, 'tribuna');
  const ang = (e) => Math.atan2(e.geometria.centro[1], e.geometria.centro[0]);
  const angulos = trib.map(ang).sort((a, b) => a - b);
  for (let i = 1; i < angulos.length; i++) {
    assert.ok(angulos[i] - angulos[i - 1] > 0.01, 'dos bloques en el mismo sitio');
  }
});

/* ── La etiqueta ──────────────────────────────────────────────────────── */

test('cada bloque sabe dónde va su nombre, y cae DENTRO de la figura', () => {
  /* En un arco ancho, el centro de la caja cae en el agujero: «General A»
     simplemente no aparecía. */
  const { espacios } = plantillaDeConcierto({ abertura: 240, anillos: 1, porAnillo: 4 });
  for (const e of espacios.filter(x => x.tipo !== 'tarima')) {
    const [cx, cy] = e.geometria.centro;
    const d = Math.hypot(cx, cy);
    const rs = puntos(e).map(p => Math.hypot(p[0], p[1]));
    assert.ok(d >= Math.min(...rs) - 1 && d <= Math.max(...rs) + 1,
      `la etiqueta de «${e.nombre}» cae fuera`);
  }
});

/* ── Los límites ──────────────────────────────────────────────────────── */

test('la abertura tiene tope: 30 a 360 grados', () => {
  /* Es la decisión que hay que tomar antes de dibujar nada, y un valor absurdo
     daría un recinto imposible en vez de un error. */
  assert.match(plantillaDeConcierto({ abertura: 0 }).error, /30 a 360/);
  assert.match(plantillaDeConcierto({ abertura: 400 }).error, /30 a 360/);
  assert.match(plantillaDeConcierto({ abertura: 'mucho' }).error, /30 a 360/);
  assert.ok(plantillaDeConcierto({ abertura: 360 }).espacios);
});

test('los números disparatados se recortan en vez de colgar el servidor', () => {
  const { espacios } = plantillaDeConcierto({ anillos: 999, porAnillo: 999, palcos: 999 });
  assert.ok(espacios.length < 500, `salieron ${espacios.length}`);
});

test('en redondo la tarima va en MEDIO, no en un borde', () => {
  /* Por encima de 270° el público rodea el escenario. Dejarlo en el borde haría
     que media plantilla se dibujara detrás de él, que es lo que pasaba. */
  const { espacios } = plantillaDeConcierto({ abertura: 360, anillos: 1, porAnillo: 8 });
  assert.equal(de(espacios, 'tribuna').length, 8);

  const [tarima] = de(espacios, 'tarima');
  const xs = puntos(tarima).map(p => p[0]);
  const yy = ys(tarima);
  /* Contiene el origen: está en medio. */
  assert.ok(Math.min(...xs) < 0 && Math.max(...xs) > 0);
  assert.ok(Math.min(...yy) < 0 && Math.max(...yy) > 0);

  /* Y cabe dentro del hueco de la general: si sobresaliera, la primera fila se
     dibujaría encima del escenario. */
  const rTarima = Math.max(...puntos(tarima).map(p => Math.hypot(p[0], p[1])));
  const rGeneral = Math.min(...puntos(de(espacios, 'pista')[0]).map(p => Math.hypot(p[0], p[1])));
  assert.ok(rTarima <= rGeneral, `${rTarima} > ${rGeneral}`);
});

/* ── La ruta ──────────────────────────────────────────────────────────── */

const RUTA = leer('routes/espacios.js');

test('la plantilla no se suelta encima de un plano que ya existe', () => {
  /* Soltaría treinta bloques sobre lo que alguien montó —o sobre sillas ya
     vendidas— y deshacerlo sería borrarlos uno a uno. */
  /* Se corta desde el `router.post` y no desde el texto «espacios/plantilla»,
     que aparece antes en el comentario de encabezado. Van cuatro veces esta
     sesión que una prueba mide un comentario en vez del código. */
  const trozo = RUTA.slice(RUTA.indexOf("router.post('/:eventoId/espacios/plantilla'"));
  const cuerpo = trozo.slice(0, trozo.indexOf('\nrouter.'));
  assert.match(cuerpo, /count: 'exact'/);
  assert.match(cuerpo, /409/);
});

test('el vocabulario del concierto está completo', () => {
  /* Cuatro piezas, y cada una con su modo. Una lista a medias aquí serían
     bloques que nacen vendibles sin querer. */
  assert.deepEqual(Object.keys(PIEZAS).sort(), ['palco', 'pista', 'tarima', 'tribuna']);
  for (const [k, v] of Object.entries(PIEZAS)) {
    assert.ok(geo.FORMAS.length && v.modo && v.etiqueta, k);
  }
  assert.ok(MEDIDAS.pista.rExterior > MEDIDAS.pista.rInterior);
});
