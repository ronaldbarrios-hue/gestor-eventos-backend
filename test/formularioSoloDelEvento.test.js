/* El formulario público pregunta lo del EVENTO, no lo de una actividad.
 *
 * `event_form_fields` guarda dos cosas distintas en la misma tabla: las
 * preguntas de la compra de una boleta, y las de la inscripción a una actividad
 * concreta —un taller, una charla—, que llevan `session_id`.
 *
 * Distinguirlas es un `.is('session_id', null)`, y estaba escrito a mano: de las
 * SIETE consultas que había en las rutas públicas, sólo UNA lo llevaba. Las
 * demás servían al público las preguntas de los talleres mezcladas con las de
 * la compra, y el síntoma es el de siempre en este proyecto — falta algo y no
 * salta ningún error, sólo un formulario con más pasos de los que debería.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const PUBLICAS = leer('routes/eventos.publicos.js');

test('las preguntas del evento se piden por `camposDelEvento`, no a mano', () => {
  /* El arreglo no era copiar el filtro seis veces: es que haya un solo sitio
     donde está escrito.
   *
   * Quedan dos consultas a mano y las dos son legítimas. Si aparece una
   * tercera, esta prueba lo dice: o pasa por la función, o se justifica aquí
   * con su motivo. */
  const A_MANO = [
    { marca: ".eq('id', campoId)", motivo: 'un adjunto se busca por id, y también lo pide un campo de sesión' },
    { marca: ".in('session_id', conPropio)", motivo: 'va a buscar precisamente las preguntas DE las sesiones' },
  ];

  const consultas = PUBLICAS.split("from('event_form_fields')").slice(1)
    .map(c => c.slice(0, 400));

  const sinJustificar = consultas.filter(c => !A_MANO.some(j => c.includes(j.marca)));
  assert.deepEqual(sinJustificar, [],
    'hay consultas de campos escritas a mano y sin justificar: usa camposDelEvento()');

  /* Y al revés: una justificación que ya no corresponde a ninguna consulta
     sobra, o la lista se vuelve un cementerio que no dice nada. */
  for (const j of A_MANO) {
    assert.ok(consultas.some(c => c.includes(j.marca)),
      `ya no existe la consulta justificada como «${j.motivo}»: quítala de A_MANO`);
  }

  assert.ok(PUBLICAS.includes('camposDelEvento('), 'nadie usa la función');
});

test('la función filtra session_id, que es lo único que tenía que hacer bien', () => {
  const LIB = leer('lib/formularioCampos.js');
  const trozo = LIB.slice(LIB.indexOf('async function camposDelEvento'));
  assert.match(trozo.slice(0, 900), /is\('session_id', null\)/);
});

test('la consulta fallida se anota, no se traga', () => {
  /* Devolver `[]` en silencio es un formulario que no pregunta nada, y eso se
     ve como «este evento no pide datos» en vez de como un error. */
  const LIB = leer('lib/formularioCampos.js');
  const trozo = LIB.slice(LIB.indexOf('async function camposDelEvento'));
  assert.match(trozo.slice(0, 1200), /console\.error/);
});

test('la página pública dice si hay padrón, sin traérselo', () => {
  /* Se decide con esto una sola cosa —si se enseña el campo del documento— así
     que la cuenta exacta no importa. Traer las filas sería leer el padrón
     entero de un evento grande en cada visita a la página. */
  /* Se busca la consulta de LA BANDERA, no la primera del padrón: la primera es
     la de la búsqueda por documento, que sí trae datos porque para eso está.
     Medir esa era medir otra cosa que pasa por al lado. */
  const i = PUBLICAS.indexOf('tiene_padron');
  const trozo = PUBLICAS.slice(PUBLICAS.lastIndexOf("from('padron_previo')", i), i);
  assert.match(trozo, /head: true/);
  assert.match(PUBLICAS, /evento\.tiene_padron = /);
});

test('la bandera del padrón es un booleano, no una cuenta', () => {
  /* Mandar el número invitaría a enseñarlo, y «estás entre 3.412 personas» es
     información del organizador, no de quien compra. */
  assert.match(PUBLICAS, /evento\.tiene_padron = \(enPadron \|\| 0\) > 0;/);
});
