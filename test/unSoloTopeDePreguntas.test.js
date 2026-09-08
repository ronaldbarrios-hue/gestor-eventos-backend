/* Cuántas preguntas caben: un solo número para los tres formularios.
 *
 * ── La misma factura, tres veces ─────────────────────────────────────────
 *
 * El formulario del EVENTO tenía tope 20 y una ficha de caracterización no
 * cabía. Se subió a 60, y el comentario que lo cuenta sigue ahí.
 *
 * Pero el número se había copiado a mano en otros dos sitios, cada uno con su
 * justificación escrita:
 *
 *   torneo     20 · «un torneo pide menos que el registro del evento»
 *   sub-evento 12 · «si alguien necesita treinta, lo que quiere es el
 *                    formulario del evento»
 *
 * Las dos eran una suposición sobre cómo trabaja la gente, y las dos fallaron:
 * un formulario de 21 preguntas para una batalla de pitch no cabía. Describir
 * una startup pide MÁS que comprar una entrada, no menos.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MAX_CAMPOS_FORMULARIO } = require('../lib/formularioCampos.js');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');

test('los tres formularios comparten el mismo tope', () => {
  /* Comparado sobre el fuente y no llamando a las rutas: lo que importa es que
     el número NO se vuelva a escribir a mano, que es como se separaron. */
  for (const [f, nombre] of [
    ['routes/torneos.js', 'MAX_CAMPOS_TORNEO'],
    ['routes/sesiones.js', 'MAX_CAMPOS_SUBEVENTO'],
  ]) {
    const linea = leer(f).split('\n').find(l => l.startsWith(`const ${nombre} =`));
    assert.ok(linea, `no encuentro ${nombre} en ${f}`);
    assert.match(linea, /= MAX_CAMPOS_FORMULARIO;$/,
      `${nombre} volvió a tener su propio número: ${linea.trim()}`);
  }
});

test('y lo importan de verdad', () => {
  /* Sin el import, la constante es `undefined` — y un tope indefinido no
     rechaza nada o rechaza todo, según por dónde pase. Peor que el tope viejo,
     y sin un error que lo diga. */
  for (const f of ['routes/torneos.js', 'routes/sesiones.js']) {
    const s = leer(f);
    const i = s.indexOf("require('../lib/formularioCampos.js')");
    assert.ok(i > 0, `${f} no importa formularioCampos`);
    const bloque = s.slice(Math.max(0, i - 400), i);
    assert.match(bloque, /MAX_CAMPOS_FORMULARIO/, `${f} usa la constante sin importarla`);
  }
});

test('el tope da para una ficha de caracterización entera', () => {
  /* Es el caso que lo subió la primera vez: ~22 preguntas, y las entidades
     públicas piden fichas de más de 30. */
  assert.ok(MAX_CAMPOS_FORMULARIO >= 40,
    `con ${MAX_CAMPOS_FORMULARIO} no cabe una ficha de caracterización`);
});

test('pero sigue habiendo tope, y por una razón que no es de diseño', () => {
  /* No está para decirle a nadie cuántas preguntas necesita: está porque la
     ruta acepta la lista entera en un POST, y sin tope un bucle equivocado
     llena la tabla. Si alguien lo quita, que sea a sabiendas. */
  assert.ok(Number.isFinite(MAX_CAMPOS_FORMULARIO) && MAX_CAMPOS_FORMULARIO > 0);
  assert.match(leer('lib/formularioCampos.js'), /Por qué no es infinito/);
});
