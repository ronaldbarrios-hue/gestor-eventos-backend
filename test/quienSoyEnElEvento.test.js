/* La misma persona, con cuenta y sin ella.
 *
 * ── La relación que no existía ───────────────────────────────────────────
 *
 * Comprar una boleta es anónimo a propósito: de la mayoría de asistentes lo
 * único que queda es su correo (`guest_email`, con `user_id` en nulo). Y desde
 * la 0108 el equipo puede sentar a alguien en la rueda con sólo ese correo.
 *
 * Después esa persona se hace una cuenta con EL MISMO correo, y todo lo que la
 * busca por `user_id` deja de encontrarla. Entraba a «Mis citas» y veía CERO
 * citas teniendo tres. No falla nada: la fila está, y quien la busca mira
 * donde no está.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { filtroDeMio, esMia } = require('../lib/quienSoyEnElEvento.js');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('se busca por cuenta Y por correo', () => {
  const f = filtroDeMio({ id: 'u1', email: 'ana@x.co' });
  assert.ok(f.includes('user_id.eq.u1'));
  assert.ok(f.includes('guest_email.eq.ana@x.co'));
});

test('el correo se compara en minúsculas', () => {
  /* Así se guarda al comprar. Comparar sin normalizar deja fuera a quien
     escribió su correo con una mayúscula — que es media población. */
  assert.ok(filtroDeMio({ id: 'u1', email: '  Ana@X.CO ' }).includes('guest_email.eq.ana@x.co'));
});

test('sin correo o sin cuenta sigue habiendo filtro', () => {
  /* Un filtro vacío en un `.or()` no acota nada: devolvería las citas de todo
     el evento. Aquí siempre queda al menos una de las dos mitades. */
  assert.equal(filtroDeMio({ id: 'u1' }), 'user_id.eq.u1');
  assert.equal(filtroDeMio({ email: 'ana@x.co' }), 'guest_email.eq.ana@x.co');
});

test('`esMia` reconoce las dos formas y rechaza la ajena', () => {
  const yo = { id: 'u1', email: 'ana@x.co' };
  assert.equal(esMia({ user_id: 'u1' }, yo), true);
  assert.equal(esMia({ user_id: null, guest_email: 'ANA@x.co' }, yo), true);
  assert.equal(esMia({ user_id: 'u2' }, yo), false);
  assert.equal(esMia({ user_id: null, guest_email: 'otro@x.co' }, yo), false);
  assert.equal(esMia(null, yo), false);
  assert.equal(esMia({ user_id: 'u1' }, null), false);
});

test('una fila sin dueño no es de nadie', () => {
  /* Ni con un usuario sin correo: `'' === ''` habría hecho suya toda fila
     anónima del evento. */
  assert.equal(esMia({ user_id: null, guest_email: null }, { id: 'u1', email: '' }), false);
  assert.equal(esMia({ user_id: null, guest_email: '' }, { id: 'u1', email: 'ana@x.co' }), false);
});

/* ── Las rutas que lo usan ───────────────────────────────────────────── */

const R = sinComentarios(leer('routes/networking.js'));

test('«mis citas» encuentra las que se reservaron por correo', () => {
  /* Éste es el fallo con víctima: tres citas puestas por el equipo con su
     correo, y la persona entra a su cuenta y ve cero. */
  const i = R.indexOf("networking/mis-citas'");
  const bloque = R.slice(i, R.indexOf('\nrouter.', i + 10));
  assert.match(bloque, /\.or\(filtroDeMio\(req\.user\)\)/);
  assert.doesNotMatch(bloque, /\.eq\('user_id', req\.user\.id\)/);
});

test('y puede cancelarlas', () => {
  /* Si no, esa casilla se queda ocupada toda la jornada y nadie más la usa. */
  const i = R.indexOf("router.delete('/:eventoId/networking/citas/:citaId'");
  assert.ok(i > 0, 'no encuentro la ruta de cancelar');
  const bloque = R.slice(i, R.indexOf('\nrouter.', i + 10));
  assert.match(bloque, /\.or\(filtroDeMio\(req\.user\)\)/);
});

test('el tope cuenta también las citas que tiene por correo', () => {
  /* Si no, quien compró como invitado y luego se hizo cuenta empezaría el tope
     de cero y se llevaría el doble de citas que los demás. */
  const i = R.indexOf('const tope = topeValido(');
  const bloque = R.slice(i, i + 700);
  assert.match(bloque, /\.or\(filtroDeMio\(req\.user\)\)/);
});

test('no se adopta la fila al iniciar sesión', () => {
  /* Sería el atajo obvio: poner `user_id` en toda fila con ese correo al
     entrar. Escribir sobre boletas y citas ajenas en cada login es una
     operación grande disparada por algo tan común como entrar, y basta un
     correo repetido en dos cuentas para que alguien se lleve lo de otro.
     Leer por los dos lados da el mismo resultado y no escribe nada. */
  const lib = leer('lib/quienSoyEnElEvento.js');
  assert.match(lib, /Por qué NO se adopta la fila al entrar/);
  assert.doesNotMatch(sinComentarios(lib), /update\(/);
});
