/* Qué es cada boleta, dicho en la lista de compra.
 *
 * Un evento con cuatro boletas las enseñaba en una lista plana, y nada decía
 * cuál es la entrada al evento y cuáles son actividades de dentro. Quien llega
 * ve cuatro cosas iguales: se inscribe a un taller sin entrada, o pide las
 * cuatro por si acaso.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const r = require('../lib/rolDeBoleta.js');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');

const tipo = (nombre, extra = {}) => ({ id: nombre, nombre, ...extra });

/* ── Agrupar, y sobre todo cuándo NO ──────────────────────────────────── */

test('con una sola clase de boleta no se agrupa nada', () => {
  /* Poner «Entrada al evento» encima de una única boleta es ruido que hay que
     leer. El 95 % de los eventos son esto. */
  assert.equal(r.agrupar([tipo('General')]), null);
  assert.equal(r.agrupar([tipo('General'), tipo('VIP')]), null);
  assert.equal(r.agrupar([]), null);
});

test('con entrada y actividades se agrupa, y la entrada va primera', () => {
  const grupos = r.agrupar([
    tipo('Taller', { rol: 'actividad' }),
    tipo('Registro', { rol: 'entrada' }),
    tipo('Parqueadero', { rol: 'extra' }),
  ]);
  assert.deepEqual(grupos.map(g => g.rol), ['entrada', 'actividad', 'extra']);
  assert.equal(grupos[0].tipos[0].nombre, 'Registro');
});

test('las actividades avisan de que hace falta la entrada', () => {
  /* Es la frase que evita el error caro: alguien que se inscribe a un taller y
     se presenta el día del evento sin entrada. */
  const grupos = r.agrupar([tipo('A', { rol: 'entrada' }), tipo('B', { rol: 'actividad' })]);
  const actividades = grupos.find(g => g.rol === 'actividad');
  assert.match(actividades.ayuda, /entrada/i);
});

test('un grupo vacío no se pinta', () => {
  const grupos = r.agrupar([tipo('A', { rol: 'entrada' }), tipo('B', { rol: 'extra' })]);
  assert.deepEqual(grupos.map(g => g.rol), ['entrada', 'extra']);
  for (const g of grupos) assert.ok(g.tipos.length > 0);
});

test('un rol inventado se lee como entrada, no rompe la lista', () => {
  /* Una boleta que desaparece de la página pública por un valor raro es peor
     que una mal clasificada. */
  assert.equal(r.rolValido('pirata'), 'entrada');
  assert.equal(r.rolValido(undefined), 'entrada');
  assert.equal(r.rolValido(null), 'entrada');
  const grupos = r.agrupar([tipo('A', { rol: 'pirata' }), tipo('B', { rol: 'actividad' })]);
  assert.equal(grupos.find(g => g.rol === 'entrada').tipos[0].nombre, 'A');
});

/* ── Lo que ya se sabía sin migrar nada ───────────────────────────────── */

test('una boleta que crea un equipo se anuncia como postulación', () => {
  /* `crea` es un dato viejo y real: distinguir con él no necesita migración. */
  assert.match(r.queTrae('equipo'), /postulaci/i);
  assert.match(r.queTrae('stand'), /stand/i);
  assert.equal(r.queTrae('nada'), null);
  assert.equal(r.queTrae(undefined), null);
});

/* ── La sugerencia, que NO se usa en público ──────────────────────────── */

test('se sugiere un papel a partir de lo que la boleta crea', () => {
  assert.equal(r.sugerirRol({ crea: 'equipo' }), 'actividad');
  assert.equal(r.sugerirRol({ crea: 'stand' }), 'extra');
  assert.equal(r.sugerirRol({ crea: 'nada' }), 'entrada');
  assert.equal(r.sugerirRol({}), 'entrada');
});

test('la página pública NO adivina: agrupa por lo declarado', () => {
  /* Adivinarle al público es peor que no agrupar: un encabezado equivocado se
     lee como una afirmación de la plataforma. */
  const RUTA = leer('routes/eventos.publicos.js');
  assert.equal(/sugerirRol/.test(RUTA), false, 'la ruta pública está adivinando el papel');
  assert.match(RUTA, /rolDeBoleta\.rolValido/);
});

/* ── Que la columna nueva no tumbe la página ──────────────────────────── */

test('`rol` y `crea` se piden aparte, con reintento', () => {
  /* Pedirlas dentro del select del evento rompería el select ENTERO en un
     despliegue sin la migración: la página pública se quedaría SIN BOLETAS. Es
     la misma trampa de `modo_entrada`, y aquí el precio es la página entera. */
  const RUTA = leer('routes/eventos.publicos.js');
  const select = RUTA.slice(RUTA.indexOf('ticket_types(id, nombre'), RUTA.indexOf('.eq(\'slug\', slug)'));
  assert.equal(/\brol\b/.test(select), false, '`rol` viaja en el select del evento');
  assert.equal(/\bcrea\b/.test(select), false, '`crea` viaja en el select del evento');

  const trozo = RUTA.slice(RUTA.indexOf("select('id, crea, rol, instrucciones')"));
  assert.match(trozo.slice(0, 500), /select\('id, crea'\)/, 'no hay reintento sin las columnas nuevas');
});

/* ── El panel ─────────────────────────────────────────────────────────── */

test('la boleta prueba las columnas nuevas y cae a las viejas', () => {
  /* Ésta es la página que alguien abre en la puerta del evento: lo único que no
     puede pasar es que no salga. El último intento va sin columnas de más. */
  const RUTA = leer('routes/eventos.publicos.js');
  assert.match(RUTA, /const EXTRAS = \[', crea, instrucciones', ', crea', ''\]/);
});

test('el panel puede guardar el papel, y valida contra el catálogo', () => {
  const T = leer('routes/tickets.js');
  assert.match(T, /'rol',/);
  /* Del catálogo y no una lista escrita a mano: dos listas de lo mismo se
     separan, y ésa es la forma de fallar favorita de este proyecto. */
  assert.match(T, /require\('\.\.\/lib\/rolDeBoleta\.js'\)\.ROLES/);
});

/* ── La migración ─────────────────────────────────────────────────────── */

test('la columna nace en «entrada»: ningún evento cambia solo', () => {
  const SQL = leer('db/migrations/0121_que_es_cada_boleta.sql');
  assert.match(SQL, /default 'entrada'/);
  assert.match(SQL, /check \(rol in \('entrada', 'actividad', 'extra'\)\)/);
});

test('la migración dice que ésta NO es la forma buena de montarlo', () => {
  /* La 0055 dejó el modelo correcto —inscripciones a sub-eventos, una sola
     escarapela— y esto es el segundo mejor para eventos que ya vendieron.
     Quien lea la migración dentro de un año tiene que enterarse. */
  const SQL = leer('db/migrations/0121_que_es_cada_boleta.sql');
  assert.match(SQL, /0055/);
  assert.match(SQL, /INSCRIPCIÓN/);
});
