/* Conectar Claude con la cuenta: el MCP configurable desde GESTEK.
 *
 * ── El estado del que se partía ──────────────────────────────────────────
 *
 * El servidor MCP existía, montado y funcionando, exponiendo las 73
 * herramientas del Gestbot. La columna `api_tokens.scopes` existía. Y
 * `api_tokens` tenía **cero filas**, porque la pantalla de Integraciones sólo
 * ofrecía Google Calendar.
 *
 * O sea: la pieza estaba construida y era inalcanzable. El fallo de siempre en
 * esta base — existe y no hay control para llegar.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const alcance = require('../lib/alcanceMcp.js');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const MCP = leer('routes/mcp.js');
const INTEG = leer('routes/integraciones.js');

/* Un juego de herramientas de mentira con un nombre de cada grupo. */
const TOOLS = [
  { name: 'listar_eventos' }, { name: 'ver_asistentes' },
  { name: 'crear_evento' }, { name: 'crear_tipo_ticket' },
  { name: 'publicar_evento' },
  { name: 'emitir_cortesia' }, { name: 'marcar_boleta_pagada' }, { name: 'quitar_miembro' },
  { name: 'solicitar_formulario' },
  { name: '_interno' },
];

test('cada herramienta cae en un grupo, y el cajón de sastre va el último', () => {
  /* Si `montar` se evaluara primero se quedaría con todo —su prueba es `true`—
     y «Dinero y accesos» no protegería nada. */
  assert.equal(alcance.grupoDe('listar_eventos'), 'leer');
  assert.equal(alcance.grupoDe('publicar_evento'), 'publicar');
  assert.equal(alcance.grupoDe('emitir_cortesia'), 'dinero');
  assert.equal(alcance.grupoDe('quitar_miembro'), 'dinero');
  assert.equal(alcance.grupoDe('crear_evento'), 'montar');
});

test('un token de sólo lectura no puede emitir cortesías', () => {
  /* Es la razón de existir de todo esto. Antes un token valía para las 73. */
  const vistas = alcance.herramientasPara(TOOLS, ['leer']).map(t => t.name);
  assert.ok(vistas.includes('listar_eventos'));
  assert.ok(!vistas.includes('emitir_cortesia'));
  assert.ok(!vistas.includes('crear_evento'));
  assert.equal(alcance.puedeEjecutar('emitir_cortesia', ['leer'], TOOLS), false);
});

test('leer va siempre, aunque no se pida', () => {
  /* Un token que no lee no sirve para nada, y dejar crear uno vacío es dejar
     crear algo que no funciona. */
  assert.deepEqual(alcance.alcancesValidos([]), ['leer']);
  assert.deepEqual(alcance.alcancesValidos(['dinero']).sort(), ['dinero', 'leer']);
});

test('un alcance inventado no se guarda', () => {
  /* Guardarlo dejaría un token con un permiso que nadie reconoce: no puede
     hacer nada y no dice por qué. */
  assert.deepEqual(alcance.alcancesValidos(['leer', 'todo', 'root']), ['leer']);
});

test('los tokens de antes siguen funcionando', () => {
  /* Sin alcances guardados = todos. Quitarle permisos a algo que ya funcionaba,
     sin avisar, rompe una integración en marcha sin dejar rastro de por qué. */
  const vistas = alcance.herramientasPara(TOOLS, null).map(t => t.name);
  assert.ok(vistas.includes('emitir_cortesia'));
  assert.equal(alcance.puedeEjecutar('emitir_cortesia', null, TOOLS), true);
});

test('lo que no tiene sentido por MCP no sale nunca', () => {
  /* `solicitar_formulario` pinta un formulario en la pantalla del chat, y por
     MCP no hay pantalla: se quedaría esperando una respuesta que nunca llega.
     Y los internos, con `_`, tampoco. */
  for (const scopes of [null, ['leer'], ['leer', 'dinero', 'montar', 'publicar']]) {
    const vistas = alcance.herramientasPara(TOOLS, scopes).map(t => t.name);
    assert.ok(!vistas.includes('solicitar_formulario'));
    assert.ok(!vistas.includes('_interno'));
    assert.equal(alcance.puedeEjecutar('solicitar_formulario', scopes, TOOLS), false);
  }
});

test('una herramienta inventada no se ejecuta aunque el alcance lo permita', () => {
  /* Fallo real de esta tanda: cambié «existe en la lista» por «el alcance lo
     permite» y perdí la comprobación de existencia. Como un token sin alcances
     lo permite todo, un nombre inventado llegaba hasta `ejecutarTool`. */
  assert.equal(alcance.puedeEjecutar('no_existe', null, TOOLS), false);
  assert.equal(alcance.puedeEjecutar('no_existe', ['leer', 'dinero'], TOOLS), false);
});

test('el servidor comprueba la LLAMADA, no sólo la lista que enseñó', () => {
  /* Un cliente MCP puede llamar a `tools/call` con cualquier nombre. Filtrar la
     lista es cortesía; comprobar aquí es la seguridad. */
  const r = sinComentarios(MCP);
  assert.match(r, /alcance\.puedeEjecutar\(nombre, scopes, agente\.TOOLS \|\| \[\]\)/);
  assert.match(r, /toolsDe\(scopes\)/);
});

test('los alcances del token llegan hasta la comprobación', () => {
  /* Si el token los trae y `manejar` no los recibe, la pantalla enseñaría unos
     permisos que el servidor no aplica — que es peor que no tenerlos. */
  const r = sinComentarios(MCP);
  assert.match(r, /req\.mcpScopes = Array\.isArray\(tok\.scopes\)/);
  /* La llamada se parte en dos líneas para pasar también el `via` que
     distingue en la auditoría lo de OAuth de lo del token pegado a mano. */
  assert.match(r.replace(/\s+/g, ' '), /manejar\(p, req\.apiOwner, req\.mcpScopes,/);
});

test('sólo hay UNA lista de lo que nunca sale', () => {
  /* Estuvo en `routes/mcp.js` como SOLO_PANEL y en `lib/alcanceMcp.js` como
     NUNCA. Dos listas para lo mismo es exactamente cómo se separan las cosas
     en esta base. */
  assert.doesNotMatch(MCP, /SOLO_PANEL/);
  assert.ok(alcance.NUNCA.has('solicitar_formulario'));
});

test('la dirección del MCP la dice el servidor, no el frontend', () => {
  /* Escrita en el frontend, cambiar de dominio dejaría una instrucción que
     manda a la nada — y quien la siga verá «no se pudo conectar» sin saber
     por qué. */
  assert.match(INTEG, /mcp_url: `\$\{req\.protocol\}:\/\/\$\{req\.get\('host'\)\}\/mcp`/);
});

test('crear un token guarda sus alcances', () => {
  const r = sinComentarios(INTEG);
  assert.match(r, /const scopes = alcance\.alcancesValidos\(req\.body\?\.scopes\)/);
  assert.match(r, /insert\(\{ owner_id: req\.user\.id, nombre, token_hash: hash, prefix, scopes \}\)/);
});

test('el catálogo viaja con la respuesta y dice cuántas herramientas trae cada grupo', () => {
  /* Sin el número, «Crear y editar» no dice si son tres cosas o cuarenta. Y
     viaja desde el servidor para que la pantalla no mantenga su propia copia. */
  assert.match(INTEG, /alcances: alcance\.catalogo\(agente\.TOOLS \|\| \[\]\)/);
  const cat = alcance.catalogo(TOOLS);
  assert.equal(cat.length, alcance.GRUPOS.length);
  assert.ok(cat.every(g => g.label && g.detalle && typeof g.herramientas === 'number'));
  assert.equal(cat.find(g => g.id === 'leer').fijo, true);
  /* Y no cuenta las que nunca salen. */
  assert.equal(cat.reduce((n, g) => n + g.herramientas, 0), TOOLS.length - 2);
});
