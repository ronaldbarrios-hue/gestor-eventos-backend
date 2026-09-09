/* Traer los datos con el CÓDIGO de una boleta, en vez de con la cédula.
 *
 * ── Por qué es mejor que el padrón ───────────────────────────────────────
 *
 * El prellenado por documento sólo funciona si el organizador subió un padrón,
 * y le pide a alguien su número de cédula antes de que haya escrito su nombre.
 * El código lo tiene la persona en su correo: es suyo, se pega, y no hace falta
 * que nadie haya subido nada.
 *
 * Y resuelve el caso que de verdad duele: un evento con varias boletas —la
 * entrada general y tres actividades— donde quien ya se registró tenía que
 * volver a teclear diez preguntas para inscribirse a la siguiente.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const RUTA = leer('routes/eventos.publicos.js');

const CUERPO = (() => {
  const i = RUTA.indexOf("router.post('/slug/:slug/prellenar-boleta'");
  return RUTA.slice(i, RUTA.indexOf('\nrouter.', i + 10));
})();

test('la ruta existe y va por POST', () => {
  /* Por POST y no por GET: un código en la query string queda escrito en los
     logs de acceso del servidor y en el historial del navegador. */
  assert.ok(CUERPO.length > 100, 'no se encontró la ruta');
  assert.match(RUTA, /router\.post\('\/slug\/:slug\/prellenar-boleta'/);
});

test('va limitada: contesta sobre la existencia de un código', () => {
  assert.match(CUERPO, /authLimiter/);
});

test('sólo prellena con boletas del MISMO organizador', () => {
  /* Sin esto, un código de otra empresa traería aquí los datos de una persona
     que no tiene nada que ver con este evento. */
  assert.match(CUERPO, /owner_id !== ev\.owner_id/);
});

test('un código que no existe y uno de otro organizador contestan igual', () => {
  /* Distinguirlos es justo lo que haría útil ir probando códigos. Las dos
     ramas llaman a la misma función. */
  assert.match(CUERPO, /const nada = \(\)/);
  assert.ok((CUERPO.match(/return nada\(\)/g) || []).length >= 2);
});

test('un código corto no llega a la base', () => {
  /* Es un tanteo, y contestar a algo que no puede existir gasta base por nada. */
  assert.match(CUERPO, /codigo\.length < 4/);
});

test('sólo salen respuestas a las preguntas que ESTE formulario hace', () => {
  /* Lo que se supiera de más no sale nunca — la misma regla que el prellenado
     por documento. */
  assert.match(CUERPO, /prellenar\(\{ camposDestino: campos/);
});

test('las respuestas se cruzan por etiqueta, no por id de campo', () => {
  /* La boleta puede ser de otra edición, donde «Ciudad de residencia» era otra
     pregunta con otro id. Es el mismo cruce que ya usan la inscripción a un
     sub-evento y la ficha del expositor. */
  assert.match(CUERPO, /porEtiqueta\(/);
});

test('NO se devuelve el qr_token ni nada que sirva para entrar', () => {
  /* Esto prellena un formulario. Que el código dé acceso a las respuestas es
     algo que ya pasa en `/ticket/:codigo`; darle además la credencial no. */
  const select = CUERPO.slice(CUERPO.indexOf('.select('), CUERPO.indexOf('.eq(\'codigo\''));
  assert.equal(/qr_token/.test(select), false);
  assert.equal(/qr_token/.test(CUERPO), false);
});

test('nombre y correo viajan aparte de las respuestas', () => {
  /* No son preguntas del organizador: son lo que la plataforma necesita para
     emitir la boleta, y son lo que más se teclea. */
  assert.match(CUERPO, /nombre: boleta\.guest_nombre/);
  assert.match(CUERPO, /email: boleta\.guest_email/);
});

test('sólo mira las preguntas del evento, no las de un taller', () => {
  /* `camposDelEvento` filtra `session_id`. Sin eso, prellenaría con respuestas
     de la inscripción a una actividad en el formulario de la compra. */
  assert.match(CUERPO, /camposDelEvento\(/);
  assert.equal(/from\('event_form_fields'\)/.test(CUERPO), false,
    'la ruta arma su propia consulta de campos en vez de usar la función');
});

/* ── La segunda llave: documento MÁS correo ───────────────────────────── */

const REG = leer('lib/miRegistroAnterior.js');

test('el documento NUNCA basta solo', () => {
  /* Una cédula no es un secreto —está impresa, se fotocopia, se deja en
     porterías— y al otro lado están las respuestas del formulario, que en una
     ficha de caracterización incluyen fecha de nacimiento, comuna, identidad
     de género, autorreconocimiento étnico, situación de víctima y
     discapacidad. Con el documento suelto esto sería un buscador de personas. */
  assert.match(REG, /if \(!doc \|\| !correo\.includes\('@'\)\) return null;/);
  assert.match(CUERPO, /porDocumentoYCorreo\(/);
  /* Y en la ruta, la rama del documento pasa los dos. */
  assert.match(CUERPO, /documento: req\.body\?\.documento, email: req\.body\?\.email/);
});

test('se busca por correo primero y el documento comprueba después', () => {
  /* `guest_email` acota a un puñado de filas; el documento vive dentro de un
     jsonb y buscarlo primero obligaría a recorrer las boletas del evento. Y
     así el documento nunca decide solo: es la segunda comprobación. */
  const i = REG.indexOf("eq('guest_email'");
  const j = REG.indexOf('normalizar(t.respuestas');
  assert.ok(i > 0 && j > i, 'el documento se comprueba antes que el correo');
});

test('el documento se compara sin puntos ni guiones', () => {
  /* «1.099.123-4» y «10991234» son la misma cédula escrita por dos personas. */
  const { normalizar } = require('../lib/miRegistroAnterior.js');
  assert.equal(normalizar('1.099.123-4'), normalizar('10991234'));
  assert.equal(normalizar(' 10 991 234 '), '10991234');
  assert.equal(normalizar(null), '');
});

test('se miran TODAS las preguntas de documento, no sólo la primera', () => {
  /* Un evento puede preguntar «documento del titular» y «del acompañante»;
     mirar sólo la primera deja fuera a quien se registró por la otra. */
  const { camposDocumento } = require('../lib/miRegistroAnterior.js');
  const campos = [
    { id: 'a', tipo: 'texto' },
    { id: 'b', tipo: 'documento' },
    { id: 'c', tipo: 'documento' },
  ];
  assert.deepEqual(camposDocumento(campos).map(c => c.id), ['b', 'c']);
});

test('la más reciente gana', () => {
  /* Si alguien se registró dos veces, lo último que escribió es lo que quiere
     volver a usar. */
  assert.match(REG, /order\('created_at', \{ ascending: false \}\)/);
});

test('sale de las boletas del evento, no del padrón', () => {
  /* El padrón es una lista que el organizador sube a mano y está
     desactualizada desde que alguien se registra. */
  assert.match(REG, /from\('tickets'\)/);
  assert.equal(/padron_previo/.test(REG), false);
});
