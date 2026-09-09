/* Llenar una tribuna de butacas, y comprobar dónde están los sitios accesibles.
 *
 * Las dos cosas son del mismo momento: el bloque ya está trazado sobre el plano
 * real y lo que falta es poblarlo bien.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const llenar = require('../lib/llenarElBloque.js');
const acc = require('../lib/sitiosAccesibles.js');
const geo = require('../lib/geometriaDelPlano.js');
const { plantillaDeConcierto } = require('../lib/recintoDeConcierto.js');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');

const tribuna = (extra = {}) => geo.bloqueCurvo({
  cx: 0, cy: 0, rInterior: 600, rExterior: 1100, desde: -12, hasta: 12,
  mirandoA: 'abajo', pasos: 10, ...extra,
});

/* ── Que las butacas caigan DENTRO ────────────────────────────────────── */

test('todas las butacas caen dentro del bloque, no en el pasillo', () => {
  /* Con una comprobación por caja en vez de por polígono, las de las esquinas
     de un trapecio quedarían fuera y nadie lo vería hasta el día del evento. */
  const g = tribuna();
  const { unidades } = llenar.butacasDelBloque({ geometria: g });
  for (const u of unidades) {
    const cx = u.geometria.x + geo.LADO / 2;
    const cy = u.geometria.y + geo.LADO / 2;
    assert.ok(llenar.dentro(g.puntos, cx, cy), `«${u.nombre}» cae fuera del bloque`);
  }
});

test('las filas de atrás llevan más butacas que las de delante', () => {
  const { unidades } = llenar.butacasDelBloque({ geometria: tribuna() });
  const porFila = new Map();
  for (const u of unidades) {
    const f = u.nombre.match(/Fila ([A-Z]+)\d+$/)[1];
    porFila.set(f, (porFila.get(f) || 0) + 1);
  }
  const cuentas = [...porFila.values()];
  assert.ok(cuentas.length > 3, 'salieron muy pocas filas');
  assert.ok(cuentas[cuentas.length - 1] > cuentas[0], `${cuentas[0]} → ${cuentas[cuentas.length - 1]}`);
});

test('la fila A es la más cerca del escenario', () => {
  /* Al revés, quien compre «fila A» se llevaría la peor del bloque. */
  const { unidades } = llenar.butacasDelBloque({ geometria: tribuna() });
  const dist = (u) => Math.hypot(u.geometria.x, u.geometria.y);
  const a = unidades.filter(u => /Fila A\d/.test(u.nombre));
  const ultima = unidades[unidades.length - 1];
  assert.ok(dist(a[0]) < dist(ultima));
});

test('cada butaca sale girada, mirando al escenario', () => {
  const { unidades } = llenar.butacasDelBloque({ geometria: tribuna() });
  for (const u of unidades) assert.ok(Number.isFinite(u.geometria.rot), u.nombre);
  /* Y no todas igual: si lo estuvieran, el bloque no seguiría la curva. */
  assert.ok(new Set(unidades.map(u => u.geometria.rot)).size > 1);
});

test('las letras de fila no saltan: no hay A, C, D', () => {
  /* Una fila donde no cupo nada no gasta letra, o quien busque la B no la
     encuentra. */
  const { unidades } = llenar.butacasDelBloque({ geometria: tribuna() });
  const letras = [...new Set(unidades.map(u => u.nombre.match(/Fila ([A-Z]+)\d+$/)[1]))];
  const esperadas = letras.map((_, i) => String.fromCharCode(65 + i));
  assert.deepEqual(letras.slice(0, 5), esperadas.slice(0, 5));
});

test('las butacas nacen vendibles: son lo que se compra', () => {
  const { unidades } = llenar.butacasDelBloque({ geometria: tribuna() });
  for (const u of unidades) assert.equal(u.modo, 'vendible');
});

test('se puede fijar el número de filas y de butacas por fila', () => {
  /* Quien numera butacas a mano necesita que la fila C tenga las mismas que la
     D, para poder cotejarlo con el recinto. */
  const { unidades } = llenar.butacasDelBloque({ geometria: tribuna(), filas: 3, porFila: 8 });
  const porFila = new Map();
  for (const u of unidades) {
    const f = u.nombre.match(/Fila ([A-Z]+)\d+$/)[1];
    porFila.set(f, (porFila.get(f) || 0) + 1);
  }
  assert.equal(porFila.size, 3);
  for (const n of porFila.values()) assert.equal(n, 8);
});

test('un bloque sin forma no se llena, y lo dice', () => {
  assert.match(llenar.butacasDelBloque({ geometria: null }).error, /no tiene forma/);
  assert.match(llenar.butacasDelBloque({ geometria: { puntos: [[0, 0], [1, 1]] } }).error, /no tiene forma/);
});

test('hay tope: llenar no puede crear diez mil filas de una vez', () => {
  const enorme = geo.bloqueCurvo({ rInterior: 500, rExterior: 4000, desde: -180, hasta: 180, mirandoA: 'abajo', pasos: 40 });
  const r = llenar.butacasDelBloque({ geometria: enorme });
  assert.match(r.error, /máximo/);
});

test('la plantilla tiene escala de arena: una tribuna da cientos de butacas', () => {
  /* La primera versión daba SIETE por tribuna. Un arena con tribunas de siete
     asientos no es un arena, y se vio llenando una y mirándola. */
  const { espacios } = plantillaDeConcierto({ abertura: 240, anillos: 2, porAnillo: 10 });
  const t = espacios.find(e => e.tipo === 'tribuna');
  const { unidades, error } = llenar.butacasDelBloque({ geometria: t.geometria });
  assert.equal(error, undefined);
  assert.ok(unidades.length > 150, `salieron ${unidades.length}`);
});

/* ── El alcance angular ───────────────────────────────────────────────── */

test('un bloque que cruza los ±180 grados no se desenrolla mal', () => {
  /* Con un min/max ingenuo, el rango salido sería casi la circunferencia
     entera y las butacas se repartirían por todo el recinto. */
  const g = geo.bloqueCurvo({ rInterior: 600, rExterior: 900, desde: -12, hasta: 12, mirandoA: 'izquierda', pasos: 8 });
  const a = llenar.alcance(g.puntos, 0, 0);
  assert.ok(a.hasta - a.desde < 40, `abarca ${a.hasta - a.desde}°`);
});

/* ── Los sitios accesibles ────────────────────────────────────────────── */

test('la cuenta de la norma: 36 desde 5.000, y uno más por cada 200', () => {
  assert.equal(acc.cuantosTocan(5000), 36);
  assert.equal(acc.cuantosTocan(5200), 37);
  assert.equal(acc.cuantosTocan(10000), 61);
});

test('por debajo del umbral la regla no aplica, que no es lo mismo que cumplir', () => {
  /* Un salón de 200 personas saldría en verde por una norma que ni se le
     aplica, y eso engaña. */
  assert.equal(acc.cuantosTocan(200), 0);
  const r = acc.revisar({ espacios: [{ modo: 'vendible', capacidad: 200, atributos: {} }] });
  assert.equal(r.aplica, false);
});

const sitio = (id, parent, tipo = {}) => ({
  id, parent_id: parent, modo: 'vendible', capacidad: 1, atributos: tipo,
});

test('avisa cuando faltan espacios accesibles', () => {
  const espacios = Array.from({ length: 6000 }, (_, i) => sitio(`s${i}`, 'z1'));
  const r = acc.revisar({ espacios });
  assert.equal(r.aplica, true);
  assert.ok(r.avisos.some(a => a.clave === 'faltan'));
});

test('avisa cuando están todos amontonados en la misma zona', () => {
  /* La forma normal de incumplir: los treinta y seis juntos en una esquina. */
  const espacios = [
    ...Array.from({ length: 40 }, (_, i) => sitio(`a${i}`, 'z1', { accesible: true })),
    ...Array.from({ length: 6000 }, (_, i) => sitio(`s${i}`, 'z2')),
    sitio('ac1', 'z1', { acompanante: true }),
  ];
  const r = acc.revisar({ espacios });
  assert.ok(r.avisos.some(a => a.clave === 'amontonados'), JSON.stringify(r.avisos));
});

test('avisa cuando están todos en la misma banda de precio', () => {
  /* La otra forma común: todos en la localidad más barata. */
  const espacios = [
    sitio('a1', 'z1', { accesible: true }), sitio('a2', 'z2', { accesible: true }),
    sitio('s1', 'z1'), sitio('s2', 'z2'), sitio('ac1', 'z1', { acompanante: true }),
  ];
  const localidades = new Map([['a1', 'barata'], ['a2', 'barata'], ['s1', 'cara'], ['s2', 'barata']]);
  const r = acc.revisar({ espacios, localidades });
  assert.ok(r.avisos.some(a => a.clave === 'un_solo_precio'));
});

test('avisa cuando no hay sitios de acompañante', () => {
  const espacios = [sitio('a1', 'z1', { accesible: true }), sitio('a2', 'z2', { accesible: true }), sitio('s1', 'z1')];
  const r = acc.revisar({ espacios });
  assert.ok(r.avisos.some(a => a.clave === 'sin_acompanante'));
});

test('un recinto bien repartido no da avisos', () => {
  const espacios = [
    sitio('a1', 'z1', { accesible: true }), sitio('a2', 'z2', { accesible: true }),
    sitio('ac1', 'z1', { acompanante: true }),
    sitio('s1', 'z1'), sitio('s2', 'z2'),
  ];
  const localidades = new Map([['a1', 'cara'], ['a2', 'barata'], ['s1', 'cara'], ['s2', 'barata']]);
  const r = acc.revisar({ espacios, localidades });
  assert.deepEqual(r.avisos, []);
  assert.equal(r.ok, true);
});

test('«repartidos» no significa nada en una sala de un solo bloque', () => {
  /* Avisar ahí sería regañar a alguien por algo que no puede arreglar. */
  const espacios = [
    sitio('a1', 'z1', { accesible: true }), sitio('a2', 'z1', { accesible: true }),
    sitio('ac1', 'z1', { acompanante: true }), sitio('s1', 'z1'),
  ];
  const r = acc.revisar({ espacios });
  assert.equal(r.avisos.some(a => a.clave === 'amontonados'), false);
});

test('todo aviso trae una frase que se le puede enseñar a alguien', () => {
  const espacios = Array.from({ length: 6000 }, (_, i) => sitio(`s${i}`, 'z1'));
  for (const a of acc.revisar({ espacios }).avisos) {
    assert.ok(a.clave && a.texto && a.texto.length > 25, JSON.stringify(a));
  }
});

/* ── Las rutas ────────────────────────────────────────────────────────── */

const RUTA = leer('routes/espacios.js');

test('llenar una tribuna que ya tiene sitios se niega', () => {
  /* Saldrían dos juegos de sillas superpuestas con nombres repetidos, y si
     alguna estuviera vendida no habría vuelta atrás. */
  const trozo = RUTA.slice(RUTA.indexOf("router.post('/:eventoId/espacios/:id/butacas'"));
  const cuerpo = trozo.slice(0, trozo.indexOf('\nrouter.'));
  assert.match(cuerpo, /count: 'exact'/);
  assert.match(cuerpo, /409/);
});

test('las butacas llevan el nombre de su bloque delante', () => {
  /* «Fila A1» repetido en veinte tribunas no identifica a nadie, y en la puerta
     hay que poder leer a qué sección va esa persona. */
  const trozo = RUTA.slice(RUTA.indexOf("router.post('/:eventoId/espacios/:id/butacas'"));
  assert.match(trozo.slice(0, 2500), /bloque\.nombre.*Fila/s);
});

test('la revisión de accesibilidad viaja con el plano, no en otra pantalla', () => {
  /* Sacarla a otro sitio la convierte en algo que nadie abre. */
  assert.match(RUTA, /accesibilidad: accesibles\.revisar/);
});

test('«8 por fila» son 8, no 6', () => {
  /* El tramo útil de cada fila es más corto que el alcance del bloque: se cierra
     con cuerdas rectas. Repartiendo sobre el alcance total, los dos de los
     extremos caían fuera y quien numera a mano contaba 8 en la pared y 6 en la
     pantalla. */
  for (const n of [4, 8, 15]) {
    const { unidades } = llenar.butacasDelBloque({ geometria: tribuna(), filas: 2, porFila: n });
    const porFila = new Map();
    for (const u of unidades) {
      const f = u.nombre.match(/Fila ([A-Z]+)\d+$/)[1];
      porFila.set(f, (porFila.get(f) || 0) + 1);
    }
    for (const cuantas of porFila.values()) assert.equal(cuantas, n, `pedí ${n}`);
  }
});

test('el tramo útil de la fila de atrás es más largo que el de delante', () => {
  /* Se mide en LARGO DE ARCO y no en grados. En un sector circular el ángulo es
     el mismo a todos los radios —lo comprobé creyendo lo contrario— y lo que
     crece es el arco: mismo ángulo, más radio, más butacas. */
  const g = tribuna();
  const a = llenar.alcance(g.puntos, 0, 0);
  const largo = (r) => {
    const t = llenar.tramoUtil(g.puntos, 0, 0, r, a.desde, a.hasta);
    return ((t.hasta - t.desde) * Math.PI / 180) * r;
  };
  assert.ok(largo(a.rMax - 30) > largo(a.rMin + 30));
});

test('donde no cabe nada, no se inventa una fila', () => {
  /* El pico de un bloque triangular. */
  assert.equal(llenar.tramoUtil([[0, 0], [10, 0], [5, 10]], 0, 0, 5000, -180, 180), null);
});
