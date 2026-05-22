/* GESTEK — API tokens. Formato: gtk_live_<32 hex>. Solo guardamos el hash. */

const crypto = require('crypto');
const supabase = require('./supabase.js');

function generarToken() {
  const raw = crypto.randomBytes(24).toString('hex');     // 48 chars
  const token = `gtk_live_${raw}`;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const prefix = token.slice(0, 16) + '…';                // gtk_live_ab12cd…
  return { token, hash, prefix };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/* Middleware: exige Authorization: Bearer gtk_live_...
   Deja req.apiOwner = owner_id y req.apiToken = fila. */
async function verifyApiToken(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(gtk_live_[a-f0-9]+)$/i);
  if (!m) return res.status(401).json({ error: 'Token de API requerido (Authorization: Bearer gtk_live_...).' });

  const hash = hashToken(m[1]);
  const { data: tok, error } = await supabase
    .from('api_tokens').select('*').eq('token_hash', hash).maybeSingle();
  if (error)  return res.status(500).json({ error: error.message });
  if (!tok || tok.revoked) return res.status(401).json({ error: 'Token inválido o revocado.' });

  req.apiOwner = tok.owner_id;
  req.apiToken = tok;
  /* last_used_at best-effort */
  supabase.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tok.id).then(() => {}, () => {});
  next();
}

module.exports = { generarToken, hashToken, verifyApiToken };
