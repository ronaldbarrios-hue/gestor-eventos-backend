/* Lo que hace el agente deja rastro.
 *
 * ── El agujero ───────────────────────────────────────────────────────────
 *
 * Medido sobre `lib/agente.js`: **52 escrituras a la base y cero auditadas.**
 * El panel anota cada cambio de estado, cada cortesía, cada miembro que sale
 * del equipo. Por el agente —el chat del panel y el conector de Claude— no se
 * anotaba nada.
 *
 * Y desde que un token del MCP se puede conceder con permiso de «Dinero y
 * accesos», eso deja de ser teórico: se le puede dar a Claude, y no quedaba
 * constancia de lo que hiciera con él.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SOLO_LEEN, resumirInput, eventoDe } = require('../lib/auditarAgente.js');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const AGENTE = leer('lib/agente.js');
const MCP = leer('routes/mcp.js');

test('se anota en UN sitio, no en las 68 herramientas', () => {
  /* Una llamada por herramienta son 68 sitios donde olvidarla, y la 69ª
     nacería sin ella. `ejecutarTool` es el único punto por el que pasan todas. */
  const fn = AGENTE.slice(AGENTE.indexOf('async function ejecutarTool'),
                          AGENTE.indexOf('function formRespuesta'));
  assert.match(fn, /anotarAccionDelAgente\(\{ userId, nombre: name, input, resultado: result, via \}\)/);
});

test('anotar no puede retrasar ni tumbar la acción', () => {
  /* Si la anotación falla, la acción ya ocurrió. Hacerla fracasar por el
     registro sería cambiar un problema pequeño por uno grande. */
  const fn = AGENTE.slice(AGENTE.indexOf('async function ejecutarTool'),
                          AGENTE.indexOf('function formRespuesta'));
  assert.doesNotMatch(fn, /await anotarAccionDelAgente/);
  assert.match(fn, /\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(leer('lib/auditarAgente.js'), /throw/);
});

test('lo que sólo lee no ensucia el registro', () => {
  /* Anotar cada `ver_asistentes` llenaría la auditoría de ruido hasta que
     dejara de mirarse — que es la forma habitual de que deje de servir. */
  for (const n of ['ver_asistentes', 'listar_eventos', 'buscar_asistente',
                   'analitica_evento', 'resumen_evento', 'ingresos_evento',
                   'tareas_pendientes', '_interno']) {
    assert.ok(SOLO_LEEN.test(n), `«${n}» se anotaría y sólo lee`);
  }
});

test('y lo que cambia cosas sí', () => {
  for (const n of ['publicar_evento', 'emitir_cortesia', 'marcar_boleta_pagada',
                   'quitar_miembro', 'crear_evento', 'crear_tipo_ticket',
                   'anular_boleta', 'crear_codigo_descuento']) {
    assert.ok(!SOLO_LEEN.test(n), `«${n}» cambia cosas y no se anotaría`);
  }
});

test('se distingue lo que hizo Claude de lo que se hizo a mano', () => {
  /* En la pantalla, «agente.emitir_cortesia» junto a la misma acción hecha
     desde el panel — y esa diferencia es justo lo que alguien va a querer
     saber cuando pregunte quién hizo qué. */
  const a = leer('lib/auditarAgente.js');
  assert.match(a, /accion\s*:\s*`agente\.\$\{nombre\}`/);
  /* Y por dónde entró Claude: OAuth o un token pegado a mano. */
  assert.match(sinComentarios(MCP), /manejar\(peticion, ownerId, scopes = null, via = 'claude'\)/);
  assert.match(sinComentarios(MCP).replace(/\s+/g, ' '),
    /manejar\(p, req\.apiOwner, req\.mcpScopes, req\.mcpVia === 'oauth' \? 'claude-oauth' : 'claude-token'\)/);
});

test('lo que falló no se anota como hecho', () => {
  /* Que alguien lo intentara es interesante, pero mezclarlo con lo que sí
     ocurrió haría que el registro dejara de responder «qué pasó». */
  assert.match(leer('lib/auditarAgente.js'), /if \(resultado\?\.error\) return;/);
});

test('el detalle se recorta', () => {
  /* Un `detalle` con el texto entero de una descripción larga hace ilegible la
     pantalla de auditoría, y lo que hace falta ahí es «qué se tocó». */
  const r = resumirInput({
    titulo: 'x'.repeat(300), cupo: 40, activo: true,
    campos: [1, 2, 3], objeto: { a: 1 }, vacio: null,
  });
  assert.ok(r.titulo.length <= 120);
  assert.equal(r.cupo, 40);
  assert.equal(r.activo, true);
  assert.equal(r.campos, '[3]');
  assert.equal(r.objeto, '{…}');
  assert.ok(!('vacio' in r), 'los nulos ensucian sin decir nada');
});

test('el evento se saca de donde cada herramienta lo ponga', () => {
  /* Cada una lo nombra a su manera, y sin él la anotación no se puede enseñar
     en la pantalla de auditoría del evento. */
  assert.equal(eventoDe({ evento_id: 'a' }, null), 'a');
  assert.equal(eventoDe({}, { evento: { id: 'b' } }), 'b');
  assert.equal(eventoDe({}, { evento_id: 'c' }), 'c');
  assert.equal(eventoDe({}, {}), null);
});
