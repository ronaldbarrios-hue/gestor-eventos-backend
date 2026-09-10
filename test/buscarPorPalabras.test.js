/* Buscar «Pérez, Juan» tiene que encontrar a «Juan Pérez».
 *
 * La búsqueda era una subcadena literal, así que el ORDEN importaba. En la base
 * la mitad de los nombres están escritos al revés de como los escribe quien
 * busca —y quien busca no lo sabe, ni tiene por qué—, así que la pantalla
 * contestaba «sin resultados» sobre una lista donde la persona estaba.
 *
 * Es el mismo daño que las listas que se cortaban: una respuesta en falso que
 * se cree.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const { palabrasDeBusqueda, condicionDeTexto, filtrarPorTexto, PALABRAS_MAX } = require('../lib/tramoDeLista.js');

test('la búsqueda se parte en palabras', () => {
  assert.deepEqual(palabrasDeBusqueda('Pérez, Juan'), ['Pérez', 'Juan']);
  assert.deepEqual(palabrasDeBusqueda('  ana   gmail  '), ['ana', 'gmail']);
});

test('todas las palabras, en el mismo campo', () => {
  /* Es lo que se puede explicar sin mentir: «Juan Pérez» encuentra a quien
     tenga las dos palabras en su nombre, o las dos en su correo. Repartirlas
     entre campos empieza a devolver gente que no se parece a lo que se
     escribió, y una búsqueda que devuelve de más es tan inútil como una que
     devuelve de menos, sólo que más difícil de notar. */
  const c = condicionDeTexto('Juan Pérez', ['nombre', 'email']);
  assert.equal(c, 'and(nombre.ilike.%Juan%,nombre.ilike.%Pérez%),and(email.ilike.%Juan%,email.ilike.%Pérez%)');
});

test('sin nada que buscar, no se filtra', () => {
  /* `null` y no una condición vacía: quien llama tiene que poder distinguir
     «no busques» de «busca esto» sin volver a mirar el texto. */
  assert.equal(condicionDeTexto('', ['a']), null);
  assert.equal(condicionDeTexto('   ', ['a']), null);
  assert.equal(condicionDeTexto('algo', []), null);
});

test('una búsqueda de una letra filtra, no enseña la lista entera', () => {
  /* Las palabras de menos de dos letras se descartan; si no queda ninguna se
     usa el texto entero como una sola. Devolver la lista SIN filtrar sería
     contestar «aquí está todo» a quien pidió algo concreto — y con la lista
     paginada, además, parecería que la búsqueda funcionó. */
  assert.deepEqual(palabrasDeBusqueda('a'), ['a']);
  assert.match(condicionDeTexto('a', ['nombre']), /nombre\.ilike\.%a%/);
});

test('hay tope de palabras', () => {
  assert.equal(palabrasDeBusqueda('una dos tres cuatro cinco seis').length, PALABRAS_MAX);
});

test('lo que rompía PostgREST sigue sin llegar al filtro', () => {
  /* La coma separa las condiciones de un `or()` y los paréntesis lo delimitan.
     Ahora se generan paréntesis a propósito —los `and(...)`— así que colar uno
     del usuario cambiaría la estructura de la consulta, no sólo el valor. */
  const c = condicionDeTexto('ana(x),luis', ['nombre']);
  assert.equal((c.match(/and\(/g) || []).length, 1, 'el texto del usuario metió un and() extra');
  for (const malo of ['(x)', '"', '\\']) {
    assert.ok(!condicionDeTexto(`ana${malo}luis`, ['nombre']).includes(malo));
  }
});

test('filtrarPorTexto deja la consulta como está si no hay nada que buscar', () => {
  const falsa = { or: () => 'filtrada' };
  assert.equal(filtrarPorTexto(falsa, '', ['a']), falsa);
  assert.equal(filtrarPorTexto(falsa, 'ana', ['a']), 'filtrada');
});

test('las cuatro listas que buscan usan la misma función', () => {
  /* Si una se queda con su `ilike` propio, esa lista sigue exigiendo el orden
     de las palabras y nadie lo nota: sólo devuelve menos. */
  for (const f of ['routes/clientes.js', 'routes/emails.js', 'routes/auditoria.js']) {
    assert.match(leer(f), /filtrarPorTexto\(query, q,/, `${f} no busca por palabras`);
  }
  /* `sesiones.js` la usa en su forma de condición, porque tiene que mezclarla
     con la búsqueda por boleta dentro de un solo `or()`. */
  assert.match(leer('routes/sesiones.js'), /condicionDeTexto\(q,/);

  /* Y ninguna vuelve a construir el filtro a mano. */
  for (const f of ['routes/clientes.js', 'routes/emails.js', 'routes/auditoria.js', 'routes/sesiones.js']) {
    assert.doesNotMatch(leer(f), /paraBuscar\(q\)/,
      `${f} volvió a filtrar por el texto entero, sin partirlo en palabras`);
  }
});
