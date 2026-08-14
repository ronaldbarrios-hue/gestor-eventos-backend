/* GESTEK — OAuth 2.1 para el conector de Claude.

   Por qué existe: el servidor MCP autenticaba con los tokens `gtk_live_`, y eso
   basta en Claude Code y Claude Desktop, donde se puede poner una cabecera a
   mano. Pero el conector personalizado de claude.ai NO tiene campo para un
   token Bearer — pide Authorization URL, Token URL, Client ID y Client Secret.
   Sin OAuth, desde la web y el móvil no hay forma de conectarlo.

   Sólo la mecánica vive aquí; las rutas están en routes/oauth.js y la pantalla
   de consentimiento en el frontend.

   Tres cosas que NO se negocian, porque son las que hacen que esto sea seguro
   y las tres son fáciles de dejarse a medias:

   1. PKCE con S256, obligatorio. Sin él, quien intercepte el código en el
      redirect lo puede canjear. `plain` se rechaza.
   2. `redirect_uri` con coincidencia EXACTA contra las registradas. Un prefijo
      o un comodín convierte esto en un redirect abierto.
   3. Los códigos son de un solo uso y se MARCAN en vez de borrarse, para poder
      detectar un segundo intento — que es señal de que alguien lo robó. */

const crypto = require('crypto');
const supabase = require('./supabase.js');

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const aleatorio = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

/* Vidas cortas donde importan. El código sólo tiene que sobrevivir un
   redirect; el acceso, una sesión de trabajo. El refresco es el que dura. */
const VIDA_CODIGO_S  = 300;            // 5 minutos
const VIDA_ACCESO_S  = 60 * 60 * 8;    // 8 horas
const VIDA_REFRESH_S = 60 * 60 * 24 * 90;

const faltaTabla = (e) => /oauth_(clients|codes|tokens)|does not exist/i.test(String(e?.message || ''));

/* ── URL pública ──────────────────────────────────────────────────────
   Los metadatos de OAuth tienen que anunciar la URL por la que el cliente
   llega de verdad. Si aquí se anunciara `localhost`, Claude intentaría
   hablarle a su propia máquina. */
function baseUrl(req) {
  const env = (process.env.BACKEND_URL || '').replace(/\/$/, '');
  if (env) return env;
  /* Detrás del proxy de Render el protocolo real viene en la cabecera. */
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${proto}://${req.get('host')}`;
}

const frontendUrl = () => (process.env.FRONTEND_URL || '').replace(/\/$/, '');

/* ── Registro dinámico de cliente (RFC 7591) ──────────────────────────
   Claude se registra solo al añadir el conector: nadie crea credenciales a
   mano. Se aceptan clientes públicos (sin secreto) porque usan PKCE. */

function validarRedirects(uris) {
  if (!Array.isArray(uris) || uris.length === 0) return 'Hace falta al menos un redirect_uri.';
  for (const u of uris) {
    let parsed;
    try { parsed = new URL(u); } catch { return `redirect_uri inválida: ${u}`; }
    /* HTTPS obligatorio salvo localhost, que es el caso legítimo de un cliente
       de escritorio. `http://` en cualquier otro sitio expone el código. */
    const esLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && esLocal)) {
      return `redirect_uri debe ser https (o localhost): ${u}`;
    }
    /* Un fragmento en el redirect rompe el intercambio del código. */
    if (parsed.hash) return `redirect_uri no puede llevar fragmento: ${u}`;
  }
  return null;
}

async function registrarCliente({ client_name, redirect_uris }) {
  const fallo = validarRedirects(redirect_uris);
  if (fallo) return { error: fallo };

  const client_id = `gtkc_${aleatorio(16)}`;
  const fila = {
    client_id,
    secret_hash: null,                 // cliente público: PKCE es la prueba
    nombre: String(client_name || 'Cliente sin nombre').slice(0, 120),
    redirect_uris,
  };

  const { error } = await supabase.from('oauth_clients').insert(fila);
  if (error) {
    if (faltaTabla(error)) return { error: 'Falta aplicar la migración 0073.' };
    return { error: error.message };
  }

  return {
    cliente: {
      client_id,
      client_name: fila.nombre,
      redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  };
}

async function verCliente(clientId) {
  if (!clientId) return null;
  const { data } = await supabase
    .from('oauth_clients').select('*').eq('client_id', clientId).maybeSingle();
  return data || null;
}

/* ── Autorización ─────────────────────────────────────────────────────── */

/* Comprueba la petición ANTES de mandar al usuario a la pantalla de
   consentimiento: no tiene sentido pedirle permiso para algo que va a fallar
   al canjear. Devuelve { ok, error } o { ok: true, cliente }. */
async function validarAutorizacion({ client_id, redirect_uri, code_challenge, code_challenge_method, response_type }) {
  if (response_type !== 'code') return { error: 'unsupported_response_type' };

  const cliente = await verCliente(client_id);
  if (!cliente) return { error: 'invalid_client' };

  /* Coincidencia exacta. Comparar por prefijo aquí es un redirect abierto. */
  if (!cliente.redirect_uris.includes(redirect_uri)) {
    return { error: 'invalid_redirect_uri' };
  }

  if (!code_challenge) return { error: 'PKCE es obligatorio: falta code_challenge.' };
  if ((code_challenge_method || 'plain') !== 'S256') {
    return { error: 'Sólo se acepta code_challenge_method=S256.' };
  }

  return { ok: true, cliente };
}

/* El usuario aprobó. Se emite el código atado a su cuenta. */
async function emitirCodigo({ client_id, owner_id, redirect_uri, code_challenge, scope }) {
  const code = `gtkac_${aleatorio(32)}`;
  const { error } = await supabase.from('oauth_codes').insert({
    code_hash: hash(code),
    client_id, owner_id, redirect_uri,
    code_challenge,
    challenge_metodo: 'S256',
    scope: scope || 'mcp',
    expira_at: new Date(Date.now() + VIDA_CODIGO_S * 1000).toISOString(),
  });
  if (error) return { error: faltaTabla(error) ? 'Falta aplicar la migración 0073.' : error.message };
  return { code };
}

/* ── Canje ────────────────────────────────────────────────────────────── */

function verificarPkce(verifier, challenge) {
  if (!verifier) return false;
  const calc = crypto.createHash('sha256').update(verifier).digest('base64url');
  /* Comparación en tiempo constante: comparar con === filtra información por
     el tiempo que tarda en fallar. */
  const a = Buffer.from(calc);
  const b = Buffer.from(String(challenge));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function emitirTokens({ client_id, owner_id, scope }) {
  const access = `gtkat_${aleatorio(32)}`;
  const refresh = `gtkrt_${aleatorio(32)}`;
  const { error } = await supabase.from('oauth_tokens').insert({
    token_hash: hash(access),
    refresh_hash: hash(refresh),
    client_id, owner_id, scope: scope || 'mcp',
    expira_at: new Date(Date.now() + VIDA_ACCESO_S * 1000).toISOString(),
  });
  if (error) return { error: error.message };
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: 'Bearer',
    expires_in: VIDA_ACCESO_S,
    scope: scope || 'mcp',
  };
}

async function canjearCodigo({ code, client_id, redirect_uri, code_verifier }) {
  const { data: fila } = await supabase
    .from('oauth_codes').select('*').eq('code_hash', hash(code)).maybeSingle();

  if (!fila) return { error: 'invalid_grant', detalle: 'El código no existe.' };

  /* Reutilización: señal de robo. Se revoca todo lo emitido a ese cliente para
     esa cuenta, porque no se puede saber quién tiene el código. */
  if (fila.usado_at) {
    await supabase.from('oauth_tokens').update({ revocado: true })
      .eq('client_id', fila.client_id).eq('owner_id', fila.owner_id);
    return { error: 'invalid_grant', detalle: 'El código ya se usó; se revocaron los tokens de esa conexión por seguridad.' };
  }

  if (new Date(fila.expira_at) < new Date()) return { error: 'invalid_grant', detalle: 'El código caducó.' };
  if (fila.client_id !== client_id)          return { error: 'invalid_grant', detalle: 'El código es de otro cliente.' };
  if (fila.redirect_uri !== redirect_uri)    return { error: 'invalid_grant', detalle: 'El redirect_uri no coincide.' };
  if (!verificarPkce(code_verifier, fila.code_challenge)) {
    return { error: 'invalid_grant', detalle: 'PKCE no coincide.' };
  }

  /* Marcar antes de emitir: si algo falla después, el código ya no vale. */
  await supabase.from('oauth_codes')
    .update({ usado_at: new Date().toISOString() }).eq('code_hash', fila.code_hash);

  return emitirTokens({ client_id, owner_id: fila.owner_id, scope: fila.scope });
}

async function canjearRefresh({ refresh_token, client_id }) {
  const { data: fila } = await supabase
    .from('oauth_tokens').select('*').eq('refresh_hash', hash(refresh_token)).maybeSingle();

  if (!fila || fila.revocado) return { error: 'invalid_grant', detalle: 'Refresco inválido o revocado.' };
  if (fila.client_id !== client_id) return { error: 'invalid_grant', detalle: 'El refresco es de otro cliente.' };

  /* Rotación: el refresco viejo se revoca al usarse. Si aparece otra vez,
     sabemos que alguien lo tenía. */
  await supabase.from('oauth_tokens').update({ revocado: true }).eq('id', fila.id);
  return emitirTokens({ client_id, owner_id: fila.owner_id, scope: fila.scope });
}

/* ── Uso ──────────────────────────────────────────────────────────────── */

/* Resuelve un token de acceso a su dueño. Devuelve null si no vale, para que
   quien llama responda 401 sin distinguir el motivo. */
async function dueñoDelToken(access) {
  if (!access || !/^gtkat_[a-f0-9]+$/.test(access)) return null;
  const { data: fila } = await supabase
    .from('oauth_tokens').select('*').eq('token_hash', hash(access)).maybeSingle();

  if (!fila || fila.revocado) return null;
  if (new Date(fila.expira_at) < new Date()) return null;

  supabase.from('oauth_tokens')
    .update({ ultimo_uso_at: new Date().toISOString() }).eq('id', fila.id)
    .then(() => {}, () => {});

  return { ownerId: fila.owner_id, clientId: fila.client_id, scope: fila.scope };
}

async function revocar(token) {
  const h = hash(token);
  await supabase.from('oauth_tokens').update({ revocado: true }).or(`token_hash.eq.${h},refresh_hash.eq.${h}`);
  return { ok: true };
}

/* Las conexiones activas de una cuenta, para poder enseñarlas y cortarlas
   desde el panel. */
async function conexionesDe(ownerId) {
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('id, client_id, scope, created_at, ultimo_uso_at, expira_at, revocado, oauth_clients(nombre)')
    .eq('owner_id', ownerId).eq('revocado', false)
    .order('created_at', { ascending: false });
  if (error) return { disponible: !faltaTabla(error), conexiones: [] };
  return { disponible: true, conexiones: data || [] };
}

async function revocarPorId(ownerId, id) {
  const { error } = await supabase.from('oauth_tokens')
    .update({ revocado: true }).eq('id', id).eq('owner_id', ownerId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

module.exports = {
  baseUrl, frontendUrl,
  registrarCliente, verCliente,
  validarAutorizacion, emitirCodigo,
  canjearCodigo, canjearRefresh,
  dueñoDelToken, revocar, conexionesDe, revocarPorId,
  VIDA_ACCESO_S, VIDA_CODIGO_S,
  _hash: hash, _verificarPkce: verificarPkce, _validarRedirects: validarRedirects,
};
