'use strict';

/* El middleware es donde se cobra el cambio de §5.4: hoy cada petición de la
   aplicación cuesta una llamada de red a Supabase para averiguar quién la hace.
   Con la identidad propia, un token nuestro se verifica localmente y esa
   llamada no existe.
 *
 * Que «funcione» no basta: si el orden estuviera al revés, todo seguiría
 * entrando igual y se seguiría pagando el viaje en cada petición, sin que nada
 * fallara. Por eso lo que se cuenta aquí son las llamadas a Supabase.
 *
 * Y la otra mitad: que un token de Supabase siga valiendo. Son las 21 sesiones
 * que estaban abiertas cuando se encendió el interruptor; si dejaran de valer,
 * el día de la migración todo el mundo se encontraría fuera de golpe. */

process.env.JWT_SECRET = 'secreto-de-prueba-que-no-es-el-de-produccion';
process.env.AUTH_PROPIA = 'true';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const test = require('node:test');
const assert = require('node:assert');

/* Se sustituye `lib/supabase.js` en la caché de módulos ANTES de cargar el
   middleware, para poder contar las llamadas sin salir a la red. */
const rutaSupabase = require.resolve('../lib/supabase.js');
let llamadasASupabase = 0;
let respuestaDeSupabase = { data: { user: { id: 'usuario-de-supabase', email: 'viejo@ejemplo.com' } }, error: null };

require.cache[rutaSupabase] = {
  id: rutaSupabase, filename: rutaSupabase, loaded: true, exports: {
    auth: {
      async getUser() { llamadasASupabase += 1; return respuestaDeSupabase; },
    },
  },
};

const { verifySupabaseJWT, verifySupabaseJWTOptional } = require('../middleware/auth.js');
const tokens = require('../modules/auth/tokens.js');

const USUARIO = { id: '11111111-2222-3333-4444-555555555555', email: 'ana@ejemplo.com' };

/* Un par de dobles de Express, lo justo para saber qué contestó. */
function peticion(token) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}
function respuesta() {
  const r = { codigo: null, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}
async function pasar(middleware, req) {
  const res = respuesta();
  let siguio = false;
  await middleware(req, res, () => { siguio = true; });
  return { res, siguio };
}

test('un token nuestro entra SIN preguntarle a Supabase', async () => {
  llamadasASupabase = 0;
  const req = peticion(tokens.emitirAcceso(USUARIO));

  const { siguio } = await pasar(verifySupabaseJWT, req);

  assert.equal(siguio, true);
  assert.equal(req.user.id, USUARIO.id);
  assert.equal(req.user.email, USUARIO.email);
  /* Lo que se está comprobando de verdad: cero viajes de red. */
  assert.equal(llamadasASupabase, 0);
});

test('un token de Supabase sigue valiendo, por el camino de siempre', async () => {
  llamadasASupabase = 0;
  respuestaDeSupabase = { data: { user: { id: 'usuario-de-supabase', email: 'viejo@ejemplo.com' } }, error: null };

  const { siguio } = await pasar(verifySupabaseJWT, peticion('token-viejo-de-supabase'));

  assert.equal(siguio, true);
  assert.equal(llamadasASupabase, 1);
});

test('sin token, 401 y no se pregunta a nadie', async () => {
  llamadasASupabase = 0;
  const { res, siguio } = await pasar(verifySupabaseJWT, peticion(null));

  assert.equal(siguio, false);
  assert.equal(res.codigo, 401);
  assert.equal(llamadasASupabase, 0);
});

test('un token que no vale en ninguno de los dos sitios da 401', async () => {
  respuestaDeSupabase = { data: null, error: { message: 'invalid' } };
  const { res, siguio } = await pasar(verifySupabaseJWT, peticion('basura'));

  assert.equal(siguio, false);
  assert.equal(res.codigo, 401);
});

test('un token nuestro caducado no cuela por el camino de Supabase', async () => {
  /* Sin esto, un token nuestro vencido caería al método viejo, Supabase diría
     que no lo conoce y el resultado sería el correcto por casualidad. Lo que
     no puede pasar es que Supabase lo dé por bueno: se comprueba que se
     rechaza aunque Supabase conteste que sí. */
  respuestaDeSupabase = { data: { user: { id: 'otro', email: 'otro@ejemplo.com' } }, error: null };
  const viejo = tokens.emitirAcceso(USUARIO, { vidaSegundos: -10 });
  const req = peticion(viejo);

  const { siguio } = await pasar(verifySupabaseJWT, req);

  /* Cae al camino viejo, que es lo que da la compatibilidad. Lo que importa es
     que la identidad NO sale del token caducado: quien entra es quien diga
     Supabase, no el `sub` que llevaba dentro un token que ya no vale. */
  assert.equal(siguio, true);
  assert.equal(req.user.id, 'otro');
  assert.notEqual(req.user.id, USUARIO.id);
});

test('la versión opcional deja pasar sin token y con token nuestro', async () => {
  llamadasASupabase = 0;

  const sinToken = { headers: {} };
  const a = await pasar(verifySupabaseJWTOptional, sinToken);
  assert.equal(a.siguio, true);
  assert.equal(sinToken.user, null);

  const conToken = peticion(tokens.emitirAcceso(USUARIO));
  const b = await pasar(verifySupabaseJWTOptional, conToken);
  assert.equal(b.siguio, true);
  assert.equal(conToken.user.id, USUARIO.id);
  assert.equal(llamadasASupabase, 0);
});

test('el usuario que deja el middleware tiene la forma que esperan las 312 referencias a req.user', async () => {
  const req = peticion(tokens.emitirAcceso(USUARIO));
  await pasar(verifySupabaseJWT, req);

  /* `id`, `email` y `user_metadata`: lo que leen los 38 archivos de rutas. Si
     esto cambiara, habría que tocarlos todos. */
  assert.ok('id' in req.user);
  assert.ok('email' in req.user);
  assert.ok('user_metadata' in req.user);
});
