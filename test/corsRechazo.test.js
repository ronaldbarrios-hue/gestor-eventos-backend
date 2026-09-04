/* Un origen que no está en la lista.
 *
 * ── Lo que pasó, y por qué esta prueba existe ────────────────────────────
 *
 * El 4 de septiembre de 2026 se dio por caída producción. No lo estaba: la
 * API, la base, el almacén y el frontend respondían. Lo que pasaba es que un
 * despliegue del frontend vivía en un dominio que no estaba en `CORS_ORIGINS`,
 * y **todas sus llamadas devolvían 500**.
 *
 * El 500 salía de aquí: el origen rechazado hacía `callback(new Error(...))`,
 * el paquete `cors` se lo pasaba a Express, Express no tenía manejador y
 * contestaba «Internal Server Error». Un problema de configuración de treinta
 * segundos con la cara de un servidor reventado.
 *
 * Lo que esta prueba fija: un origen no autorizado se rechaza **diciendo por
 * qué**, y nunca con un 5xx.
 *
 * Correr: npm test */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba-que-no-es-el-de-produccion';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://permitido.example';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { explicarCorsRechazado, ALLOWED_ORIGINS } = require('../config/security.js');

/* Un `res` de mentira que apunta lo que le pidieron. */
function respuestaFalsa() {
  const r = { codigo: null, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}
const pedir = (origin) => ({ headers: origin ? { origin } : {} });

test('sin Origin pasa: los webhooks de las pasarelas llegan así', () => {
  /* Mercado Pago y Wompi llaman sin Origin. Bloquearlas aquí cortaría los
     pagos, que es peor que cualquier cosa que este archivo evite. */
  let siguiente = false;
  explicarCorsRechazado(pedir(null), respuestaFalsa(), () => { siguiente = true; });
  assert.ok(siguiente, 'una petición sin Origin se está rechazando');
});

test('un origen de la lista pasa', () => {
  const permitido = ALLOWED_ORIGINS[0];
  assert.ok(permitido, 'la lista de orígenes está vacía');
  let siguiente = false;
  explicarCorsRechazado(pedir(permitido), respuestaFalsa(), () => { siguiente = true; });
  assert.ok(siguiente, `«${permitido}» está en la lista y se rechazó igual`);
});

test('un origen que no está se rechaza con 403, nunca con 5xx', () => {
  const res = respuestaFalsa();
  let siguiente = false;
  explicarCorsRechazado(pedir('https://nadie.example'), res, () => { siguiente = true; });

  assert.ok(!siguiente, 'el origen no autorizado siguió su camino');
  assert.equal(res.codigo, 403, `contestó ${res.codigo}: un 5xx hace parecer que el servidor está roto`);
  assert.ok(res.codigo < 500, 'un rechazo de configuración no puede ser un error del servidor');
});

test('el rechazo dice qué origen fue y dónde se arregla', () => {
  const res = respuestaFalsa();
  explicarCorsRechazado(pedir('https://nadie.example'), res, () => {});
  assert.equal(res.cuerpo.origen, 'https://nadie.example',
    'sin decir QUÉ origen, hay que ir a buscarlo al log del servidor');
  assert.match(res.cuerpo.pista, /CORS_ORIGINS|FRONTEND_URL/,
    'sin decir dónde se arregla, el mensaje sólo informa de que algo va mal');
});

test('el rechazo NO enumera los orígenes permitidos', () => {
  /* Eso ya está en el log del servidor. Contárselo a quien llama desde un
     origen que no autorizamos es enseñarle el mapa. */
  const res = respuestaFalsa();
  explicarCorsRechazado(pedir('https://nadie.example'), res, () => {});
  const texto = JSON.stringify(res.cuerpo);
  for (const permitido of ALLOWED_ORIGINS) {
    assert.ok(!texto.includes(permitido), `la respuesta filtra un origen permitido: ${permitido}`);
  }
});

test('el origen rechazado ya no lanza un Error dentro de `cors`', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'config', 'security.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /callback\(new Error/,
    'volvió el `callback(new Error(...))`: eso es el 500 que hizo dar producción por caída');
});
