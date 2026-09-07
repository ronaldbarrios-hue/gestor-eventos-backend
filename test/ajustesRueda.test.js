/* Los tres ajustes de la rueda (0113).
 *
 * ── Lo que estas pruebas cuidan ──────────────────────────────────────────
 *
 * Lo mismo en los tres casos: que el ajuste no se rompa en el hueco entre
 * desplegar el código y aplicar la migración. Es el modo de fallo de este
 * proyecto —el valor se muda, alguien lee donde estaba, y no falla nada:
 * simplemente no hay nada—, y aquí saldría como «este evento no tiene rueda»
 * en todos los eventos que sí la tienen.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ruedaEncendida, CATEGORIAS_HEREDADAS, MENSAJE_APAGADA,
  topeValido, TOPE_MAX, alcanzoElTope, cuentaParaElTope, mensajeDeTope,
  estaBloqueado, mensajeDeBloqueo, limpiarMotivo, MOTIVO_MAX,
} = require('../lib/ajustesRueda.js');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '');

/* ── 1 · Quién decide que hay rueda ──────────────────────────────────── */

test('la decide quien organiza, no la categoría', () => {
  /* El caso que abre la puerta a una cámara de comercio: una rueda de
     agroindustria o de turismo, categorías que ni existen en el catálogo. */
  const agro = { networking_activo: true, categoria: { slug: 'otros' } };
  assert.equal(ruedaEncendida(agro), true);

  /* Y al revés: un taller de tecnología que no tiene rueda ninguna dejaba de
     poder esconder la pestaña. */
  const taller = { networking_activo: false, categoria: { slug: 'tecnologia' } };
  assert.equal(ruedaEncendida(taller), false);
});

test('sin la migración se contesta lo de ayer, no «no hay rueda»', () => {
  /* Si el código sube antes que la 0113, la columna no existe. Apagar toda
     rueda existente ese rato es exactamente el fallo callado de siempre. */
  const ev = { categoria: { slug: 'negocios' } };
  assert.equal(ruedaEncendida(ev, { columnaExiste: false }), true);
  assert.equal(ruedaEncendida({ categoria: { slug: 'deportes' } }, { columnaExiste: false }), false);

  /* Y una fila donde la columna vino nula —que no es lo mismo que `false`—
     también cae en la regla vieja. */
  assert.equal(ruedaEncendida({ networking_activo: null, categoria: { slug: 'negocios' } }), true);
});

test('sin evento no hay rueda, y no revienta', () => {
  assert.equal(ruedaEncendida(null), false);
  assert.equal(ruedaEncendida(undefined), false);
  assert.equal(ruedaEncendida({}), false);
});

test('la lista vieja sigue siendo la vieja', () => {
  /* Es una red de seguridad, no una regla nueva: si alguien la amplía aquí
     creyendo que abre categorías, sólo cambiaría el valor inicial de los
     eventos que se crearon antes de la 0113. */
  assert.deepEqual(CATEGORIAS_HEREDADAS, ['negocios', 'marketing', 'tecnologia']);
});

test('el mensaje dice dónde se enciende', () => {
  /* «No disponible» a secas manda a abrir un ticket. Decir dónde está el
     interruptor lo resuelve quien lo lee. */
  assert.match(MENSAJE_APAGADA, /ajustes del evento/i);
});

/* ── 2 · El tope de citas ────────────────────────────────────────────── */

test('sin tope, nada cambia', () => {
  assert.equal(topeValido(null), null);
  assert.equal(topeValido(''), null);
  assert.equal(topeValido(undefined), null);
  assert.equal(alcanzoElTope({ citas: Array(50).fill({ estado: 'confirmada' }), tope: null }), false);
});

test('el tope rechaza lo que el CHECK rechazaría', () => {
  /* Si esto pasara, la base contestaría «violates check constraint» y eso es
     lo que vería quien escribió el número. */
  assert.equal(topeValido(0), undefined);
  assert.equal(topeValido(-3), undefined);
  assert.equal(topeValido(1.5), undefined);
  assert.equal(topeValido('cinco'), undefined);
  assert.equal(topeValido(TOPE_MAX + 1), undefined);
  assert.equal(topeValido(TOPE_MAX), TOPE_MAX);
  assert.equal(topeValido('5'), 5);
});

test('las canceladas no gastan cupo', () => {
  /* Si contaran, el tope sería un contador de intentos: quien se equivoca dos
     veces de hora se queda sin rueda, y cancelar no devolvería nada. */
  assert.equal(cuentaParaElTope({ estado: 'cancelada' }), false);
  assert.equal(cuentaParaElTope({ estado: 'confirmada' }), true);
  /* Las pedidas sí: una solicitud pendiente ocupa una casilla de verdad. */
  assert.equal(cuentaParaElTope({ estado: 'solicitada' }), true);

  const citas = [
    { id: 'a', estado: 'confirmada' },
    { id: 'b', estado: 'cancelada' },
    { id: 'c', estado: 'cancelada' },
  ];
  assert.equal(alcanzoElTope({ citas, tope: 2 }), false);
});

test('el tope se alcanza en el número, no después', () => {
  const dos = [{ id: 'a', estado: 'confirmada' }, { id: 'b', estado: 'solicitada' }];
  assert.equal(alcanzoElTope({ citas: dos, tope: 3 }), false);
  assert.equal(alcanzoElTope({ citas: dos, tope: 2 }), true);
});

test('mover una cita no cuenta contra sí misma', () => {
  /* Con tope 1, mover la única cita a otra hora tenía que seguir siendo
     posible: la que se mueve no ocupa dos sitios. */
  const citas = [{ id: 'a', estado: 'confirmada' }];
  assert.equal(alcanzoElTope({ citas, tope: 1, exceptoId: 'a' }), false);
  assert.equal(alcanzoElTope({ citas, tope: 1 }), true);
});

test('el mensaje del tope se lee en singular', () => {
  assert.match(mensajeDeTope(1), /una sola cita/);
  assert.match(mensajeDeTope(5), /5 citas/);
});

/* ── 3 · Las franjas bloqueadas ──────────────────────────────────────── */

test('sin la migración ninguna franja está bloqueada', () => {
  /* Una fila leída sin las columnas nuevas no puede parecer bloqueada: eso
     dejaría una rueda entera sin poder reservar nada. */
  assert.equal(estaBloqueado({ id: 'x', inicio: '2026-09-17T10:00:00Z' }), false);
  assert.equal(estaBloqueado(null), false);
  assert.equal(estaBloqueado({ bloqueado: false }), false);
  assert.equal(estaBloqueado({ bloqueado: true }), true);
});

test('el motivo se dice si lo hay', () => {
  /* Una casilla que se ve igual que las libres y contesta «no disponible»
     parece un fallo de la aplicación. */
  assert.match(mensajeDeBloqueo({ bloqueado: true, bloqueo_motivo: 'almuerzo' }), /almuerzo/);
  assert.match(mensajeDeBloqueo({ bloqueado: true }), /no está disponible/);
  assert.match(mensajeDeBloqueo({ bloqueado: true, bloqueo_motivo: '   ' }), /no está disponible/);
});

test('el motivo cabe en una casilla de la parrilla', () => {
  const largo = limpiarMotivo('x'.repeat(500));
  assert.equal(largo.length, MOTIVO_MAX);
  assert.equal(limpiarMotivo('  llega   a  las 11:30 '), 'llega a las 11:30');
  assert.equal(limpiarMotivo('   '), null);
  assert.equal(limpiarMotivo(null), null);
});

/* ── La ruta ─────────────────────────────────────────────────────────── */

const RUTA = leer('routes/networking.js');
const RUTA_LIMPIA = sinComentarios(RUTA);

test('la lista de categorías ya no vive en la ruta', () => {
  /* Estaba escrita dos veces —aquí y en EventWorkspace.jsx— y dos copias de
     una regla acaban separándose. */
  assert.doesNotMatch(RUTA_LIMPIA, /CATEGORIAS_PERMITIDAS/);
  assert.match(RUTA_LIMPIA, /assertRuedaActiva/);
});

test('sentar a mano ya no nombra una variable que no existe', () => {
  /* `userId` no está declarado en ese ámbito: la línea reventaba con
     ReferenceError antes de comprobar nada, y es justo la función de armar la
     agenda entera con sólo el correo. */
  assert.doesNotMatch(RUTA_LIMPIA, /citaQueSolapa\(\{ eventoId, userId, guestEmail: guest_email/);
  assert.match(RUTA_LIMPIA, /citaQueSolapa\(\{ eventoId, userId: user_id, guestEmail: guest_email/);
});

test('una franja bloqueada no se puede reservar', () => {
  assert.match(RUTA_LIMPIA, /if \(estaBloqueado\(horario\)\) \{[\s\S]{0,200}status\(409\)/);
});

test('no se cuenta el tope contra una base que tosió', () => {
  /* Al revés que el modo: aquí equivocarse por exceso llena la agenda de una
     empresa y vacía la de otras. */
  assert.match(RUTA_LIMPIA, /if \(eMias\) return res\.status\(500\)/);
});

test('bloquear una casilla ocupada se rechaza', () => {
  /* Bloquearla sin más dejaría a alguien esperando en la mesa sin que nadie
     se lo dijera. */
  assert.match(RUTA_LIMPIA, /router\.patch\('\/:eventoId\/networking\/horarios\/:id'/);
  assert.match(RUTA_LIMPIA, /Cancélala primero: bloquearla sin más/);
});

test('soltar la franja limpia el motivo', () => {
  /* Un «llega a las 11:30» que sobrevive al desbloqueo reaparece la próxima
     vez, con otra fecha y sin sentido. */
  assert.match(RUTA_LIMPIA, /bloqueo_motivo: bloquear \? limpiarMotivo\(req\.body\.motivo\) : null/);
});

test('los horarios se piden con las columnas nuevas y sin ellas', () => {
  /* Pedirlas antes de la migración contestaría error y la reserva entera se
     caería, cuando lo correcto es que sin la 0113 no haya bloqueos — no que no
     haya reservas. */
  for (const fn of ['horarioDelEvento', 'horariosDeExpositores']) {
    assert.match(RUTA_LIMPIA, new RegExp(`async function ${fn}`), `falta ${fn}`);
  }
  assert.match(RUTA_LIMPIA, /if \(error\) \(\{ data, error \} = await pedir\(SIN\)\);/);
  assert.match(RUTA_LIMPIA, /if \(error\) \(\{ data, error \} = await pedir\('id, expositor_id, inicio, fin'\)\);/);
});

test('la disponibilidad pública marca la franja bloqueada aparte de la ocupada', () => {
  /* `disponible: false` para que ninguna pantalla vieja la ofrezca, y además
     su bandera: «bloqueada» y «reservada» no son lo mismo para quien mira. */
  assert.match(RUTA_LIMPIA, /disponible: !cita && !estaBloqueado\(h\)/);
  assert.match(RUTA_LIMPIA, /bloqueado: estaBloqueado\(h\) \|\| undefined/);
});

/* ── Los ajustes se pueden guardar ───────────────────────────────────── */

test('las dos columnas nuevas se pueden guardar desde el panel', () => {
  /* La ruta descarta en silencio lo que no está en la lista: sin esto, el
     interruptor guardaría en el vacío y nadie vería un error. */
  const ev = sinComentarios(leer('routes/eventos.js'));
  assert.match(ev, /'networking_activo', 'networking_tope_por_empresa'/);
  assert.match(ev, /topeValido\(updates\.networking_tope_por_empresa\)/);
});

/* ── La migración ────────────────────────────────────────────────────── */

const SQL = leer('db/migrations/0113_la_rueda_la_decide_quien_organiza.sql');

test('la migración es aditiva y reversible', () => {
  const soloSql = sinComentarios(SQL);
  assert.doesNotMatch(soloSql, /drop (column|table)/i);
  assert.match(SQL, /-- Vuelta atrás/);
});

test('nadie pierde la rueda que ya tenía', () => {
  /* La columna nace en `false`, así que sin este relleno todo evento con rueda
     se quedaría sin ella el día de aplicar la migración. Se rellena por las
     tres categorías de siempre Y por tener expositores: si alguien montó
     mesas, la rueda existe, sea cual sea la categoría. */
  assert.match(SQL, /update public\.eventos/);
  assert.match(SQL, /slug in \('negocios', 'marketing', 'tecnologia'\)/);
  assert.match(SQL, /from public\.networking_expositores x where x\.evento_id = e\.id/);
});

test('el tope tiene el mismo techo aquí y en el código', () => {
  /* Dos números distintos serían un formulario que acepta lo que la base
     rechaza — el error llegaría desde Postgres y sin traducir. */
  assert.match(SQL, new RegExp(`between 1 and ${TOPE_MAX}`));
});
