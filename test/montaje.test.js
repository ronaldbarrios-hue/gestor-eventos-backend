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

  /* Se comprueba que HAYA un guardián, no cómo se llama: el nombre cambió una
     vez (verifyApiToken → autenticar, al añadir OAuth) y acoplar la prueba al
     nombre sólo produce un fallo que no significa nada. Lo que importa es que
     entre la ruta y el handler haya algo. */
  const conGuardia = (metodo, ruta) =>
    new RegExp(`router\\.${metodo}\\(\\s*'${ruta}'\\s*,\\s*\\w+\\s*,`).test(src);

  assert.ok(conGuardia('post', '\\/mcp'), 'POST /mcp tiene que pasar por un middleware de autenticación');
  assert.ok(conGuardia('get', '\\/mcp\\/estado'), 'GET /mcp/estado tiene que pasar por un middleware de autenticación');

  assert.ok(
    !RE_AUTH_ROUTER.test(src),
    'la autenticación no se exige a nivel de router: bloquearía la API pública',
  );

  /* Sin esta cabecera en el 401, un cliente MCP no descubre que hay OAuth ni
     dónde autorizar: ve un 401 pelado y el conector no arranca. Es el detalle
     que hace que todo el flujo de OAuth sirva para algo. */
  assert.ok(
    /WWW-Authenticate/i.test(src) && /resource_metadata/.test(src),
    'el 401 debe llevar WWW-Authenticate con resource_metadata',
  );
});

test('los metadatos de OAuth son públicos: sin ellos no hay descubrimiento', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'routes/oauth.js'), 'utf8');

  /* Claude lee los metadatos y se registra ANTES de tener credenciales. Si
     alguna de esas rutas exigiera sesión, el conector no se podría ni
     descubrir — y el error sería un 401 en un sitio donde nadie lo busca. */
  const publicas = [
    "\\/\\.well-known\\/oauth-protected-resource",
    "\\/\\.well-known\\/oauth-authorization-server",
    "\\/oauth\\/register",
    "\\/oauth\\/token",
  ];
  for (const ruta of publicas) {
    const conSesion = new RegExp(`router\\.\\w+\\(\\s*'${ruta}'\\s*,\\s*verifySupabaseJWT`);
    assert.ok(!conSesion.test(src), `${ruta} no puede exigir sesión: el cliente la llama sin estar autenticado`);
  }

  /* Y al contrario: aprobar SÍ tiene que exigirla, porque de ahí sale a qué
     cuenta se ata el permiso. */
  assert.ok(
    /router\.post\(\s*'\/oauth\/aprobar'\s*,\s*verifySupabaseJWT/.test(src),
    'aprobar tiene que exigir sesión: es lo que ata el permiso a una cuenta',
  );
  assert.ok(!RE_AUTH_ROUTER.test(src), 'router.use(auth) aquí bloquearía los metadatos');
});

test('las conexiones del organizador tampoco autentican a nivel de router', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'routes/conexiones.js'), 'utf8');
  assert.ok(!RE_AUTH_ROUTER.test(src), 'router.use(auth) aquí bloquearía la API pública');
  assert.ok(
    /router\.get\(\s*'\/me\/conexiones\/ia'\s*,\s*verifySupabaseJWT/.test(src),
    'las rutas de conexiones sí tienen que exigir sesión',
  );
});
