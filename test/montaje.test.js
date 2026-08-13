const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* Un router montado en '/' con `router.use(auth)` autentica TODAS las
   peticiones que pasan por él, no sólo las que casan con sus rutas. Puesto
   antes de las rutas públicas, tumba el sitio entero: páginas de evento,
   categorías, compra — todo devuelve 401.

   Pasó de verdad al añadir el servidor MCP: `router.use(verifyApiToken)`
   montado en '/' habría exigido un token gtk_live_ a cualquier visitante. Se
   cazó antes de que llegara a producción; esta prueba es para que la próxima
   vez la cace el suite y no la suerte.

   El peligro es POSICIONAL, y así se mide: hay siete routers heredados con el
   mismo patrón que funcionan porque se montan DESPUÉS de lo público, así que
   sólo alcanzan a rutas que ya exigían sesión. Feo, pero inofensivo. Delante
   de lo público es otra cosa. */

const RAIZ = path.join(__dirname, '..');

const RE_MONTAJE_RAIZ = /app\.use\(\s*'\/'\s*,[^)]*require\(\s*'\.\/(routes\/[\w.-]+\.js)'/;
const RE_AUTH_ROUTER = /router\.use\(\s*(verifySupabaseJWT|verifyApiToken)\s*\)/;
const RE_PUBLICA = /app\.use\(\s*'\/(categorias|eventos\/publicos)/;

function lineasIndex() {
  return fs.readFileSync(path.join(RAIZ, 'index.js'), 'utf8').split('\n');
}

test('la prueba sigue reconociendo los montajes de index.js', () => {
  const hay = lineasIndex().some(l => RE_MONTAJE_RAIZ.test(l));
  assert.ok(hay, 'la expresión ya no reconoce ningún montaje en "/": revísala');
});

test('ningún router que autentique con router.use() se monta antes de las rutas públicas', () => {
  const lineas = lineasIndex();

  const ultimaPublica = lineas.reduce((acc, l, i) => (RE_PUBLICA.test(l) ? i : acc), -1);
  assert.ok(ultimaPublica > 0, 'ya no reconozco dónde acaban las rutas públicas: revisa la prueba');

  const culpables = [];
  lineas.forEach((linea, i) => {
    if (i > ultimaPublica) return;              // detrás de lo público: no rompe
    const m = linea.match(RE_MONTAJE_RAIZ);
    if (!m) return;
    const ruta = path.join(RAIZ, m[1]);
    if (!fs.existsSync(ruta)) return;
    const auth = fs.readFileSync(ruta, 'utf8').match(RE_AUTH_ROUTER);
    if (auth) culpables.push(`index.js:${i + 1} monta ${m[1]}, que hace router.use(${auth[1]})`);
  });

  assert.deepEqual(
    culpables, [],
    'Un router montado en "/" ANTES de las rutas públicas que autentica con ' +
    'router.use() deja la web pública entera en 401. Pon el middleware por ruta. ' +
    `Culpables: ${culpables.join(' | ')}`,
  );
});

test('el servidor MCP protege sus rutas, sin proteger de más', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'routes/mcp.js'), 'utf8');
  assert.ok(
    /router\.post\(\s*'\/mcp'\s*,\s*verifyApiToken/.test(src),
    'POST /mcp tiene que exigir el token',
  );
  assert.ok(
    /router\.get\(\s*'\/mcp\/estado'\s*,\s*verifyApiToken/.test(src),
    'GET /mcp/estado tiene que exigir el token',
  );
  assert.ok(
    !RE_AUTH_ROUTER.test(src),
    'el token no se exige a nivel de router: bloquearía la API pública',
  );
});

test('las conexiones del organizador tampoco autentican a nivel de router', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'routes/conexiones.js'), 'utf8');
  assert.ok(!RE_AUTH_ROUTER.test(src), 'router.use(auth) aquí bloquearía la API pública');
  assert.ok(
    /router\.get\(\s*'\/me\/conexiones\/ia'\s*,\s*verifySupabaseJWT/.test(src),
    'las rutas de conexiones sí tienen que exigir sesión',
  );
});
