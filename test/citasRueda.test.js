/* Las citas de la rueda de negocios.
 *
 * ── Qué se protege aquí ──────────────────────────────────────────────────
 *
 * Las notas de una rueda son de lo más sensible que guarda la plataforma: con
 * quién hablaste y qué te pareció. Y la parrilla la maneja el equipo, que
 * puede mover a alguien de casilla.
 *
 * Tres cosas que no se pueden aflojar, y una que se aprendió con las zonas.
 *
 * Correr: npm test */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba-que-no-es-el-de-produccion';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'networking.js'), 'utf8');
const LIMPIO = SRC.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('nadie escribe notas en la cita de otro', () => {
  /* Sin el filtro por `user_id`, cualquiera con boleta del evento escribiría
     en la cita ajena cambiando el id de la URL. */
  const i = LIMPIO.indexOf("'/:eventoId/networking/citas/:citaId/notas'");
  assert.ok(i > 0, 'no existe la ruta de notas');
  const bloque = LIMPIO.slice(i, i + 1200);
  assert.match(bloque, /\.eq\('user_id', req\.user\.id\)/,
    'la ruta de notas no filtra por la persona: se puede escribir en la cita de otro');
});

test('la parrilla del equipo no reparte las notas enteras', () => {
  /* El equipo necesita saber si una reunión dejó algo escrito; no leerlo. */
  const i = LIMPIO.indexOf("router.get('/:eventoId/networking/citas'");
  assert.ok(i > 0, 'no existe la parrilla');
  const bloque = LIMPIO.slice(i, LIMPIO.indexOf('router.patch', i));
  assert.match(bloque, /notas\.slice\(0, \d+\)/,
    'la parrilla manda las notas completas: son apuntes personales, no material de trabajo');
  assert.match(bloque, /tiene_notas/, 'no se dice si hay notas sin mandarlas');
});

test('mover una cita comprueba que el horario es de ESTE evento', () => {
  /* Sin comprobarlo, un id de otro evento saca la cita de su rueda y deja de
     aparecer en las dos. */
  const i = LIMPIO.indexOf("router.patch('/:eventoId/networking/citas/:citaId'");
  const bloque = LIMPIO.slice(i, i + 2500);
  assert.match(bloque, /expositor\?\.evento_id !== eventoId/,
    'se puede mover una cita a un horario de otro evento');
});

test('una casilla ocupada da 409, no un 500', () => {
  /* Arrastrar a alguien encima de otro es un caso NORMAL al reorganizar. Un
     500 se lee como que la aplicación se rompió, y quien está reorganizando la
     parrilla el día del evento deja de tocarla. */
  const i = LIMPIO.indexOf("router.patch('/:eventoId/networking/citas/:citaId'");
  const bloque = LIMPIO.slice(i, i + 3200);
  assert.match(bloque, /error\.code === '23505'[\s\S]{0,120}status\(409\)/,
    'chocar dos citas en la misma casilla devuelve 500');
});

test('el modo lo decide el evento, no quien reserva', () => {
  const i = LIMPIO.indexOf('reservar');
  const bloque = LIMPIO.slice(i, i + 2500);
  assert.match(bloque, /networking_modo/, 'reservar no mira el modo del evento');
  assert.match(bloque, /'solicitada' : 'confirmada'/,
    'el modo solicitud no deja la cita pendiente');
  assert.ok(!/req\.body[^\n]*estado/.test(bloque),
    'el estado inicial viene del cuerpo de la petición: entonces lo decide quien reserva');
});

test('«mis citas» enseña también las que están pedidas', () => {
  /* Antes filtraba por `confirmada`: en modo solicitud, la persona pedía la
     cita y la pantalla se quedaba igual que antes de pedirla. */
  const i = LIMPIO.indexOf("'/:eventoId/networking/mis-citas'");
  const bloque = LIMPIO.slice(i, i + 1400);
  assert.ok(!/\.eq\('estado', 'confirmada'\)/.test(bloque),
    'mis-citas vuelve a enseñar sólo las confirmadas: una cita pedida no aparecería');
  assert.match(bloque, /\.neq\('estado', 'cancelada'\)/, 'se están enseñando las canceladas');
});

test('la migración está escrita y es reversible', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '0104_citas_con_notas_y_gestion.sql'), 'utf8');
  for (const col of ['notas', 'nota_gestor', 'creada_por', 'networking_modo']) {
    assert.ok(sql.includes(col), `la migración no añade \`${col}\``);
  }
  assert.match(sql, /Rollback/);
});

test('el modo se puede guardar desde el panel', () => {
  /* `eventos.networking_modo` existe en la base y el servidor la consulta en
     cada reserva. Pero la ruta que edita un evento descarta EN SILENCIO lo que
     no está en `CAMPOS_EDITABLES` —y hace bien—, así que sin esta línea el
     selector del panel guardaría en el vacío: la pantalla diría «guardado» y
     el modo no cambiaría nunca.

     Es la misma trampa de siempre: no falla nada, simplemente no pasa nada. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'eventos.js'), 'utf8');
  const i = src.indexOf('CAMPOS_EDITABLES = [');
  const bloque = src.slice(i, src.indexOf('];', i));
  assert.ok(bloque.includes("'networking_modo'"),
    'el modo de la rueda no se puede guardar: la lista blanca de campos editables no lo incluye');
});
