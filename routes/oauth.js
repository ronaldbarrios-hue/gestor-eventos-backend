/* GESTEK — Rutas OAuth 2.1 del conector.

   Es lo que claude.ai necesita para añadir GESTEK como conector personalizado.
   El orden en que las usa un cliente:

     1. GET  /.well-known/oauth-protected-resource/mcp  → «¿quién autoriza?»
     2. GET  /.well-known/oauth-authorization-server    → «¿qué endpoints?»
     3. POST /oauth/register                            → se registra solo
     4. GET  /oauth/authorize                           → manda al usuario a aprobar
     5. POST /oauth/token                               → canjea el código
     6. POST /mcp con Authorization: Bearer             → trabaja

   Los pasos 1–3 y 5 son de máquina y no llevan sesión. El 4 sí: manda a la
   pantalla del panel, donde el organizador ve qué va a poder hacer Claude y
   decide. Aprobar es lo único que hace una persona.

   Ojo con el montaje: este router va en '/' y por eso el middleware de sesión
   va POR RUTA. Un router.use() aquí exigiría sesión a los metadatos, que
   Claude lee sin estar autenticado — y el conector no se podría ni descubrir. */

const express = require('express');
const { sesion } = require('../core/permisos');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const oauth = require('../lib/oauth.js');

const router = express.Router();

/* ── 1 · Metadatos del recurso protegido (RFC 9728) ───────────────────── */

function recursoProtegido(req, res) {
  const base = oauth.baseUrl(req);
  res.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${base}/mcp/estado`,
  });
}

/* Los clientes prueban las dos formas: con y sin la ruta del recurso. */
router.get('/.well-known/oauth-protected-resource', recursoProtegido);
router.get('/.well-known/oauth-protected-resource/mcp', recursoProtegido);

/* ── 2 · Metadatos del servidor de autorización (RFC 8414) ────────────── */

function servidorAutorizacion(req, res) {
  const base = oauth.baseUrl(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: ['mcp'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    /* Cliente público: la prueba es PKCE, no un secreto. */
    token_endpoint_auth_methods_supported: ['none'],
    /* S256 y nada más: `plain` no protege de un código interceptado. */
    code_challenge_methods_supported: ['S256'],
  });
}

router.get('/.well-known/oauth-authorization-server', servidorAutorizacion);
router.get('/.well-known/openid-configuration', servidorAutorizacion);

/* ── 3 · Registro dinámico (RFC 7591) ─────────────────────────────────── */

router.post('/oauth/register', async (req, res) => {
  const { client_name, redirect_uris } = req.body || {};
  const r = await oauth.registrarCliente({ client_name, redirect_uris });
  if (r.error) return res.status(400).json({ error: 'invalid_client_metadata', error_description: r.error });
  res.status(201).json(r.cliente);
});

/* ── 4 · Autorización ─────────────────────────────────────────────────── */

/* No responde HTML: redirige a la pantalla del panel con los parámetros. Así
   la parte visual vive en el frontend, con la sesión que ya tiene el
   organizador, y aquí sólo queda la validación. */
router.get('/oauth/authorize', async (req, res) => {
  const {
    client_id, redirect_uri, response_type = 'code',
    code_challenge, code_challenge_method = 'S256',
    state, scope,
  } = req.query;

  const v = await oauth.validarAutorizacion({
    client_id, redirect_uri, code_challenge, code_challenge_method, response_type,
  });

  /* Si el redirect_uri no es de fiar, el error NO se manda ahí: se enseña
     aquí. Redirigir un error a una URL no validada es el redirect abierto que
     estamos evitando. */
  if (v.error === 'invalid_client' || v.error === 'invalid_redirect_uri') {
    return res.status(400).json({ error: v.error, error_description: 'Cliente o redirect_uri no registrados.' });
  }
  /* Lo demás sí puede volver al cliente, que es lo que espera el estándar. */
  if (v.error) {
    const u = new URL(redirect_uri);
    u.searchParams.set('error', v.error.includes('PKCE') || v.error.includes('S256') ? 'invalid_request' : v.error);
    u.searchParams.set('error_description', v.error);
    if (state) u.searchParams.set('state', state);
    return res.redirect(302, u.toString());
  }

  const front = oauth.frontendUrl();
  if (!front) {
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Falta FRONTEND_URL en el servidor: no se sabe a qué pantalla mandar al usuario a aprobar.',
    });
  }

  /* Los parámetros viajan al frontend y vuelven en la aprobación. No se
     guarda nada todavía: hasta que la persona no diga sí, no hay código. */
  const destino = new URL(`${front}/conectar/autorizar`);
  for (const [k, val] of Object.entries({
    client_id, redirect_uri, code_challenge, state, scope: scope || 'mcp',
    cliente: v.cliente.nombre,
  })) {
    if (val) destino.searchParams.set(k, val);
  }
  res.redirect(302, destino.toString());
});

/* La persona aprobó en la pantalla. Esto sí exige su sesión: el código se ata
   a la cuenta de quien aprueba, no a la que diga el cliente. */
router.post('/oauth/aprobar', verifySupabaseJWT, async (req, res) => {
  const { client_id, redirect_uri, code_challenge, state, scope } = req.body || {};

  const v = await oauth.validarAutorizacion({
    client_id, redirect_uri, code_challenge, code_challenge_method: 'S256', response_type: 'code',
  });
  if (v.error) return res.status(400).json({ error: v.error });

  const r = await oauth.emitirCodigo({
    client_id, owner_id: req.user.id, redirect_uri, code_challenge, scope,
  });
  if (r.error) return res.status(400).json({ error: r.error });

  const u = new URL(redirect_uri);
  u.searchParams.set('code', r.code);
  if (state) u.searchParams.set('state', state);
  res.json({ ok: true, redirect: u.toString() });
});

/* ── 5 · Token ────────────────────────────────────────────────────────── */

router.post('/oauth/token', async (req, res) => {
  /* El estándar manda form-urlencoded; algunos clientes envían JSON. Se
     aceptan los dos en vez de devolver un error que nadie sabe interpretar. */
  const b = req.body || {};
  const { grant_type, client_id } = b;

  if (!client_id) return res.status(400).json({ error: 'invalid_request', error_description: 'Falta client_id.' });

  let r;
  if (grant_type === 'authorization_code') {
    r = await oauth.canjearCodigo({
      code: b.code, client_id, redirect_uri: b.redirect_uri, code_verifier: b.code_verifier,
    });
  } else if (grant_type === 'refresh_token') {
    r = await oauth.canjearRefresh({ refresh_token: b.refresh_token, client_id });
  } else {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  if (r.error) return res.status(400).json({ error: r.error, error_description: r.detalle });

  /* Sin caché: son credenciales. */
  res.set('Cache-Control', 'no-store');
  res.json(r);
});

router.post('/oauth/revoke', async (req, res) => {
  const t = req.body?.token;
  if (t) await oauth.revocar(t);
  /* El estándar pide 200 siempre, incluso si el token no existía: decir
     «ese token no existe» es filtrar información. */
  res.status(200).json({});
});

/* ── Panel: ver y cortar conexiones ───────────────────────────────────── */

router.get('/me/conexiones/mcp', verifySupabaseJWT, sesion("Los conectores MCP de su cuenta: cada token es de una persona."), async (req, res) => {
  res.json(await oauth.conexionesDe(req.user.id));
});

router.delete('/me/conexiones/mcp/:id', verifySupabaseJWT, sesion("Los conectores MCP de su cuenta: cada token es de una persona."), async (req, res) => {
  const r = await oauth.revocarPorId(req.user.id, req.params.id);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true, aviso: 'Conexión cortada. Claude tendrá que volver a pedir permiso.' });
});

module.exports = router;
