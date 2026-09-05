/* El cierre de una reunión: qué pasó y qué negocio se espera.
 *
 * ── Por qué esto es el entregable ────────────────────────────────────────
 *
 * Una rueda se organiza para poder contestar dos preguntas al cerrar: cuántas
 * reuniones ocurrieron de verdad y cuánto negocio se espera. Para una cámara de
 * comercio eso es lo que se le presenta a la junta. Hasta la 0110 la plataforma
 * agendaba citas y no podía contestar ninguna de las dos.
 *
 * ── La decisión que sostiene todo esto ───────────────────────────────────
 *
 * `resultado` es una columna aparte y NO un estado más. `ESTADOS_CITA` ya
 * admitía 'realizada' y usarlo habría sido lo obvio: la disponibilidad se
 * calcula con `estado in ('confirmada','solicitada')`, así que una cita
 * 'realizada' habría dejado su casilla pintada como libre mientras el índice
 * único seguía impidiendo reservarla. Es la casilla muerta que costó arreglar
 * esta mañana.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { camposDeCierre, informeDeCitas } = require('../lib/cierreDeCita.js');
const RUTAS = fs.readFileSync(path.join(__dirname, '..', 'routes', 'networking.js'), 'utf8').replace(/\r/g, '');
const SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0110_cierre_de_la_reunion.sql'), 'utf8');

test('sólo se toca lo que viene en la petición', () => {
  /* Es lo que impide que cerrar la reunión borre la nota escrita durante ella:
     son dos momentos distintos y dos peticiones distintas. */
  assert.deepEqual(camposDeCierre({}).campos, {});
  assert.deepEqual(camposDeCierre({ hubo_acuerdo: true }).campos, { hubo_acuerdo: true });
});

test('un resultado inventado no entra', () => {
  /* No fallaría: entraría en la base y quedaría fuera de todas las cuentas del
     informe. Es la peor forma de perder una reunión. */
  assert.match(camposDeCierre({ resultado: 'quiza' }).error, /Resultado inválido/);
  assert.equal(camposDeCierre({ resultado: 'realizada' }).campos.resultado, 'realizada');
  assert.equal(camposDeCierre({ resultado: 'no_asistio' }).campos.resultado, 'no_asistio');
  /* Y se puede desmarcar: «me equivoqué, todavía no lo sé». */
  assert.equal(camposDeCierre({ resultado: null }).campos.resultado, null);
});

test('el monto lleva su moneda, copiada del evento', () => {
  /* «5000000» sin moneda es una cifra que dentro de un año no se interpreta. Se
     copia AL ESCRIBIR: si el evento cambia de moneda, lo ya registrado no
     cambia de significado. */
  const { campos } = camposDeCierre({ expectativa_monto: '5000000' }, { moneda: 'USD' });
  assert.equal(campos.expectativa_monto, 5000000);
  assert.equal(campos.expectativa_moneda, 'USD');
});

test('una cifra imposible se rechaza con una frase, no con un error de Postgres', () => {
  assert.match(camposDeCierre({ expectativa_monto: -5 }).error, /número positivo/);
  assert.match(camposDeCierre({ expectativa_monto: 'mucho' }).error, /número positivo/);
  assert.match(camposDeCierre({ expectativa_monto: 1e15 }).error, /Revisa los ceros/);
});

test('el plazo es una lista corta, y por qué', () => {
  /* Un campo libre acabaría con «3 meses», «tres meses» y «3m» en la misma
     columna, y el informe no podría agrupar nada. */
  assert.match(camposDeCierre({ expectativa_plazo: 'cuando sea' }).error, /Plazo inválido/);
  assert.equal(camposDeCierre({ expectativa_plazo: '6_meses' }).campos.expectativa_plazo, '6_meses');
});

test('el informe no reparte lo que nadie registró', () => {
  /* Una rueda donde no se cerró ninguna reunión tiene que verse como lo que es
     —sin datos—, no como una rueda con cero reuniones realizadas. */
  const r = informeDeCitas([
    { estado: 'confirmada', resultado: 'realizada', expectativa_monto: 1000, expectativa_moneda: 'COP', hubo_acuerdo: true },
    { estado: 'confirmada', resultado: 'no_asistio' },
    { estado: 'confirmada' },
    { estado: 'cancelada' },
  ]);
  assert.equal(r.total, 4);
  assert.equal(r.canceladas, 1);
  assert.equal(r.agendadas, 3, 'una cancelada no es una cita agendada que se perdió');
  assert.equal(r.realizadas, 1);
  assert.equal(r.no_asistio, 1);
  assert.equal(r.sin_registrar, 1);
  assert.equal(r.con_acuerdo, 1);
  assert.deepEqual(r.expectativa_por_moneda, { COP: 1000 });
});

test('la efectividad se calcula sobre lo registrado, no sobre el total', () => {
  /* Sobre el total, «no lo sabemos» se convertiría en «no ocurrió»: con 3
     cerradas de 200, el informe diría 1,5 % de efectividad. */
  const r = informeDeCitas([
    { estado: 'confirmada', resultado: 'realizada' },
    { estado: 'confirmada', resultado: 'no_asistio' },
    ...Array.from({ length: 50 }, () => ({ estado: 'confirmada' })),
  ]);
  assert.equal(r.registradas, 2);
  assert.equal(r.efectividad, 50);
});

test('sin nada registrado, la efectividad es null y no cero', () => {
  const r = informeDeCitas([{ estado: 'confirmada' }, { estado: 'confirmada' }]);
  assert.equal(r.efectividad, null, '0 % diría que ninguna reunión ocurrió, y eso no se sabe');
});

test('el resultado NO es un estado más de la cita', () => {
  /* Si lo fuera, una cita marcada 'realizada' saldría de
     `estado in ('confirmada','solicitada')` y su casilla se pintaría libre
     mientras el índice único seguiría impidiendo reservarla. La casilla muerta,
     otra vez. */
  assert.match(SQL, /add column if not exists resultado\s+text/,
    'el resultado dejó de tener columna propia');
  assert.match(SQL, /check \(resultado is null or resultado in \('realizada', 'no_asistio'\)\)/,
    'desapareció el CHECK: un resultado inventado entraría y quedaría fuera del informe');
  /* Y la disponibilidad sigue mirando sólo el estado. */
  assert.match(RUTAS, /\.in\('estado', \['confirmada', 'solicitada'\]\)/,
    'la disponibilidad empezó a mirar el resultado: una reunión pasada liberaría su casilla');
});

test('las dos vías de cierre usan la misma limpieza', () => {
  /* La persona sobre su cita, y el equipo desde la parrilla. Dos copias de
     estas reglas acabarían aceptando cosas distintas, y el informe sumaría
     peras con manzanas. */
  const usos = [...RUTAS.matchAll(/camposDeCierre\(req\.body/g)].length;
  assert.equal(usos, 2, `el cierre se limpia en ${usos} de las 2 vías`);
  assert.match(RUTAS, /router\.get\('\/:eventoId\/networking\/informe'/, 'desapareció el informe');
});

test('la migración es aditiva y trae su vuelta atrás', () => {
  /* Sin los comentarios: la vuelta atras que va escrita al final ES un
     `drop column`, y sin quitarla la prueba se caza a si misma. */
  const soloSql = SQL.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(soloSql, /drop column/i, 'la migración borra una columna');
  assert.match(SQL, /-- Vuelta atrás/, 'sin vuelta atrás escrita, aplicarla es una apuesta');
  assert.match(SQL, /expectativa_monto >= 0/, 'un monto negativo volvería a poder guardarse');
});
