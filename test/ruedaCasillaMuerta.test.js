/* La casilla de la rueda que se veía libre y no se podía reservar.
 *
 * ── Lo que pasaba ────────────────────────────────────────────────────────
 *
 * El índice único de `networking_citas` es sobre `horario_id` A SECAS —
 * comprobado contra producción, no es parcial—. Así que una cita CANCELADA
 * sigue ocupando su casilla en la base.
 *
 * Pero la disponibilidad que se pinta descarta las canceladas, y cancelar
 * desde la parrilla no borra la fila (guarda el histórico y la nota del
 * equipo). Resultado: cada cancelación del organizador dejaba una casilla
 * muerta. Se veía libre, se pulsaba, y contestaba «ese horario ya fue
 * reservado por alguien más» — por alguien que había cancelado. Para siempre,
 * y sin forma de arreglarlo desde ninguna pantalla.
 *
 * El comentario del código decía justo lo contrario («el índice único deja
 * reservar encima»), que es por lo que nadie lo vio.
 *
 * ── El arreglo ───────────────────────────────────────────────────────────
 *
 * Al chocar con el 23505 se reutiliza la fila cancelada, con
 * `.eq('estado', 'cancelada')` de candado: si entre el insert y eso otra
 * persona se llevó la casilla, no toca ninguna fila y se contesta el 409 de
 * verdad.
 *
 * Comprobado en Postgres con el mismo índice:
 *   · casilla con una cancelada → insert 0 filas, revive 1, queda 1 fila.
 *   · casilla con una CONFIRMADA → revive 0. La reserva ajena no se toca.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'networking.js'), 'utf8').replace(/\r/g, '');

test('reservar reutiliza la casilla de una cita cancelada', () => {
  assert.match(SRC, /\.eq\('horario_id', horarioId\)\s*\n\s*\.eq\('estado', 'cancelada'\)\s*\n\s*\.select\('id, estado'\)/,
    'volvió a contestar 409 sin mirar si quien ocupa la casilla ya canceló');
  assert.match(SRC, /if \(!revividas \|\| revividas\.length === 0\) \{\s*\n\s*return res\.status\(409\)/,
    'se da por buena la reutilización sin comprobar que tocó una fila: dos personas en la misma mesa');
  /* Las notas son de la reserva anterior: quedarse con ellas le enseña a la
     persona nueva lo que escribió otra. */
  assert.match(SRC, /notas: null, nota_gestor: null,/,
    'la cita reutilizada se queda con las notas de quien la tenía antes');
});

test('sentar a alguien a mano tropieza con lo mismo, y se arregla igual', () => {
  const i = SRC.indexOf("router.post('/:eventoId/networking/citas'");
  assert.ok(i > 0, 'no encuentro la ruta de armar la agenda a mano');
  const ruta = SRC.slice(i, i + 3000);
  assert.match(ruta, /\.eq\('estado', 'cancelada'\)/,
    'el organizador vuelve a chocar con una casilla que en su parrilla está vacía');
});

test('mover una cita a una casilla cancelada la libera antes', () => {
  /* Aquí no se puede reutilizar la fila —la que se mueve es otra—, así que se
     quita la cancelada. Es lo único que libera el hueco. */
  assert.match(SRC, /\.delete\(\)\s*\n\s*\.eq\('horario_id', req\.body\.horario_id\)\s*\n\s*\.eq\('evento_id', eventoId\)\s*\n\s*\.eq\('estado', 'cancelada'\)/,
    'arrastrar a alguien a una casilla que en pantalla está vacía vuelve a decir «ya está ocupada»');
});

test('el comentario ya no dice lo contrario de lo que hace la base', () => {
  /* El comentario viejo afirmaba que el índice único dejaba reservar encima de
     una cancelada. No es verdad, y por eso el fallo llevaba ahí sin verse: lo
     que se leía en el código contradecía lo que hacía Postgres. */
  assert.doesNotMatch(SRC, /el índice único deja reservar encima/,
    'volvió el comentario que afirma algo falso sobre el índice');
});
