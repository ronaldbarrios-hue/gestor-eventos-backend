/* Las boletas que se vendieron antes de que su tipo entrara al torneo.
 *
 * ── El agujero ───────────────────────────────────────────────────────────
 *
 * Quien mete al equipo es el disparador `trg_equipo_desde_boleta`, y su
 * definición —comprobada en producción— es:
 *
 *     AFTER INSERT OR UPDATE **OF estado** ON tickets
 *
 * Sólo corre cuando la boleta nace o cambia de estado. Así que el camino
 * normal de un evento que se arma de a poco deja gente fuera: se vende con
 * «Nada más» porque todavía no hay torneo, después se crea el torneo y se
 * cambia el tipo, y las boletas ya pagadas no entran — sin un solo error.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ESTADOS_CON_EQUIPO, NOMBRE_POR_DEFECTO,
  nombreDeEquipo, boletasSinEquipo, filasDeEquipo, avisoDeBoletasSueltas,
} = require('../lib/equiposDesdeBoletas.js');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('sólo las pagadas crean equipo, igual que el disparador', () => {
  /* Si aquí entrara `emitido`, una cortesía sin confirmar ocuparía plaza en el
     cuadro y habría que sacarla a mano. */
  assert.deepEqual(ESTADOS_CON_EQUIPO, ['pagado']);
  const tickets = [
    { id: 'a', estado: 'pagado' },
    { id: 'b', estado: 'emitido' },
    { id: 'c', estado: 'cancelado' },
    { id: 'd', estado: 'pagado' },
  ];
  assert.deepEqual(boletasSinEquipo(tickets).map(t => t.id), ['a', 'd']);
});

test('las que ya tienen equipo no se vuelven a meter', () => {
  /* `ticket_id` es único en `torneo_equipos`, así que un duplicado reventaría —
     pero el número que se le enseña a quien pulsa tiene que ser el de verdad. */
  const tickets = [{ id: 'a', estado: 'pagado' }, { id: 'b', estado: 'pagado' }];
  assert.deepEqual(boletasSinEquipo(tickets, new Set(['a'])).map(t => t.id), ['b']);
  assert.deepEqual(boletasSinEquipo(tickets, new Set(['a', 'b'])), []);
});

test('el nombre del equipo es el mismo que pondría el disparador', () => {
  /* Si aquí dijera otra cosa, media lista del torneo se llamaría «Equipo por
     confirmar» y la otra media «Sin nombre», según por dónde entró cada una. */
  assert.equal(NOMBRE_POR_DEFECTO, 'Equipo por confirmar');
  assert.equal(nombreDeEquipo({ guest_nombre: 'Casas Automáticas' }), 'Casas Automáticas');
  assert.equal(nombreDeEquipo({ guest_nombre: '   ' }), NOMBRE_POR_DEFECTO);
  assert.equal(nombreDeEquipo({}), NOMBRE_POR_DEFECTO);
});

test('la fila lleva las mismas columnas que el disparador', () => {
  const filas = filasDeEquipo([
    { id: 't1', estado: 'pagado', guest_nombre: 'Ana', guest_email: 'a@x.co', user_id: 'u1' },
  ], 'torneo-1');
  assert.deepEqual(filas, [{
    torneo_id: 'torneo-1', ticket_id: 't1', nombre: 'Ana',
    contacto_email: 'a@x.co', contacto_user_id: 'u1',
  }]);
});

test('sin correo ni cuenta la fila sigue siendo válida', () => {
  /* Una boleta emitida a mano por el equipo puede no tener ninguno de los dos.
     `undefined` reventaría la inserción; `null` no. */
  const [f] = filasDeEquipo([{ id: 't1', estado: 'pagado' }], 'torneo-1');
  assert.equal(f.contacto_email, null);
  assert.equal(f.contacto_user_id, null);
});

test('el aviso se lee en singular y no aparece cuando no hay nada', () => {
  assert.equal(avisoDeBoletasSueltas(0), null);
  assert.match(avisoDeBoletasSueltas(1), /1 boleta vendida/);
  assert.match(avisoDeBoletasSueltas(4), /4 boletas vendidas/);
});

/* ── Las rutas ───────────────────────────────────────────────────────── */

const R = sinComentarios(leer('routes/tickets.js'));

test('las dos rutas existen y piden el permiso de boletas', () => {
  assert.match(R, /tickets\/:ticketId\/boletas-sin-equipo', exige\(PERMS_TICKETS\)/);
  assert.match(R, /tickets\/:ticketId\/crear-equipos', exige\(PERMS_TICKETS\)/);
});

test('no se toca `estado` para que el disparador corra solo', () => {
  /* Sería el atajo obvio y es el que un día marca cien boletas como pagadas:
     `estado` es el dato del que cuelgan el aforo, el cobro y la entrada. */
  const trozo = R.slice(R.indexOf('crear-equipos'), R.indexOf('crear-equipos') + 1800);
  assert.doesNotMatch(trozo, /update\(\{\s*estado/);
  assert.match(trozo, /\.from\('torneo_equipos'\)\s*\n?\s*\.insert\(filasDeEquipo/);
});

test('no se crean equipos de un tipo que no los crea', () => {
  assert.match(R, /tipo\.crea !== 'equipo' \|\| !tipo\.crea_torneo_id/);
});

test('si no se pueden leer los equipos que ya hay, no se inserta a ciegas', () => {
  /* Insertar sin saber cuáles existían duplicaría los que ya estaban — y
     `ticket_id` es único, así que se caería la inserción entera y no se metería
     ninguno. */
  assert.match(R, /if \(eE\) return \{ error: eE\.message, sueltas: \[\] \};/);
});

test('pulsar dos veces no cuenta el mismo equipo dos veces', () => {
  assert.match(R, /if \(eIns && eIns\.code !== '23505'\)/);
});
