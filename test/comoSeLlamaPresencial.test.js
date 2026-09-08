/* «Presencial» y «físico» eran dos nombres para lo mismo.
 *
 * ── Cómo salió ───────────────────────────────────────────────────────────
 *
 * Publicando un concierto desde el Gestbot, el aviso dijo: «Es un evento en
 * línea y no tiene enlace de conexión». Era un concierto en un coliseo.
 *
 * La plataforma guarda `fisico` —13 de los 15 eventos de la base— y la
 * herramienta del agente declaraba y escribía `presencial`. No había ninguna
 * lista canónica en ninguno de los dos repositorios: cada sitio comparaba
 * contra la cadena que le pareció.
 *
 * Y no era sólo el aviso: el editor del panel enseña los campos de lugar sólo
 * si la modalidad es `fisico` o `hibrido`, así que un evento creado por el
 * agente se quedaba **sin dirección visible en su propio editor**. Sin error.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MODALIDADES, normalizarModalidad, necesitaEnlace } = require('../lib/modalidad.js');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('«presencial» se guarda como lo que la plataforma compara', () => {
  assert.equal(normalizarModalidad('presencial'), 'fisico');
  assert.equal(normalizarModalidad('Presencial'), 'fisico');
  assert.equal(normalizarModalidad('físico'), 'fisico');
  assert.ok(MODALIDADES.includes(normalizarModalidad('presencial')));
});

test('y las otras dos también', () => {
  assert.equal(normalizarModalidad('online'), 'virtual');
  assert.equal(normalizarModalidad('remoto'), 'virtual');
  assert.equal(normalizarModalidad('mixto'), 'hibrido');
});

test('una modalidad inventada no deja el evento sin modalidad', () => {
  /* Un evento sin modalidad no se pinta en ninguna parte, y eso es peor que
     uno mal clasificado. */
  assert.equal(normalizarModalidad('lo que sea'), 'fisico');
  assert.equal(normalizarModalidad(null), 'fisico');
  assert.equal(normalizarModalidad(undefined), 'fisico');
});

test('un evento presencial NO pide enlace de conexión', () => {
  /* El fallo exacto: un concierto en un coliseo recibía «es un evento en
     línea y no tiene enlace». */
  assert.equal(necesitaEnlace('presencial'), false);
  assert.equal(necesitaEnlace('fisico'), false);
  assert.equal(necesitaEnlace('virtual'), true);
  assert.equal(necesitaEnlace('hibrido'), true);
});

test('el agente normaliza al escribir', () => {
  /* En el momento de guardar, que es donde importa. Prohibir «presencial» en
     el enunciado obligaría al modelo a acertar una palabra interna, y es lo
     que va a escribir quien le pida un evento a Claude. */
  const a = sinComentarios(leer('lib/agente.js'));
  assert.match(a, /modalidad: normalizarModalidad\(input\.modalidad\)/);
  assert.doesNotMatch(a, /modalidad: input\.modalidad \|\| 'presencial'/);
});

test('el aviso pregunta por la función, no compara cadenas sueltas', () => {
  /* Comparar `!== 'fisico'` a mano en cada sitio es exactamente cómo nació
     esto. */
  const av = sinComentarios(leer('lib/avisosDePublicacion.js'));
  assert.match(av, /necesitaEnlace\(evento\?\.modalidad\)/);
  assert.doesNotMatch(av, /modalidad !== 'fisico'/);
});
