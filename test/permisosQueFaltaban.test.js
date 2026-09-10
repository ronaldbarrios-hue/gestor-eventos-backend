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
     monta puertas editando la página pública del evento.
   *
   * El recorte se mudó a `lib/quePuedeEditar.js`. Antes estaba escrito como una
   * adivinanza —«tiene page_json y no tiene branding, luego es accesos»— y eso
   * aguantaba mientras hubiera UN permiso estrecho; con el segundo, el nuevo
   * habría acabado escribiendo en `accesos`. */
  const { llavesDePageJson, recortarPageJson } = require('../lib/quePuedeEditar.js');

  const soloAccesos = new Set(['gestionar_accesos']);
  const llaves = llavesDePageJson(soloAccesos);
  assert.deepEqual([...llaves], ['accesos']);

  const r = recortarPageJson({ accesos: [1], branding: { logo: 'x' }, paginas: [] }, llaves);
  assert.deepEqual(r.page_json, { accesos: [1] }, 'se coló algo que no son las puertas');
});

test('cada permiso estrecho abre su propia llave, no la del vecino', () => {
  /* Lo que la adivinanza vieja no podía distinguir. */
  const { llavesDePageJson } = require('../lib/quePuedeEditar.js');
  assert.deepEqual([...llavesDePageJson(new Set(['gestionar_documentos']))], ['documentos']);
  assert.deepEqual([...llavesDePageJson(new Set(['gestionar_acreditacion']))].sort(),
    ['credenciales', 'puntos', 'wallet']);
  /* Y los dos amplios siguen abriéndolo entero: `null` es «todas». */
  for (const p of ['editar_evento', 'editar_pagina_publica', '*']) {
    assert.equal(llavesDePageJson(new Set([p])), null, `${p} dejó de abrir page_json entero`);
  }
  /* Sin ninguno: un Set vacío, que NO es lo mismo que `null`. Confundirlos es
     la diferencia entre no dejar pasar a nadie y dejar pasar a todo el mundo. */
  assert.deepEqual([...llavesDePageJson(new Set(['ver_clientes']))], []);
});

test('quien sólo tiene accesos y no manda accesos recibe un no', () => {
  /* En vez de un «sin cambios» que suena a que se guardó. */
  const { llavesDePageJson, recortarPageJson } = require('../lib/quePuedeEditar.js');
  const r = recortarPageJson({ branding: { logo: 'x' } }, llavesDePageJson(new Set(['gestionar_accesos'])));
  assert.ok(r.error, 'se guardó un objeto vacío en vez de decir que no');
  assert.match(r.error, /accesos/);

  /* Y la ruta lo devuelve como 403, no como «sin cambios». */
  const RUTA = leer('routes/eventos.js');
  assert.match(RUTA, /if \(r\.error\) return res\.status\(403\)/);
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

/* ── El torneo: una sola lista de permisos, no dos ────────────────────── */

test('los permisos del torneo se escriben una vez', () => {
  /* Estaban en `torneos.js` y en `torneoJurado.js`, iguales. En cuanto uno
     cambió se separaron, y eso no da error: sólo que el jurado sigue pidiendo
     más permiso que el resto del torneo, y nadie lo nota hasta que alguien no
     puede tocar los criterios. */
  const jurado = leer('routes/torneoJurado.js');
  const torneos = leer('routes/torneos.js');

  assert.match(jurado, /const PERMS_TORNEO_CONFIG = \['gestionar_torneo', 'editar_evento'\];/);
  assert.match(jurado, /module\.exports\.PERMS_TORNEO_CONFIG/, 'no la exporta: la otra tendrá que copiarla');
  assert.doesNotMatch(torneos, /const PERMS_TORNEO_CONFIG =/,
    '`torneos.js` volvió a tener su propia copia');
  assert.match(torneos, /PERMS_TORNEO_CONFIG,\n\} = require\('\.\/torneoJurado\.js'\)/,
    'no la importa de donde vive');
});

test('quien gestiona el torneo puede crearlo, no sólo operarlo', () => {
  /* `PERMS_TORNEO` —once rutas: equipos, partidos, resultados— aceptaba
     `gestionar_torneo`, y crear el torneo y sus categorías pedía
     `editar_evento`. El rol «Programación», que existe justo para esto, podía
     OPERAR un torneo y no crearlo; y al abrir la pestaña la primera lectura,
     `GET /torneo-categorias`, ya devolvía 403.

     Esto AMPLÍA lo que puede `gestionar_torneo`, a propósito: el permiso se
     llama «gestionar torneo» y crear uno es lo primero que eso significa. */
  /* Se lee del texto y no con `require`: cargar la ruta arrastra supabase, y
     este archivo comprueba fuentes, no arranca el servidor. */
  const linea = leer('routes/torneoJurado.js')
    .match(/const PERMS_TORNEO_CONFIG = \[([^\]]*)\]/)[1];
  assert.match(linea, /'gestionar_torneo'/);
  assert.match(linea, /'editar_evento'/, 'alguien perdió lo que ya podía');
});
