/* Middleware: valida el access_token de Supabase Auth.
   El front lo manda en Authorization: Bearer <token>.
   Si es válido, deja req.user = { id, email, ... } y sigue. */
const supabase = require('../lib/supabase.js');

async function verifySupabaseJWT(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido.' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Token inválido o expirado.' });

  req.user = data.user;
  next();
}

/* Igual al anterior pero no bloquea si no hay token (rutas mixtas). */
async function verifySupabaseJWTOptional(req, _res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) { req.user = null; return next(); }
  const { data } = await supabase.auth.getUser(token);
  req.user = data?.user ?? null;
  next();
}

module.exports = { verifySupabaseJWT, verifySupabaseJWTOptional };
