'use strict';

/* modules/auth/google.js — «entrar con Google», sin Supabase en medio.
 *
 * El flujo OAuth de Google ya estaba escrito en `lib/googleCalendar.js` para
 * agendar entrevistas: pedir consentimiento, firmar un estado, canjear el
 * código. Lo que cambia aquí es el `scope` (identidad en vez de calendario) y
 * qué se hace al volver (abrir sesión en vez de guardar un refresco de
 * calendario). No se importa aquel archivo porque su `redirect_uri` y su
 * `state` son los suyos, y mezclarlos haría que tocar uno rompiera el otro.
 *
 * ── Lo que NO puede cambiar ───────────────────────────────────────────────
 *
 * El `client_id`. 22 de los 29 usuarios entran por aquí, y Google identifica a
 * cada persona con un `sub` que es distinto para cada `client_id`. Con un
 * cliente nuevo, los 22 `sub` guardados no coinciden con ninguno de los que
 * mande Google, y esas 22 personas entrarían a cuentas nuevas y vacías con sus
 * eventos dentro de las viejas. Hay que reutilizar el cliente que usa Supabase
 * hoy y añadirle nuestra `redirect_uri` en la consola. Es una pantalla, pero si
 * se descubre tarde afecta a tres de cada cuatro usuarios.
 *
 * ── El estado ─────────────────────────────────────────────────────────────
 *
 * `state` lleva a dónde volver y va firmado. Sin firma, cualquiera puede
 * fabricar un enlace de consentimiento que, al terminar, mande al usuario —ya
 * con su sesión abierta— a un dominio ajeno con los tokens en la URL. Además
 * caduca a los diez minutos: es el tiempo de decidir en una pantalla de Google,
 * no el de guardar un enlace para mañana.
 */

const crypto = require('crypto');
const config = require('../../core/config');

const SCOPE = 'openid email profile';
const VIDA_ESTADO_S = 600;

function configurado() {
  return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_AUTH_REDIRECT);
}

/* ── Estado firmado ────────────────────────────────────────────────────── */

function firmar(carga) {
  const cuerpo = Buffer.from(JSON.stringify(carga)).toString('base64url');
  const firma = crypto.createHmac('sha256', config.JWT_SECRET).update(cuerpo).digest('base64url');
  return `${cuerpo}.${firma}`;
}

function verificarEstado(state) {
  const [cuerpo, firma] = String(state || '').split('.');
  if (!cuerpo || !firma) return null;

  const esperada = crypto.createHmac('sha256', config.JWT_SECRET).update(cuerpo).digest('base64url');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  /* `timingSafeEqual` revienta si miden distinto, así que la longitud se
     comprueba antes. Comparar con `===` filtraría por tiempo cuántos caracteres
     acertó quien lo intenta. */
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let carga;
  try { carga = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')); } catch { return null; }
  if (!carga?.t || Date.now() - carga.t > VIDA_ESTADO_S * 1000) return null;
  return carga;
}

/* A dónde volver después. Sólo se admite una ruta de nuestra propia app: si se
   aceptara una URL completa, esto sería un redirector abierto con la sesión
   recién abierta encima. */
function destinoSeguro(destino) {
  const d = String(destino || '/inicio');
  return /^\/[A-Za-z0-9\-._~/?%&=+:@!$'()*,;[\]]*$/.test(d) && !d.startsWith('//') ? d : '/inicio';
}

function urlDeConsentimiento({ destino } = {}) {
  const p = new URLSearchParams({
    client_id    : config.GOOGLE_CLIENT_ID,
    redirect_uri : config.GOOGLE_AUTH_REDIRECT,
    response_type: 'code',
    scope        : SCOPE,
    /* `select_account` para que quien tiene dos cuentas de Google pueda elegir.
       Sin esto, Google entra con la última y el usuario no entiende por qué ve
       los eventos de otro. */
    prompt       : 'select_account',
    state        : firmar({ d: destinoSeguro(destino), t: Date.now(), n: crypto.randomBytes(8).toString('hex') }),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

/* ── Vuelta ────────────────────────────────────────────────────────────── */

async function intercambiarCodigo(code, { fetchImpl = fetch } = {}) {
  const body = new URLSearchParams({
    code,
    client_id    : config.GOOGLE_CLIENT_ID,
    client_secret: config.GOOGLE_CLIENT_SECRET,
    redirect_uri : config.GOOGLE_AUTH_REDIRECT,
    grant_type   : 'authorization_code',
  });
  const r = await fetchImpl('https://oauth2.googleapis.com/token', {
    method : 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const datos = await r.json();
  if (!r.ok) throw new Error(`Google token ${r.status}: ${JSON.stringify(datos).slice(0, 200)}`);
  return datos;
}

async function perfilDeGoogle(accessToken, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const datos = await r.json();
  if (!r.ok) throw new Error(`Google userinfo ${r.status}`);
  return datos; // { sub, email, email_verified, name, picture }
}

/* Resuelve la cuenta a la que corresponde ese perfil de Google. Tres casos, y
 * el orden importa:
 *
 *   1. Ya hay identidad guardada con ese `sub` → esa cuenta. Siempre primero:
 *      es la única forma estable de identificar a alguien aunque cambie de
 *      correo en Google.
 *   2. No hay identidad, pero el correo ya tiene cuenta → se enlaza. Es el
 *      camino de los 22 que hoy entran por Supabase si su identidad no se
 *      hubiera migrado, y el de quien se registró con contraseña y ahora pulsa
 *      el botón de Google.
 *   3. Ni identidad ni correo → cuenta nueva, ya confirmada (Google acaba de
 *      demostrar que esa dirección es suya).
 *
 * El caso 2 sólo vale si Google dice `email_verified`. Sin esa comprobación,
 * quien consiga que Google le emita un perfil con el correo de otra persona sin
 * verificar se lleva su cuenta entera.
 */
async function resolverUsuario(perfil, { repo }) {
  const sub = String(perfil.sub || '');
  if (!sub) throw new Error('Google no devolvió el identificador de la cuenta.');

  const porSub = await repo.porIdentidad('google', sub);
  if (porSub) return { usuario: porSub, nuevo: false };

  const correo = repo.normalizar(perfil.email);
  if (correo && perfil.email_verified) {
    const existente = await repo.porEmail(correo);
    if (existente) {
      await repo.enlazarIdentidad({ usuarioId: existente.id, proveedor: 'google', proveedorId: sub, email: correo });
      /* Si llega por Google con el correo verificado y su cuenta estaba sin
         confirmar, queda confirmada: el correo ya está probado. */
      if (!existente.emailConfirmado) await repo.marcarConfirmado(existente.id);
      return { usuario: await repo.porId(existente.id), nuevo: false };
    }
  }

  if (!correo) throw new Error('Google no devolvió un correo para esa cuenta.');

  const usuario = await repo.crear({
    id      : crypto.randomUUID(),
    email   : correo,
    passwordHash: null,
    metadata: {
      /* Los mismos nombres de campo que dejaba Supabase en `user_metadata`, que
         es lo que leen las pantallas del frontend. */
      full_name : perfil.name || '',
      avatar_url: perfil.picture || '',
    },
    emailConfirmado: true,
  });
  await repo.enlazarIdentidad({ usuarioId: usuario.id, proveedor: 'google', proveedorId: sub, email: correo });
  return { usuario, nuevo: true };
}

/* La URL a la que se manda al navegador cuando ya hay sesión.
 *
 * Los tokens van en el fragmento (`#`), no en la query. El fragmento no se
 * manda al servidor: no aparece en los registros de acceso ni en la cabecera
 * `Referer` de la página siguiente. El frontend lo lee con
 * `recogerSesionDeUrl()` y lo borra de la barra de direcciones. */
function urlDeVuelta({ destino, sesion }) {
  const base = (config.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '') || 'http://localhost:5173';
  const frag = new URLSearchParams({
    access_token : sesion.access_token,
    refresh_token: sesion.refresh_token,
  });
  return `${base}${destinoSeguro(destino)}#${frag.toString()}`;
}

/* Cuando algo falla se vuelve al frontend con el motivo en la query, no con un
   JSON en blanco: quien está mirando es una persona a mitad de un login, y una
   pantalla de la aplicación explicándolo es mejor que un error crudo. */
function urlDeError(motivo) {
  const base = (config.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '') || 'http://localhost:5173';
  return `${base}/auth?error=${encodeURIComponent(motivo)}`;
}

module.exports = {
  configurado,
  urlDeConsentimiento,
  verificarEstado,
  intercambiarCodigo,
  perfilDeGoogle,
  resolverUsuario,
  urlDeVuelta,
  urlDeError,
  SCOPE,
  _firmar: firmar,
  _destinoSeguro: destinoSeguro,
};
