const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const oauth = require('../lib/oauth.js');

/* En OAuth los fallos no se ven: el flujo «funciona» igual con PKCE roto o con
   un redirect_uri permisivo — sólo que cualquiera puede robar la sesión. Estas
   pruebas cubren las tres cosas que lo hacen seguro y que son fáciles de dejar
   a medias. No tocan la base: prueban la lógica pura. */

/* ── PKCE ─────────────────────────────────────────────────────────────── */

test('PKCE acepta el verificador correcto', () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.equal(oauth._verificarPkce(verifier, challenge), true);
});

test('PKCE rechaza un verificador distinto', () => {
  const challenge = crypto.createHash('sha256').update('el-bueno').digest('base64url');
  assert.equal(oauth._verificarPkce('otro', challenge), false);
});

test('PKCE rechaza un verificador vacío', () => {
  const challenge = crypto.createHash('sha256').update('x').digest('base64url');
  assert.equal(oauth._verificarPkce('', challenge), false);
  assert.equal(oauth._verificarPkce(undefined, challenge), false);
});

test('PKCE no revienta con longitudes distintas', () => {
  /* timingSafeEqual lanza si los buffers miden distinto: hay que comprobar la
     longitud antes, o un challenge corto tumba el endpoint. */
  assert.doesNotThrow(() => oauth._verificarPkce('a', 'corto'));
  assert.equal(oauth._verificarPkce('a', 'corto'), false);
});

/* ── redirect_uri ─────────────────────────────────────────────────────── */

test('se aceptan https y localhost, y se rechaza http remoto', () => {
  assert.equal(oauth._validarRedirects(['https://claude.ai/api/mcp/auth_callback']), null);
  assert.equal(oauth._validarRedirects(['http://localhost:3000/cb']), null);
  assert.equal(oauth._validarRedirects(['http://127.0.0.1:8080/cb']), null);

  /* http remoto expone el código en tránsito. */
  assert.match(oauth._validarRedirects(['http://ejemplo.com/cb']), /https/);
});

test('se rechaza una lista vacía o ausente', () => {
  assert.match(oauth._validarRedirects([]), /al menos un/);
  assert.match(oauth._validarRedirects(undefined), /al menos un/);
});

test('se rechaza una URL con fragmento', () => {
  /* Un `#` en el redirect rompe el intercambio del código. */
  assert.match(oauth._validarRedirects(['https://claude.ai/cb#x']), /fragmento/);
});

test('se rechaza una URL que no es URL', () => {
  assert.match(oauth._validarRedirects(['no-soy-una-url']), /inválida/);
});

/* ── validación de la petición de autorización ────────────────────────── */

test('sólo se admite response_type=code', async () => {
  const r = await oauth.validarAutorizacion({ response_type: 'token' });
  assert.equal(r.error, 'unsupported_response_type');
});

/* ── hash ─────────────────────────────────────────────────────────────── */

test('los secretos se guardan como hash, no en claro', () => {
  const t = 'gtkat_abcdef';
  const h = oauth._hash(t);
  assert.equal(h.length, 64, 'sha256 en hex son 64 caracteres');
  assert.notEqual(h, t);
  assert.equal(oauth._hash(t), h, 'el hash tiene que ser estable');
});

/* ── URL pública anunciada en los metadatos ───────────────────────────── */

test('la URL base respeta el proto del proxy', () => {
  const guardado = process.env.BACKEND_URL;
  delete process.env.BACKEND_URL;
  const req = { headers: { 'x-forwarded-proto': 'https' }, protocol: 'http', get: () => 'api.ejemplo.com' };
  /* Detrás del proxy de Render el protocolo real llega por cabecera: si se
     anunciara http, Claude rechazaría los metadatos. */
  assert.equal(oauth.baseUrl(req), 'https://api.ejemplo.com');
  if (guardado) process.env.BACKEND_URL = guardado;
});

test('BACKEND_URL manda sobre la cabecera, y sin barra final', () => {
  const guardado = process.env.BACKEND_URL;
  process.env.BACKEND_URL = 'https://api.gestek.co/';
  const req = { headers: {}, protocol: 'http', get: () => 'otra-cosa' };
  assert.equal(oauth.baseUrl(req), 'https://api.gestek.co');
  if (guardado) process.env.BACKEND_URL = guardado; else delete process.env.BACKEND_URL;
});

test('un token que no tiene forma de token no llega a consultar la base', async () => {
  /* Sin este filtro, cualquier basura en la cabecera provoca una consulta. */
  assert.equal(await oauth.dueñoDelToken('no-es-un-token'), null);
  assert.equal(await oauth.dueñoDelToken(''), null);
  assert.equal(await oauth.dueñoDelToken(undefined), null);
});
