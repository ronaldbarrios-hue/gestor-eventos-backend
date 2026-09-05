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
  const ruta = SRC.slice(i, i + 8000);
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

test('la parrilla no pide una relación que la base no tiene', () => {
  /* `networking_citas.user_id` apunta a `auth.users`, no a `public.profiles`
     —comprobado contra la API: PGRST200, «no matches were found»—. Así que
     `profiles!user_id(...)` dentro del select NO funciona.

     Costó dos pantallas y de formas distintas:
       · la parrilla enseñaba el error crudo en la cara;
       · la vista de gestión NO miraba el error, así que `citas` volvía null y
         TODAS las casillas se pintaban libres. Una agenda llena que se ve
         vacía es peor que un error, porque nadie va a ir a mirar.

     Se resuelve con una segunda consulta a `profiles` y un mapa. */
  /* Sin comentarios: el motivo escrito NOMBRA el embed que estaba mal —«no se
     puede pedir con un profiles!user_id»— y sin quitarlos la prueba se caza a
     sí misma en vez de al código. */
  const sinComentarios = SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(sinComentarios, /profiles!user_id/,
    'volvió el embed de profiles: la base no declara esa relación y PostgREST contesta PGRST200');
  assert.match(SRC, /async function personasDeLasCitas\(citas\)/,
    'desapareció la consulta que trae quién es cada persona');
  assert.match(SRC, /if \(eCitas\) return res\.status\(500\)\.json\(\{ error: eCitas\.message \}\);/,
    'la vista de gestión volvió a tragarse el error: pintaría toda la agenda libre');
});

test('se puede sentar a alguien con sólo su correo', () => {
  /* Hay ruedas donde la agenda la arma el equipo entera: nadie reserva ni
     aprueba. Antes hacía falta el `user_id` de una cuenta de GESTEK, y la
     mayoría de quien compra una boleta no tiene cuenta — la compra es anónima
     a propósito. Con esa regla, armar la agenda a mano era imposible para casi
     todos los asistentes. */
  const i = SRC.indexOf("router.post('/:eventoId/networking/citas'");
  const ruta = SRC.slice(i, i + 8000);

  assert.match(ruta, /const correo = String\(req\.body\?\.email \|\| ''\)\.trim\(\)\.toLowerCase\(\);/,
    'ya no se acepta un correo, o se acepta sin normalizar — «Juan@X.com» y «juan@x.com» acabarían con dos agendas');

  /* Tiene que ir al evento. Sin esto se podría sentar a cualquier correo del
     mundo: la persona no aparece, la mesa se queda vacía, y el hueco ya no se
     puede dar a otro. */
  assert.match(ruta, /\.eq\('evento_id', eventoId\)\s*\n\s*\.eq\('guest_email', correo\)/,
    'ya no se comprueba que ese correo tenga boleta de ESTE evento');
  assert.match(ruta, /está registrado en este evento/,
    'un correo desconocido deja de decir por qué no se puede');

  /* Si tiene cuenta, se guarda como cuenta: así ve la cita en «Mis citas» al
     entrar, en vez de quedarse con dos agendas para el mismo humano. */
  assert.match(ruta, /if \(perfil\?\.id\) user_id = perfil\.id;/,
    'a quien sí tiene cuenta se le crearía una cita huérfana de su perfil');

  /* Y el aviso interno sólo va a quien tiene cuenta: es una notificación
     dentro de GESTEK, y mandarla a un `null` no avisa a nadie. */
  assert.match(ruta, /if \(user_id\) \{\s*\n\s*notificar\(\{/,
    'se notifica a un usuario que puede no existir');
});

test('la parrilla enseña también a quien no tiene cuenta', () => {
  /* Sin el respaldo, a quien el equipo sentó por correo se le veía la casilla
     ocupada y el nombre en blanco: imposible saber a quién llamar. */
  assert.match(SRC, /c\.guest_email \? \{ nombre: c\.guest_nombre \|\| null, email: c\.guest_email, sin_cuenta: true \}/,
    'una cita puesta por correo sale sin nombre en la parrilla');
});

test('la migración deja claro que una cita es de alguien', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '0108_citas_a_mano_por_correo.sql'), 'utf8');
  assert.match(sql, /alter column user_id drop not null/i);
  /* Con cuenta o con correo, pero de alguien: una cita sin dueño no se le
     puede enseñar a nadie ni avisar, y sería una casilla ocupada por nadie. */
  assert.match(sql, /check \(user_id is not null or guest_email is not null\)/i,
    'se podría crear una cita sin dueño');
});
