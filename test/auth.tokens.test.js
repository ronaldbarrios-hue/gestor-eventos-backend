'use strict';

/* Pruebas de la firma. Son las que no se pueden dejar para después: un fallo
   aquí no se nota —todo el mundo entra igual— y significa que cualquiera puede
   fabricarse un token de administrador. */

process.env.JWT_SECRET = 'secreto-de-prueba-que-no-es-el-de-produccion';
process.env.AUTH_PROPIA = 'true';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

const tokens = require('../modules/auth/tokens.js');

const USUARIO = { id: '11111111-2222-3333-4444-555555555555', email: 'ana@ejemplo.com' };

test('un token recién emitido vale y lleva el id y el correo', () => {
  const carga = tokens.verificarAcceso(tokens.emitirAcceso(USUARIO));
  assert.ok(carga);
  assert.equal(carga.sub, USUARIO.id);
  assert.equal(carga.email, USUARIO.email);
});

test('un token con la carga cambiada no vale', () => {
  /* El ataque de manual: coger un token propio, cambiar el `sub` por el de
     otra persona y volver a montarlo. La firma deja de cuadrar. */
  const bueno = tokens.emitirAcceso(USUARIO);
  const [cab, carga, firma] = bueno.split('.');
  const otra = Buffer.from(JSON.stringify({
    ...JSON.parse(Buffer.from(carga, 'base64url').toString()),
    sub: '99999999-9999-9999-9999-999999999999',
  })).toString('base64url');

  assert.equal(tokens.verificarAcceso(`${cab}.${otra}.${firma}`), null);
});

test('un token firmado con otro secreto no vale', () => {
  const ajeno = jwt.sign({ sub: USUARIO.id, tipo: 'acceso' }, 'otro-secreto', {
    algorithm: 'HS256', issuer: 'gestek', audience: 'gestek', expiresIn: 600,
  });
  assert.equal(tokens.verificarAcceso(ajeno), null);
});

test('un token sin firma (alg: none) no vale', () => {
  /* La vulnerabilidad más vieja de JWT: si el verificador acepta el algoritmo
     que diga la cabecera, `none` es un token sin firma dado por bueno. Se
     construye a mano porque la librería, con razón, no deja emitirlo. */
  const cab = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const carga = Buffer.from(JSON.stringify({
    sub: USUARIO.id, tipo: 'acceso', iss: 'gestek', aud: 'gestek',
    exp: Math.floor(Date.now() / 1000) + 600,
  })).toString('base64url');

  assert.equal(tokens.verificarAcceso(`${cab}.${carga}.`), null);
});

test('un token caducado no vale', () => {
  const viejo = tokens.emitirAcceso(USUARIO, { vidaSegundos: -10 });
  assert.equal(tokens.verificarAcceso(viejo), null);
});

test('un token de otro emisor no vale', () => {
  const ajeno = jwt.sign({ sub: USUARIO.id, tipo: 'acceso' }, process.env.JWT_SECRET, {
    algorithm: 'HS256', issuer: 'otra-app', audience: 'otra-app', expiresIn: 600,
  });
  assert.equal(tokens.verificarAcceso(ajeno), null);
});

test('la basura no revienta la verificación', () => {
  /* Llega lo que sea en la cabecera Authorization. Si esto lanzara, cualquiera
     tumbaría el servidor mandando `Bearer x`. */
  for (const malo of [null, undefined, '', 'x', 'a.b.c', 'Bearer', {}, 123]) {
    assert.doesNotThrow(() => tokens.verificarAcceso(malo));
    assert.equal(tokens.verificarAcceso(malo), null);
  }
});

test('un refresco no es un JWT y no se repite', () => {
  const a = tokens.nuevoRefresco();
  const b = tokens.nuevoRefresco();

  assert.notEqual(a.token, b.token);
  assert.notEqual(a.hash, b.hash);
  /* Lo que se guarda es el hash, nunca el token: quien se lleve un volcado de
     `sesiones` no puede entrar con nada de lo que hay dentro. */
  assert.notEqual(a.hash, a.token);
  assert.equal(a.hash, tokens.sha256(a.token));
  assert.equal(a.hash.length, 64);
  assert.ok(a.token.startsWith('gtkr_'));
});

test('los tokens de correo caben en una URL sin escapar nada', () => {
  const { token } = tokens.nuevoTokenCorreo();
  /* base64url: sin +, / ni =. Un `+` en la query de un enlace de correo se
     convierte en espacio y el enlace deja de funcionar para el usuario. */
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(encodeURIComponent(token), token);
});

test('el token de acceso no lleva la contraseña ni nada de más', () => {
  const carga = tokens.verificarAcceso(tokens.emitirAcceso({
    ...USUARIO, passwordHash: '$2a$10$loquesea', metadata: { telefono: '300' },
  }));
  const claves = Object.keys(carga).sort();
  assert.deepEqual(claves, ['aud', 'email', 'exp', 'iat', 'iss', 'sub', 'tipo']);
});
