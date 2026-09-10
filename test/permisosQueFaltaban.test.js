/* Los permisos de las secciones que no se podían conceder.
 *
 * Tres secciones del panel no aparecían en la lista de un rol porque no había
 * permiso que dar:
 *
 *   Accesos e ingresos    del DUEÑO y de nadie más
 *   Anuncios              igual
 *   Documentos            al revés: no pedía nada, y ahí hay contratos
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { TODOS } = require('../core/permisos/catalogo.js');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');

const NUEVOS = ['gestionar_accesos', 'ver_documentos', 'publicar_anuncios'];

test('los tres están en el catálogo', () => {
  for (const p of NUEVOS) assert.ok(TODOS.includes(p), p);
});

/* ── El de documentos se aplica de verdad ─────────────────────────────── */

test('sin `ver_documentos`, los documentos NO viajan en la respuesta', () => {
  /* Esconder la pestaña y seguir mandando la lista sería teatro: está en la
     misma respuesta que abre cualquier pantalla del evento. */
  const RUTA = leer('routes/eventos.js');
  assert.match(RUTA, /!permisos\.includes\('ver_documentos'\)/);
  assert.match(RUTA, /delete evento\.page_json\.documentos/);
});

test('quitar los documentos no muta el evento que se leyó', () => {
  /* `page_json` viene de la consulta y se comparte con lo demás que se sirve;
     borrarle una clave en sitio sería borrarla para todos los usos. */
  const RUTA = leer('routes/eventos.js');
  const i = RUTA.indexOf("!permisos.includes('ver_documentos')");
  assert.match(RUTA.slice(i, i + 300), /evento\.page_json = \{ \.\.\.evento\.page_json \}/);
});

/* ── El de accesos abre `page_json`, pero sólo una llave ──────────────── */

test('`gestionar_accesos` no deja reescribir la landing', () => {
  /* Las puertas viven dentro de `page_json`. Abrirlo entero dejaría a quien
     monta puertas editando la página pública del evento. */
  const RUTA = leer('routes/eventos.js');
  assert.match(RUTA, /if \(perms\.has\('gestionar_accesos'\)\) camposPermitidos\.add\('page_json'\)/);
  assert.match(RUTA, /updates\.page_json = 'accesos' in updates\.page_json/);
});

test('quien sólo tiene accesos y no manda accesos recibe un no', () => {
  /* En vez de un «sin cambios» que suena a que se guardó. */
  const RUTA = leer('routes/eventos.js');
  assert.match(RUTA, /sólo puede configurar los accesos/);
});

/* ── La migración cuida que nadie pierda nada ─────────────────────────── */

const SQL = leer('db/migrations/0122_los_permisos_que_faltaban.sql');

test('`ver_documentos` se le da a TODOS los roles que ya existían', () => {
  /* Hoy lo tiene todo el mundo por omisión. Un permiso nuevo que empieza
     quitando acceso es la forma de que alguien lo descubra en mitad de un
     evento. */
  const i = SQL.indexOf("ver_documentos");
  const trozo = SQL.slice(SQL.indexOf('update public.event_roles', i));
  assert.match(trozo.slice(0, 400), /where not \(r\.permissions \? 'ver_documentos'\)/);
  assert.equal(/is_system/.test(trozo.slice(0, 400)), false,
    'sólo se lo da a los roles de la semilla: los personalizados perderían acceso');
});

test('los dos que eran del dueño sólo amplían', () => {
  /* Nadie los tenía, así que dárselos a un rol no le quita nada a nadie. */
  const i = SQL.indexOf('gestionar_accesos","publicar_anuncios');
  assert.ok(i > 0, 'no encuentro la concesión');
  assert.match(SQL.slice(i, i + 200), /nombre = 'Administrador'/);
});

test('las actualizaciones SUMAN, no reemplazan la lista', () => {
  /* Con un literal se pisaría el rol que alguien ajustó a mano. */
  for (const u of SQL.matchAll(/update public\.event_roles r([\s\S]*?);/g)) {
    assert.match(u[1], /permissions\s*\|\|/, 'una actualización reemplaza en vez de sumar');
  }
});

test('correr la migración dos veces no duplica nada', () => {
  /* `jsonb_agg(distinct …)` sobre el conjunto: una migración que se aplica dos
     veces es lo normal, no la excepción. */
  assert.match(SQL, /jsonb_agg\(distinct p\)/);
});

/* ── Y que la lista no crezca sin que nadie lo note ───────────────────── */

test('cada permiso nuevo trae grupo y etiqueta', () => {
  /* Sin etiqueta, el panel pinta una casilla en blanco; sin grupo, cae fuera
     de todas las secciones y no se ve. */
  const { CATALOGO } = require('../core/permisos/catalogo.js');
  for (const id of NUEVOS) {
    const p = CATALOGO.find(x => x.id === id);
    assert.ok(p?.grupo && p?.label, id);
  }
});

/* El catálogo del PANEL es una copia a mano en el otro repo, y allí tiene su
   propia prueba. Comprobarlo desde aquí leyendo sus archivos pasa en esta
   máquina y falla en integración continua, donde ese repo no está — me pasó
   hoy dos veces. Cada lado fija el suyo. */
