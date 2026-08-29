'use strict';

/* «Entrar con Google» es por donde entran 22 de las 29 cuentas. Lo que se
   prueba aquí son las tres cosas que, si se hacen mal, no se ven:
 *
 *   - que el `state` no se pueda falsificar (o esto es un redirector abierto
 *     que entrega la sesión recién abierta en un dominio ajeno);
 *   - que se identifique a la persona por el `sub` y no por el correo (o quien
 *     cambie su dirección en Google pierde su cuenta y sus eventos);
 *   - que los tokens vuelvan en el fragmento y no en la query (o acaban en los
 *     registros de acceso y en la cabecera Referer).
 */

process.env.JWT_SECRET = 'secreto-de-prueba-que-no-es-el-de-produccion';
process.env.AUTH_PROPIA = 'true';
process.env.GOOGLE_CLIENT_ID = 'cliente-de-prueba.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'secreto-de-google-de-prueba';
process.env.GOOGLE_AUTH_REDIRECT = 'https://api.ejemplo.com/auth/google/callback';
process.env.FRONTEND_URL = 'https://app.ejemplo.com';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const test = require('node:test');
const assert = require('node:assert');

const google = require('../modules/auth/google.js');
const { crearRepoFalso, uuid } = require('./_repoFalso.js');

/* ── La URL de consentimiento ──────────────────────────────────────────── */

test('la URL de consentimiento lleva nuestro cliente y nuestro redirect', () => {
  const url = new URL(google.urlDeConsentimiento({ destino: '/inicio' }));

  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), process.env.GOOGLE_AUTH_REDIRECT);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.match(url.searchParams.get('scope'), /openid/);
});

test('el estado se firma y se puede volver a leer', () => {
  const url = new URL(google.urlDeConsentimiento({ destino: '/eventos/42' }));
  const estado = google.verificarEstado(url.searchParams.get('state'));

  assert.ok(estado);
  assert.equal(estado.d, '/eventos/42');
});

test('un estado con la firma cambiada no vale', () => {
  const url = new URL(google.urlDeConsentimiento({ destino: '/inicio' }));
  const [cuerpo] = url.searchParams.get('state').split('.');

  assert.equal(google.verificarEstado(`${cuerpo}.firmafalsa`), null);
  assert.equal(google.verificarEstado(cuerpo), null);
  assert.equal(google.verificarEstado(''), null);
  assert.equal(google.verificarEstado(null), null);
});

test('un estado con el destino cambiado no vale', () => {
  /* El ataque concreto: reescribir el destino a un dominio propio para que la
     vuelta —con los tokens en el fragmento— caiga allí. */
  const url = new URL(google.urlDeConsentimiento({ destino: '/inicio' }));
  const [, firma] = url.searchParams.get('state').split('.');
  const otro = Buffer.from(JSON.stringify({ d: '//malo.com', t: Date.now() })).toString('base64url');

  assert.equal(google.verificarEstado(`${otro}.${firma}`), null);
});

test('un estado viejo no vale', () => {
  const viejo = google._firmar({ d: '/inicio', t: Date.now() - 3600 * 1000 });
  assert.equal(google.verificarEstado(viejo), null);
});

test('el destino sólo puede ser una ruta nuestra', () => {
  assert.equal(google._destinoSeguro('/eventos/7'), '/eventos/7');
  assert.equal(google._destinoSeguro('/inicio?tab=hoy'), '/inicio?tab=hoy');

  /* Todo lo demás cae a /inicio. Un destino externo aquí sería entregar la
     sesión recién abierta a quien fabricó el enlace. */
  assert.equal(google._destinoSeguro('https://malo.com'), '/inicio');
  assert.equal(google._destinoSeguro('//malo.com'), '/inicio');
  assert.equal(google._destinoSeguro('javascript:alert(1)'), '/inicio');
  assert.equal(google._destinoSeguro(''), '/inicio');
  assert.equal(google._destinoSeguro(null), '/inicio');
});

/* ── A quién corresponde el perfil que devuelve Google ─────────────────── */

test('con el sub ya conocido, entra a SU cuenta aunque el correo haya cambiado', async () => {
  /* El caso que decide todo el diseño: la persona cambió su dirección en
     Google. Si se emparejara por correo, entraría a una cuenta nueva y vacía y
     sus eventos se quedarían en la vieja. */
  const id = uuid();
  const repo = crearRepoFalso({ usuarios: [{ id, email: 'vieja@ejemplo.com' }] });
  await repo.enlazarIdentidad({ usuarioId: id, proveedor: 'google', proveedorId: '1234', email: 'vieja@ejemplo.com' });

  const { usuario, nuevo } = await google.resolverUsuario(
    { sub: '1234', email: 'nueva@ejemplo.com', email_verified: true, name: 'Ana' },
    { repo }
  );

  assert.equal(usuario.id, id);
  assert.equal(nuevo, false);
});

test('si el correo ya tiene cuenta, se enlaza en vez de duplicarla', async () => {
  /* Es el camino de quien se registró con contraseña y un día pulsa el botón de
     Google. Sin esto tendría dos cuentas con el mismo correo. */
  const id = uuid();
  const repo = crearRepoFalso({ usuarios: [{ id, email: 'ana@ejemplo.com', emailConfirmado: false }] });

  const { usuario, nuevo } = await google.resolverUsuario(
    { sub: '9999', email: 'ana@ejemplo.com', email_verified: true },
    { repo }
  );

  assert.equal(usuario.id, id);
  assert.equal(nuevo, false);
  assert.equal(repo._estado.identidades.length, 1);
  /* Y la cuenta queda confirmada: Google acaba de demostrar que ese correo es
     suyo. */
  assert.equal(usuario.emailConfirmado, true);
});

test('sin email_verified NO se enlaza a una cuenta existente', async () => {
  /* Es la comprobación que separa «entrar con Google» de «quedarse con la
     cuenta de otro»: quien consiga un perfil con el correo ajeno sin verificar
     no debe heredar nada. */
  const id = uuid();
  const repo = crearRepoFalso({ usuarios: [{ id, email: 'ana@ejemplo.com' }] });

  const { usuario, nuevo } = await google.resolverUsuario(
    { sub: '7777', email: 'ana@ejemplo.com', email_verified: false },
    { repo }
  );

  assert.notEqual(usuario.id, id);
  assert.equal(nuevo, true);
});

test('un perfil desconocido crea cuenta, ya confirmada y sin contraseña', async () => {
  const repo = crearRepoFalso();
  const { usuario, nuevo } = await google.resolverUsuario(
    { sub: '5555', email: 'nueva@ejemplo.com', email_verified: true, name: 'Nueva', picture: 'https://x/y.png' },
    { repo }
  );

  assert.equal(nuevo, true);
  assert.equal(usuario.emailConfirmado, true);
  assert.equal(usuario.passwordHash, null);
  /* Los mismos nombres de campo que dejaba Supabase en `user_metadata`: es lo
     que leen las pantallas. */
  assert.equal(usuario.metadata.full_name, 'Nueva');
  assert.equal(usuario.metadata.avatar_url, 'https://x/y.png');
});

test('sin sub no se resuelve nada', async () => {
  const repo = crearRepoFalso();
  await assert.rejects(() => google.resolverUsuario({ email: 'x@y.com', email_verified: true }, { repo }));
});

test('dos vueltas seguidas del mismo Google no duplican la identidad', async () => {
  const repo = crearRepoFalso();
  const perfil = { sub: '4321', email: 'dos@ejemplo.com', email_verified: true };

  const a = await google.resolverUsuario(perfil, { repo });
  const b = await google.resolverUsuario(perfil, { repo });

  assert.equal(a.usuario.id, b.usuario.id);
  assert.equal(repo._estado.identidades.length, 1);
});

/* ── La vuelta al frontend ─────────────────────────────────────────────── */

test('los tokens vuelven en el fragmento, nunca en la query', () => {
  const url = new URL(google.urlDeVuelta({
    destino: '/inicio',
    sesion : { access_token: 'AAA', refresh_token: 'RRR' },
  }));

  assert.equal(url.origin, 'https://app.ejemplo.com');
  assert.equal(url.pathname, '/inicio');
  /* El fragmento no se manda al servidor: no aparece en los registros de
     acceso ni en el Referer de la página siguiente. La query sí. */
  assert.equal(url.search, '');
  assert.match(url.hash, /access_token=AAA/);
  assert.match(url.hash, /refresh_token=RRR/);
});

test('un destino manipulado no saca al usuario de nuestro dominio', () => {
  const url = new URL(google.urlDeVuelta({
    destino: 'https://malo.com/robar',
    sesion : { access_token: 'AAA', refresh_token: 'RRR' },
  }));
  assert.equal(url.origin, 'https://app.ejemplo.com');
});

test('el error vuelve a la pantalla de entrada, no a un JSON en blanco', () => {
  const url = new URL(google.urlDeError('fallo_google'));
  assert.equal(url.origin, 'https://app.ejemplo.com');
  assert.equal(url.pathname, '/auth');
  assert.equal(url.searchParams.get('error'), 'fallo_google');
});
