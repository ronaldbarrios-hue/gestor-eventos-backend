/* Tests de librerías puras (sin DB). Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { esUrlImagenSegura } = require('../lib/urls.js');
const { slugify } = require('../lib/slug.js');

test('esUrlImagenSegura: acepta http/https', () => {
  assert.equal(esUrlImagenSegura('https://cdn.com/a.jpg'), true);
  assert.equal(esUrlImagenSegura('http://x.io/b.png'), true);
});

test('esUrlImagenSegura: rechaza esquemas peligrosos', () => {
  assert.equal(esUrlImagenSegura('javascript:alert(1)'), false);
  assert.equal(esUrlImagenSegura('ftp://x/y.png'), false);
  assert.equal(esUrlImagenSegura('data:text/html;base64,AAAA'), false);
  assert.equal(esUrlImagenSegura(123), false);
});

test('esUrlImagenSegura: vacío = OK (sin imagen) y data:image permitido', () => {
  assert.equal(esUrlImagenSegura(''), true);
  assert.equal(esUrlImagenSegura(null), true);
  assert.equal(esUrlImagenSegura('data:image/png;base64,AAAA'), true);
});

test('slugify: normaliza acentos y espacios', () => {
  assert.equal(slugify('Summit Tech Ibagué 2026'), 'summit-tech-ibague-2026');
  assert.equal(slugify('  Hola   Mundo  '), 'hola-mundo');
  assert.equal(slugify('Ñandú & Co!!!'), 'nandu-co');
});

test('slugify: entradas vacías o no-string', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
  assert.equal(slugify(undefined), '');
});
