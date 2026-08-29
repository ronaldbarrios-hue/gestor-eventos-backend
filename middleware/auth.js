/* Middleware: valida el access_token que manda el front en
   `Authorization: Bearer <token>`. Si es válido, deja `req.user = { id, email, ... }`.

   ── Por qué hay dos verificaciones y en este orden ────────────────────────

   Durante la migración conviven dos clases de token: los que emite nuestra
   identidad propia (`modules/auth`) y los que quedan vivos de Supabase. Este
   archivo prueba primero el nuestro y sólo cae al de Supabase si no valida.

   Eso hace tres cosas a la vez, y por eso se hace así y no cambiando los 38
   archivos de rutas:

   1. **Las 21 sesiones vivas no se cortan.** Quien tenía la aplicación abierta
      cuando se encendió el interruptor sigue dentro; su token de Supabase
      valida por el camino de siempre hasta que caduque.
   2. **Ninguna de las 312 referencias a `req.user` se toca.** La forma del
      objeto es la misma.
   3. **Cada petición con token nuestro se ahorra un viaje de red.** Verificar
      la firma es local; `supabase.auth.getUser()` es una llamada HTTP a
      Supabase por cada petición que hace la aplicación. Con las pantallas
      sondeando, ahí estaba una parte del gasto que no se veía.

   El orden importa: primero el local, porque es el que no cuesta nada. Al
   revés, todo seguiría pagando el viaje.

   ── Cuándo se puede borrar la mitad de este archivo ───────────────────────

   Cuando no queden tokens de Supabase vivos, o sea 30 días después de apagar
   su emisión. Entonces se borra `porSupabase` y esto son diez líneas. */

const supabase = require('../lib/supabase.js');
const config = require('../core/config');

/* Se importa perezosamente para no arrastrar el módulo entero (y su Router de
   Express) cuando la identidad propia está apagada, que es como arranca hoy. */
let _propia = null;
function propia() {
  if (!_propia) _propia = require('../modules/auth');
  return _propia;
}

function tokenDe(req) {
  const header = req.headers['authorization'] || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/* Nuestro token. Devuelve el usuario o null, sin red y sin lanzar. */
function porNosotros(req) {
  if (!config.AUTH_PROPIA) return null;
  return propia().verificar(req);
}

/* El camino viejo. Se deja intacto a propósito. */
async function porSupabase(token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function verifySupabaseJWT(req, res, next) {
  const token = tokenDe(req);
  if (!token) return res.status(401).json({ error: 'Token requerido.' });

  const nuestro = porNosotros(req);
  if (nuestro) { req.user = nuestro; return next(); }

  const suyo = await porSupabase(token);
  if (!suyo) return res.status(401).json({ error: 'Token inválido o expirado.' });

  req.user = suyo;
  next();
}

/* Igual al anterior pero no bloquea si no hay token (rutas mixtas). */
async function verifySupabaseJWTOptional(req, _res, next) {
  const token = tokenDe(req);
  if (!token) { req.user = null; return next(); }

  const nuestro = porNosotros(req);
  if (nuestro) { req.user = nuestro; return next(); }

  req.user = await porSupabase(token);
  next();
}

module.exports = { verifySupabaseJWT, verifySupabaseJWTOptional };
