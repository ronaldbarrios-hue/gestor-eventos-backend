/* La rueda de negocios como la usa quien la organiza de verdad.
 *
 * ── El error de agenda que más cuesta ────────────────────────────────────
 *
 * El índice único de `networking_citas` es sobre `horario_id`: impide que DOS
 * personas ocupen la misma casilla. No impide lo contrario — que UNA persona
 * ocupe dos casillas de la misma hora en mesas distintas. Y eso, en una rueda,
 * es EL error: reservas 10:00 con la mesa A, 10:00 con la B, y a las diez
 * estás en una sola.
 *
 * Lo paga la mesa que se queda esperando: su casilla figuraba ocupada, así que
 * nadie más pudo pedirla, y encima se queda sin nadie. Dos veces el mismo
 * hueco perdido, y se descubre en el peor momento.
 *
 * ── Y tres errores que se tragaban en silencio ───────────────────────────
 *
 * · Borrar un horario: si la consulta que busca su cita fallaba, `cita` venía
 *   vacía, la casilla parecía libre y el horario se borraba CON su cita
 *   dentro — en cascada. Una reunión acordada, desaparecida.
 * · El modo de la rueda: si no se podía leer, se asumía «reserva directa». Una
 *   rueda con aprobación confirmaba citas sola mientras durara el fallo.
 * · La vista de gestión: si fallaba la lista de mesas, salía SIN NINGUNA MESA,
 *   con todo intacto en la base.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'networking.js'), 'utf8').replace(/\r/g, '');

test('nadie puede estar en dos mesas a la vez', () => {
  assert.match(SRC, /async function citaQueSolapa\(/, 'desapareció la comprobación de solape');

  /* La regla: se tocan si empieza antes de que la otra acabe Y acaba después
     de que la otra empiece. Con `<` estricto, para que dos citas SEGUIDAS
     —una acaba 10:15 y la otra empieza 10:15— no cuenten como solape: así es
     como se arma una rueda, una detrás de otra.
     Comprobado en Postgres con los cinco casos: misma hora sí, a medias sí,
     una dentro de otra sí, seguidas no, separadas no. */
  assert.match(SRC, /return ini < b && fin > a;/,
    'la regla del solape cambió: con `<=` dos citas seguidas se rechazarían entre sí');

  /* En los TRES sitios donde nace o se mueve una cita. */
  const usos = [...SRC.matchAll(/await citaQueSolapa\(/g)].length;
  assert.equal(usos, 3,
    `el solape se comprueba en ${usos} de los 3 caminos (reservar, sentar a mano, mover)`);
});

test('el aviso dice con quién es el choque', () => {
  /* «Ya tienes otra cita a esa hora» obliga a ir a buscarla a la agenda para
     entender qué pasó. Con el nombre de la otra mesa, se decide en el acto. */
  assert.match(SRC, /Ya tienes una cita a esa hora con \$\{otra\}/);
  assert.match(SRC, /Esa persona ya tiene una cita a esa hora con \$\{otra\}/);
});

test('mover una cita no choca consigo misma', () => {
  /* Sin `exceptoId`, mover una cita a un horario que se solapa con el suyo
     propio se rechazaría a sí misma, y mover sería imposible. */
  assert.match(SRC, /horario: h, exceptoId: citaId,/,
    'la comprobación al mover dejó de excluir la cita que se mueve');
});

test('borrar un horario falla cerrado', () => {
  /* Si no se puede comprobar si tiene cita, NO se borra. Volver a intentarlo
     cuesta un clic; deshacer un borrado en cascada no se puede. */
  assert.match(SRC, /if \(eCita\) return res\.status\(500\)\.json\(\{ error: eCita\.message \}\);/,
    'volvió a borrarse el horario sin comprobar el error: se lleva la cita dentro');
  /* Y una cita PEDIDA también cuenta: es una reunión que alguien espera. */
  assert.match(SRC, /\.in\('estado', \['confirmada', 'solicitada'\]\)/,
    'una cita pedida y sin responder vuelve a poder borrarse sin avisar');
  assert.match(SRC, /tiene una cita pedida y sin responder/,
    'no se distingue una cita pedida de una confirmada al negarse');
});

test('el modo de la rueda no se adivina', () => {
  /* Sin este corte, un fallo de lectura convertía una rueda «con aprobación»
     en una de reserva directa: citas confirmadas solas, y al otro lado una
     mesa que no esperaba a nadie. */
  assert.match(SRC, /if \(eModo\) return res\.status\(500\)\.json\(\{ error: eModo\.message \}\);/,
    'un fallo al leer el modo vuelve a confirmar citas que pedían aprobación');
});

test('la vista de gestión no enseña una rueda vacía por un error', () => {
  assert.match(SRC, /if \(eExp\) return res\.status\(500\)\.json\(\{ error: eExp\.message \}\);/,
    'un fallo al listar las mesas vuelve a salir como «no hay mesas»');
});
