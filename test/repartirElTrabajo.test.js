/* Repartir el trabajo del evento no es ser el dueño.
 *
 * Crear una tarea, asignarla, cambiarle la fecha y ver el tablero completo
 * estaban detrás de `owner_id`, comprobado dentro del handler con un «Solo el
 * organizador puede crear tareas». Quien lleva la logística —la persona cuyo
 * trabajo ES repartir el trabajo— abría el tablero y no podía poner nada en él;
 * y veía sólo las tareas asignadas a ella misma, que para quien asigna es no
 * ver nada: las que reparte son de otros por definición.
 *
 * Y el aviso de que una zona se llenó iba sólo a la cuenta que creó el evento,
 * que casi nunca es quien está mirando el aforo.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const { CATALOGO, TODOS } = require('../core/permisos/catalogo.js');
const { aQuienLeImporta, TOPE } = require('../lib/aQuienLeImporta.js');

test('«asignar tareas» es un permiso que se puede conceder', () => {
  const p = CATALOGO.find(c => c.id === 'gestionar_tareas');
  assert.ok(p, 'no está en el catálogo: no se puede marcar en ningún rol');
  assert.ok(p.label && p.grupo, 'viaja sin etiqueta o sin grupo, así que el panel no lo pinta');
  assert.ok(TODOS.includes('gestionar_tareas'), 'el Administrador no lo tendría');
});

test('las cuatro puertas de las tareas lo piden, y ninguna vuelve a pedir el dueño', () => {
  const src = leer('routes/tareas.js');
  assert.match(src, /const MANDAN_EN_TAREAS = \['gestionar_tareas', 'editar_evento'\]/);
  /* `editar_evento` cuenta además: Administrador, Editor y Coordinador ya lo
     tienen, y sin esto habría que migrarlos para que siguieran haciendo lo que
     ya hacían. */

  /* Crear, listar, editar y borrar. Si alguna se queda comprobando `isOwner`
     a secas, vuelve a haber una pantalla que sólo sirve a quien creó el
     evento — y esta vez sin el mensaje que lo explicaba. */
  const puertas = ['router.post(', 'router.get(', 'router.patch(', 'router.delete('];
  for (const p of puertas) {
    const i = src.indexOf(p);
    const trozo = src.slice(i, src.indexOf('router.', i + 10) || src.length);
    assert.doesNotMatch(trozo, /if \(!ctx\.isOwner\) return res\.status\(403\)/,
      `${p} sigue reservada a quien creó el evento`);
  }
  assert.ok((src.match(/repartaTrabajo\(ctx\)/g) || []).length >= 4,
    'alguna de las cuatro puertas no pregunta quién reparte el trabajo');
});

test('quien escribió una tarea puede corregirla y retirarla', () => {
  /* Aunque luego le quiten el permiso: una tarea que nadie puede corregir se
     queda en el tablero para siempre. */
  const src = leer('routes/tareas.js');
  assert.ok((src.match(/laEscribio/g) || []).length >= 4,
    'no se mira quién escribió la tarea al editarla o al borrarla');
  assert.match(src, /created_by/, 'no se lee el autor de la tarea');
});

test('el aviso de aforo llega a quien puede hacer algo', () => {
  const src = leer('routes/clientes.js');
  assert.match(src, /const AVISADOS_DEL_AFORO = \['checkin', 'gestionar_accesos'\]/,
    'el aviso de aforo sigue teniendo un solo destinatario');
  const f = src.slice(src.indexOf('async function alertarAforo'), src.indexOf('/* GET /eventos/:eventoId/zonas/aforo'));
  assert.match(f, /aQuienLeImporta\(/);
  assert.doesNotMatch(f, /if \(ev\?\.owner_id\) \{/, 'todavía avisa sólo al dueño');

  /* La automatización va ANTES de mirar el equipo: es lo único que actúa solo,
     y un fallo repartiendo avisos no puede llevársela por delante. */
  assert.ok(f.indexOf('correrAutomatizaciones') < f.indexOf('aQuienLeImporta'),
    'un fallo mirando el equipo se lleva la automatización del aforo');
});

/* ── A quién le importa ──────────────────────────────────────────────── */

function conEquipo(miembros, fn) {
  const ruta = require.resolve('../lib/supabase.js');
  const antes = require.cache[ruta];
  const tabla = (nombre) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: () => Promise.resolve({ data: { owner_id: 'dueño' }, error: null }),
      then: (r) => Promise.resolve(r({ data: miembros, error: null })),
    };
    return nombre === 'eventos' ? q : q;
  };
  require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: { from: tabla } };
  return Promise.resolve(fn()).finally(() => {
    if (antes) require.cache[ruta] = antes; else delete require.cache[ruta];
  });
}

test('se avisa a quien tiene el permiso, al dueño y al co-dueño', async () => {
  await conEquipo([
    { user_id: 'logistica', rol_detail: { permissions: ['checkin'] } },
    { user_id: 'codueño', rol_detail: { permissions: ['*'] } },
    { user_id: 'finanzas', rol_detail: { permissions: ['ver_pagos'] } },
    { user_id: 'suelto', custom_permissions: ['gestionar_accesos'] },
  ], async () => {
    const gente = await aQuienLeImporta('e1', ['checkin', 'gestionar_accesos'], { ownerId: 'dueño' });
    assert.deepEqual(gente.sort(), ['codueño', 'dueño', 'logistica', 'suelto'].sort());
    /* Quien no puede hacer nada con el aviso no lo recibe: un aviso que no se
       puede atender se aprende a ignorar, y entonces deja de avisar. */
    assert.ok(!gente.includes('finanzas'));
  });
});

test('quien provocó el aviso no se lo manda a sí mismo', async () => {
  await conEquipo([{ user_id: 'logistica', rol_detail: { permissions: ['checkin'] } }], async () => {
    const gente = await aQuienLeImporta('e1', ['checkin'], { ownerId: 'dueño', salvo: 'logistica' });
    assert.deepEqual(gente, ['dueño']);
  });
});

test('hay un tope, y el dueño siempre entra', async () => {
  const muchos = Array.from({ length: 40 }, (_, i) => ({ user_id: `m${i}`, rol_detail: { permissions: ['checkin'] } }));
  await conEquipo(muchos, async () => {
    const gente = await aQuienLeImporta('e1', ['checkin'], { ownerId: 'dueño' });
    assert.equal(gente.length, TOPE, 'sin tope, una puerta llena toda la tarde se vuelve ruido');
    assert.equal(gente[0], 'dueño', 'el dueño tiene que entrar antes del recorte');
  });
});

test('si no se puede leer el equipo, al menos se avisa al dueño', async () => {
  const ruta = require.resolve('../lib/supabase.js');
  const antes = require.cache[ruta];
  const q = {
    select: () => q, eq: () => q,
    maybeSingle: () => Promise.resolve({ data: { owner_id: 'dueño' }, error: null }),
    then: (r) => Promise.resolve(r({ data: null, error: { message: 'boom' } })),
  };
  require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: { from: () => q } };
  try {
    assert.deepEqual(await aQuienLeImporta('e1', ['checkin'], { ownerId: 'dueño' }), ['dueño']);
  } finally {
    if (antes) require.cache[ruta] = antes; else delete require.cache[ruta];
  }
});
