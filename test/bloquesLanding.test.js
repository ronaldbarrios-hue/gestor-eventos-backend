/* Tests del contrato de bloques de la landing.

   Esto existe porque `page_json.paginas` se guardaba tal cual: el servidor no
   sabía qué es un bloque. Mientras el único que escribía era el editor eso se
   sostenía; con Claude por MCB y un modo desarrollador, no.

   Lo que se protege: que no entre un bloque inventado, que un `javascript:` no
   se cuele en un enlace, y que un campo que nadie lee se rechace en vez de
   guardarse en silencio.

   Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  TIPOS_BLOQUE, fallaBloque, fallaPaginas, catalogoPublico,
  MAX_BLOQUES_POR_PAGINA, MAX_PAGINAS,
} = require('../lib/bloquesLanding.js');

test('un bloque válido pasa', () => {
  assert.equal(fallaBloque({ type: 'texto', data: { titulo: 'Hola', texto: 'Qué tal' } }), null);
});

test('un tipo de bloque inventado se rechaza, y dice cuáles hay', () => {
  const f = fallaBloque({ type: 'formulario_magico', data: {} });
  assert.ok(f, 'tiene que fallar');
  assert.ok(f.includes('texto'), 'el mensaje enumera los tipos que sí existen');
});

test('un campo que el bloque no admite se rechaza en vez de ignorarse', () => {
  /* Ignorarlo en silencio deja a alguien creyendo que configuró algo. */
  const f = fallaBloque({ type: 'cita', data: { texto: 'x', color_de_fondo: 'rojo' } });
  assert.ok(f && f.includes('color_de_fondo'));
});

test('un javascript: en una url se rechaza', () => {
  /* Es la razón de ser de este archivo: un enlace así en la landing es XSS con
     el origen del evento, donde está la sesión de quien la mira. */
  for (const malo of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>']) {
    const f = fallaBloque({ type: 'cta', data: { texto: 'Ir', url: malo } });
    assert.ok(f, `debería rechazar ${malo}`);
  }
});

test('una url normal o una ruta del sitio sí pasan', () => {
  for (const bueno of ['https://ejemplo.com', 'http://ejemplo.com', '/explorar', '#seccion']) {
    assert.equal(fallaBloque({ type: 'cta', data: { texto: 'Ir', url: bueno } }), null, `debería aceptar ${bueno}`);
  }
});

test('un valor fuera de las opciones se rechaza', () => {
  assert.ok(fallaBloque({ type: 'separador', data: { estilo: 'arcoiris' } }));
  assert.equal(fallaBloque({ type: 'separador', data: { estilo: 'linea' } }), null);
});

test('un número fuera de rango se rechaza', () => {
  assert.ok(fallaBloque({ type: 'hero', data: { alto: 5000 } }));
  assert.ok(fallaBloque({ type: 'hero', data: { alto: 10 } }));
  assert.equal(fallaBloque({ type: 'hero', data: { alto: 320 } }), null);
});

test('un texto larguísimo se rechaza', () => {
  assert.ok(fallaBloque({ type: 'cita', data: { autor: 'x'.repeat(500) } }));
});

test('las listas validan cada elemento por dentro', () => {
  assert.equal(fallaBloque({ type: 'faq', data: { items: [{ q: 'a', a: 'b' }] } }), null);
  const f = fallaBloque({ type: 'faq', data: { items: [{ q: 'a', a: 'b', truco: 1 }] } });
  assert.ok(f, 'un campo de más dentro de un elemento también se rechaza');
});

test('un elemento de lista que no es objeto se rechaza', () => {
  assert.ok(fallaBloque({ type: 'faq', data: { items: ['hola'] } }));
});

test('los campos vacíos son válidos: no todo es obligatorio', () => {
  assert.equal(fallaBloque({ type: 'hero', data: { titulo: '', imagen: null, alto: undefined } }), null);
});

test('`oculto` vale en cualquier bloque aunque no esté en su catálogo', () => {
  /* Es del editor, no del contenido, y vale para todos. */
  assert.equal(fallaBloque({ type: 'texto', data: { oculto: true } }), null);
  assert.ok(fallaBloque({ type: 'texto', data: { oculto: 'sí' } }), 'pero tiene que ser booleano');
});

test('una landing entera se valida página por página y dice dónde falla', () => {
  const f = fallaPaginas([
    { blocks: [{ type: 'texto', data: {} }] },
    { blocks: [{ type: 'texto', data: {} }, { type: 'inventado', data: {} }] },
  ]);
  assert.ok(f && f.includes('Página 2') && f.includes('bloque 2'), `mensaje poco útil: ${f}`);
});

test('demasiados bloques o demasiadas páginas se rechazan', () => {
  const muchos = Array.from({ length: MAX_BLOQUES_POR_PAGINA + 1 }, () => ({ type: 'texto', data: {} }));
  assert.ok(fallaPaginas([{ blocks: muchos }]));
  const muchas = Array.from({ length: MAX_PAGINAS + 1 }, () => ({ blocks: [] }));
  assert.ok(fallaPaginas(muchas));
});

test('no mandar páginas no es un error', () => {
  /* Guardar sólo la marca no puede fallar por no traer la landing. */
  assert.equal(fallaPaginas(undefined), null);
  assert.equal(fallaPaginas(null), null);
});

test('el catálogo público no lleva funciones y describe cada campo', () => {
  const cat = catalogoPublico();
  assert.equal(cat.length, TIPOS_BLOQUE.length);
  assert.doesNotThrow(() => JSON.stringify(cat), 'tiene que poder viajar como JSON');
  const cta = cat.find(b => b.type === 'cta');
  assert.ok(cta.campos.find(c => c.nombre === 'estilo').opciones.includes('primary'));
});
