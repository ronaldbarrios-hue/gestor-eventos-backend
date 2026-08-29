'use strict';

/* modules/auth/tokens.js — emitir y verificar. Nada más.
 *
 * Este archivo no toca la base ni sabe qué es una petición HTTP: entra un
 * usuario, sale un token; entra un token, sale lo que lleva dentro o null. Por
 * eso se puede probar entero sin montar nada, y por eso las pruebas de firma
 * son las únicas de todo el módulo que no necesitan un repositorio falso.
 *
 * ── Dos clases de token, y no se parecen ──────────────────────────────────
 *
 * El de ACCESO es un JWT firmado. Vale 30 minutos, viaja en cada petición y NO
 * se consulta contra la base: verificar la firma es una operación local de
 * microsegundos. Ese es todo el punto de §5.4 — hoy `middleware/auth.js` llama
 * a `supabase.auth.getUser(token)` en cada petición, o sea un viaje de red por
 * petición, y con el sondeo de las pantallas eso son miles de viajes al día que
 * desaparecen.
 *
 * El de REFRESCO es un número aleatorio, no un JWT. No lleva nada dentro, sólo
 * existe como fila en `sesiones`. Es la diferencia que permite revocarlo: un
 * JWT vale hasta que caduca aunque el servidor quiera lo contrario.
 *
 * ── Lo que va dentro del JWT ──────────────────────────────────────────────
 *
 * `sub` (el UUID) y `email`, porque el código de las 38 rutas lee `req.user.id`
 * en 297 sitios y `req.user.email` en 9. Nada más: cada dato que se mete en el
 * token es un dato que viaja en claro en cada petición y que se queda obsoleto
 * en cuanto cambie en la base. El nombre y el avatar se piden por `/auth/yo`.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../../core/config');

/* El emisor y el destinatario. Un token de otro sistema que casualmente use el
   mismo secreto no vale aquí, y los nuestros no valen en otro sitio. */
const EMISOR = 'gestek';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/* ── Acceso ────────────────────────────────────────────────────────────── */

function emitirAcceso(usuario, { vidaSegundos = config.VIDA_ACCESO_S } = {}) {
  return jwt.sign(
    {
      sub  : usuario.id,
      email: usuario.email,
      /* Marca de quién firmó. Durante la convivencia entran tokens de Supabase
         y tokens nuestros por la misma puerta, y el middleware tiene que poder
         distinguirlos sin probar suerte con las dos verificaciones. */
      tipo : 'acceso',
    },
    config.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: vidaSegundos, issuer: EMISOR, audience: EMISOR }
  );
}

/* Devuelve la carga o null. Nunca lanza: quien llama responde 401 y no le
 * interesa distinguir «firma mala» de «caducado» — decírselo al cliente sólo
 * ayuda a quien está probando.
 *
 * `algorithms` fijado a HS256 a propósito. Sin esa lista, la librería acepta el
 * algoritmo que diga la cabecera del token, y `alg: none` es la vulnerabilidad
 * más antigua de JWT: un token sin firma que se da por bueno.
 */
function verificarAcceso(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const carga = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer    : EMISOR,
      audience  : EMISOR,
    });
    if (carga.tipo !== 'acceso') return null;
    return carga;
  } catch {
    return null;
  }
}

/* ── Refresco ──────────────────────────────────────────────────────────── */

/* 32 bytes de `randomBytes`. No `Math.random()`, que es predecible, ni un UUID
   v4, que gasta 6 bits en la versión. Se devuelve el token en claro (que sólo
   ve el dueño, una vez) y su hash (que es lo único que se guarda). */
function nuevoRefresco() {
  const token = `gtkr_${crypto.randomBytes(32).toString('hex')}`;
  return { token, hash: sha256(token) };
}

/* ── Tokens de correo ──────────────────────────────────────────────────── */

/* Confirmación y recuperación. Van en la URL de un correo, así que se usa
   base64url: sin `+`, `/` ni `=`, que algunos clientes de correo parten o
   escapan y dejan el enlace roto justo para el usuario menos capaz de
   entenderlo. */
function nuevoTokenCorreo() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

module.exports = {
  emitirAcceso,
  verificarAcceso,
  nuevoRefresco,
  nuevoTokenCorreo,
  sha256,
  EMISOR,
};
