const test = require('node:test');
const assert = require('node:assert');

/* Los dos buzones de GESTEK.
 *
 * Por qué existe esta prueba: el buzón de catálogo llamaba a `/me/sugerencias`
 * y esa ruta NUNCA se escribió. La tabla estaba (0063), el formulario estaba
 * (`BuzonSugerencia.jsx`, puesto en dos pantallas), y en medio no había nada:
 * 404 desde el 2026-08-12 sin que nadie se enterara, porque un buzón que falla
 * calladamente se parece mucho a un buzón que nadie usa.
 *
 * Lo que se cubre aquí es justamente lo que se rompió: que las cuatro rutas
 * estén DECLARADAS, y que las dos validaciones no se confundan entre sí — que
 * es el otro fallo posible, porque las dos tablas se llaman parecido y una
 * exige explicar cómo funciona mientras la otra acepta tres palabras. */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const router = require('../routes/sugerencias.js');
const { validar, validarCatalogo, MAX_TEXTO } = router._test;

/* Las rutas declaradas en el router, como `METODO /ruta`. */
function rutas() {
  return router.stack
    .filter(c => c.route)
    .flatMap(c => Object.keys(c.route.methods).map(m => `${m.toUpperCase()} ${c.route.path}`));
}

test('las cuatro rutas de los dos buzones están declaradas', () => {
  const hay = rutas();
  for (const esperada of [
    'POST /sugerencias',            // catálogo: la lista se quedó corta
    'GET /sugerencias',
    'POST /sugerencias/dinamica',   // dinámica: falta una mecánica entera
    'GET /sugerencias/dinamica',
  ]) {
    assert.ok(hay.includes(esperada), `falta ${esperada} — hay: ${hay.join(', ')}`);
  }
});

test('«/sugerencias» y «/sugerencias/dinamica» son rutas distintas, no se solapan', () => {
  /* Si alguien convirtiera la primera en `/sugerencias*` o la montara con un
     parámetro, se tragaría la segunda y el buzón de dinámicas empezaría a
     rechazar por la validación equivocada. */
  const hay = rutas();
  assert.ok(!hay.some(r => r.includes('*') || r.includes(':')),
    `ninguna de estas rutas debe llevar comodín ni parámetro: ${hay.join(', ')}`);
});

/* ── El buzón de catálogo: sin mínimo de longitud, a propósito ── */

test('tres palabras bastan: es el buzón que va al lado del desplegable', () => {
  const v = validarCatalogo({ catalogo: 'evento', texto: 'feria de adopción' });
  assert.ok(v.ok, v.error);
  assert.equal(v.fila.texto, 'feria de adopción');
  assert.equal(v.fila.catalogo, 'evento');
});

test('sólo los catálogos que admite el CHECK de la tabla', () => {
  assert.ok(validarCatalogo({ catalogo: 'vacante', texto: 'operador de dron' }).ok);
  /* Sin esto llegaría a Postgres y volvería como un 500 ilegible. */
  assert.ok(validarCatalogo({ catalogo: 'ponente', texto: 'algo' }).error);
  assert.ok(validarCatalogo({ texto: 'algo' }).error, 'sin catálogo no se guarda');
});

test('el texto vacío o de sólo espacios no se guarda', () => {
  assert.ok(validarCatalogo({ catalogo: 'evento', texto: '   ' }).error);
  assert.ok(validarCatalogo({ catalogo: 'evento' }).error);
});

test('el texto se corta en el mismo tope que el formulario', () => {
  const justo = validarCatalogo({ catalogo: 'evento', texto: 'a'.repeat(MAX_TEXTO) });
  assert.ok(justo.ok, 'el tope exacto debe pasar');
  const pasado = validarCatalogo({ catalogo: 'evento', texto: 'a'.repeat(MAX_TEXTO + 1) });
  assert.ok(pasado.error, 'uno más, no');
});

test('el contexto se guarda, pero acotado y sólo si es un objeto', () => {
  const con = validarCatalogo({ catalogo: 'evento', texto: 'x', contexto: { desde: 'crear-evento' } });
  assert.deepEqual(con.fila.contexto, { desde: 'crear-evento' });

  /* Un array no es contexto, y un objeto enorme tampoco: la columna es para
     entender la sugerencia meses después, no un adjunto. */
  assert.deepEqual(validarCatalogo({ catalogo: 'evento', texto: 'x', contexto: [1, 2] }).fila.contexto, {});
  assert.deepEqual(validarCatalogo({ catalogo: 'evento', texto: 'x', contexto: 'hola' }).fila.contexto, {});
  const enorme = { relleno: 'a'.repeat(3000) };
  assert.deepEqual(validarCatalogo({ catalogo: 'evento', texto: 'x', contexto: enorme }).fila.contexto, {},
    'un contexto que no cabe se descarta, pero la sugerencia sí se guarda');
});

/* ── El buzón de dinámicas: aquí SÍ hay mínimo, y es lo que lo distingue ── */

test('pedir una dinámica exige explicar cómo funciona', () => {
  /* La razón está en el comentario de la ruta: «stand-up comedy» y nada más
     obliga a escribir de vuelta, y ahí se muere media solicitud. */
  const corto = validar({ titulo: 'Stand-up', como_funciona: 'comedia' });
  assert.ok(corto.error, 'una descripción de una palabra no debe pasar');
  assert.match(corto.error, /cómo funciona/i);

  const bueno = validar({
    titulo: 'Stand-up',
    como_funciona: 'Hay turnos de comediantes, el público vota al final de cada ronda y la agenda muestra el orden de salida.',
  });
  assert.ok(bueno.ok, bueno.error);
  assert.equal(bueno.fila.titulo, 'Stand-up');
});

test('las dos validaciones no son intercambiables', () => {
  /* Éste es el fallo que se quiere impedir: si alguien apuntara el buzón de
     catálogo a la ruta de dinámicas —que fue justo la recomendación fácil
     cuando se encontró el 404—, el cuerpo del formulario no pasaría. */
  const cuerpoDeCatalogo = { catalogo: 'evento', texto: 'feria de adopción' };
  assert.ok(validar(cuerpoDeCatalogo).error,
    'el cuerpo del buzón de catálogo NO sirve para pedir una dinámica');

  const cuerpoDeDinamica = { titulo: 'Stand-up', como_funciona: 'a'.repeat(60) };
  assert.ok(validarCatalogo(cuerpoDeDinamica).error,
    'y al revés tampoco: sin catálogo ni texto no hay sugerencia de lista');
});
