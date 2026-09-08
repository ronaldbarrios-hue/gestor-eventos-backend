/* El co-dueño: `*`, y que los dos guardias digan lo mismo.
 *
 * ── El caso ──────────────────────────────────────────────────────────────
 *
 * En FESTECH el evento lo llevan varias organizaciones y todas mandan igual.
 * El rol más alto del catálogo, «Administrador», enumera 22 permisos y aun así
 * no llega a cinco pantallas, porque el panel las reservaba a quien figura como
 * dueño. La salida hasta hoy era compartir la cuenta del dueño — que es lo peor
 * posible: la auditoría no distingue quién hizo qué, y quitarle el acceso a uno
 * obliga a cambiarle la contraseña a todos.
 *
 * ── El fallo de fondo ────────────────────────────────────────────────────
 *
 * `core/permisos/puede()` YA trataba `*` como «puede todo». `lib/acceso.js` —la
 * que usan las 58 rutas de verdad— no lo conocía. Dos guardias sobre los mismos
 * datos con dos reglas distintas sobre la misma cadena: pasabas uno y te paraba
 * el otro, según cuál corriera.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { puede } = require('../core/permisos/index.js');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');

const YO = { id: 'u-1' };

test('el comodín vale para cualquier acción', () => {
  const recurso = { ownerId: 'otro', permisos: ['*'] };
  for (const a of ['evento:editar', 'checkin', 'ver_pagos', 'una_accion_que_no_existe']) {
    assert.equal(puede(YO, a, recurso), true, `«${a}» se negó a un co-dueño`);
  }
});

test('sin comodín, sólo lo concedido', () => {
  const recurso = { ownerId: 'otro', permisos: ['checkin'] };
  assert.equal(puede(YO, 'checkin', recurso), true);
  assert.equal(puede(YO, 'ver_pagos', recurso), false);
});

test('los dos guardias entienden `*` igual', () => {
  /* Ésta es la prueba del día. `lib/acceso.js` es quien vigila las 58 rutas;
     si sólo lo entiende `core/permisos`, un co-dueño ve la pantalla y recibe
     403 al pulsar — que es peor que no verla. */
  const acceso = leer('lib/acceso.js');
  assert.match(acceso, /tiene\.has\('\*'\)/,
    'lib/acceso.js no conoce el comodín: el co-dueño chocaría con las rutas');
  assert.match(leer('core/permisos/index.js'), /tiene\.has\('\*'\)/);
});

test('borrar el evento NO pasa por ahí', () => {
  /* Es la mitad que hace que conceder `*` sea razonable. La ruta compara
     `owner_id` a mano, con su motivo escrito. Si algún día pasara por
     `assertPermiso`, un co-dueño podría borrar el evento sin que nadie lo
     hubiera decidido. */
  const rutas = leer('routes/eventos.js');
  const i = rutas.indexOf("router.delete('/:id'");
  assert.ok(i > 0, 'no encuentro la ruta de borrar');
  const bloque = rutas.slice(i, i + 700);
  assert.match(bloque, /actual\.owner_id !== req\.user\.id/);
  assert.doesNotMatch(bloque, /assertPermiso|assertOwner/);
});

/* Lo que el catálogo del panel le dice a quien arma un rol —que `*` no
   incluye borrar el evento— se comprueba en el otro repositorio, que es donde
   vive ese archivo: `tests/coDuenoDelEvento.test.mjs`. Comprobarlo desde aquí
   obligaría a que los dos repos estén clonados uno al lado del otro, y una
   prueba que sólo pasa según cómo esté el disco no dice nada. */
