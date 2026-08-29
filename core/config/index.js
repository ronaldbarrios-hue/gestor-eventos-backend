'use strict';

/* core/config/index.js — el entorno leído y validado en un solo sitio.
 *
 * Envuelve a `config/env.js`, que es el que ya usan los 38 archivos de rutas, y
 * le añade lo que necesita la identidad propia: MySQL, los secretos de firma y
 * Google. No lo sustituye: mientras convivan Supabase y lo nuestro, los dos
 * tienen que seguir funcionando, y duplicar la lectura del entorno en dos
 * archivos es como se acaba con dos verdades distintas.
 *
 * ── La regla del secreto ──────────────────────────────────────────────────
 *
 * `JWT_SECRET` no tiene valor por defecto en producción. Un secreto de
 * desarrollo que se cuela en producción es indistinguible de no tener firma:
 * cualquiera que lea el repositorio emite tokens de administrador. Por eso, si
 * falta y `AUTH_PROPIA` está encendido, el proceso no arranca.
 *
 * En desarrollo sí se genera uno al vuelo, distinto en cada arranque. Eso hace
 * que reiniciar el servidor cierre las sesiones locales, que es molesto durante
 * medio segundo y evita el fallo caro.
 */

const crypto = require('crypto');
const env = require('../../config/env.js');

const IS_PROD = env.IS_PROD;

/* El interruptor. Mientras esté apagado, nada de esto se monta y el backend se
   comporta exactamente como hoy. Es el mismo interruptor que el frontend lee en
   `src/lib/sesion.js`, y tiene que moverse en los dos a la vez. */
const AUTH_PROPIA = process.env.AUTH_PROPIA === 'true' || process.env.AUTH_PROPIA === '1';

function secretoDeFirma(nombre) {
  const valor = process.env[nombre];
  if (valor) return valor;

  if (IS_PROD && AUTH_PROPIA) {
    console.error(`\n[FATAL] ${nombre} no está configurado y AUTH_PROPIA está encendido.`);
    console.error('[FATAL] Sin secreto propio, los tokens no se pueden firmar. Ver CONFIGURAR.md.\n');
    process.exit(1);
  }
  if (AUTH_PROPIA) {
    console.warn(`[WARN]  ${nombre} no configurado: se usa uno efímero de desarrollo.`);
  }
  return `dev-efimero-${crypto.randomBytes(24).toString('hex')}`;
}

const config = {
  ...env,

  AUTH_PROPIA,

  /* ── MySQL ────────────────────────────────────────────────────────────
     En cPanel el usuario y la base llevan el prefijo de la cuenta
     (`cuenta_gestek`), y es el error de configuración número uno: se pone
     `gestek` a secas y el servidor contesta «Access denied». */
  MYSQL_HOST    : process.env.MYSQL_HOST     || (IS_PROD ? null : '127.0.0.1'),
  MYSQL_PORT    : parseInt(process.env.MYSQL_PORT, 10) || 3306,
  MYSQL_USER    : process.env.MYSQL_USER     || null,
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || '',
  MYSQL_DATABASE: process.env.MYSQL_DATABASE || null,
  MYSQL_SOCKET  : process.env.MYSQL_SOCKET   || null,
  MYSQL_POOL_MAX: parseInt(process.env.MYSQL_POOL_MAX, 10) || 10,

  /* ── Firma de tokens ──────────────────────────────────────────────────
     Ninguno se reutiliza de Supabase: si su secreto se filtrara algún día,
     nuestros tokens seguirían valiendo. Y al revés. */
  JWT_SECRET: secretoDeFirma('JWT_SECRET'),

  /* 30 minutos. Con Supabase el acceso duraba una hora larga y no se podía
     revocar; el refresco sí se revoca, así que la ventana de un token robado
     es esta. Bajarlo más multiplica los refrescos sin ganar mucho. */
  VIDA_ACCESO_S : parseInt(process.env.AUTH_VIDA_ACCESO_S, 10)  || 60 * 30,
  VIDA_REFRESH_S: parseInt(process.env.AUTH_VIDA_REFRESH_S, 10) || 60 * 60 * 24 * 30,

  /* Los enlaces del correo. Cortos a propósito: un enlace de recuperación que
     dura un día sigue sirviendo cuando el correo ya pasó por tres bandejas. */
  VIDA_CONFIRMACION_S : parseInt(process.env.AUTH_VIDA_CONFIRMACION_S, 10)  || 60 * 60 * 24,
  VIDA_RECUPERACION_S : parseInt(process.env.AUTH_VIDA_RECUPERACION_S, 10)  || 60 * 60,

  /* ── Freno por cuenta ─────────────────────────────────────────────────
     `authLimiter` de config/security.js frena por IP, que es lo que corta una
     inundación. No corta al que prueba mil contraseñas de una cuenta desde mil
     IP distintas, que es justo el ataque que importa. Esto cuenta por cuenta. */
  INTENTOS_MAX  : parseInt(process.env.AUTH_INTENTOS_MAX, 10) || 8,
  BLOQUEO_MIN   : parseInt(process.env.AUTH_BLOQUEO_MIN, 10)  || 15,

  /* ── Google ───────────────────────────────────────────────────────────
     El `client_id` TIENE que ser el mismo que usa Supabase hoy, o los 22
     usuarios que entran con Google dejan de entrar aunque sus filas estén
     perfectas. La `redirect_uri` sí cambia: apunta a nuestro backend. */
  GOOGLE_CLIENT_ID    : process.env.GOOGLE_CLIENT_ID     || null,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || null,
  GOOGLE_AUTH_REDIRECT: process.env.GOOGLE_AUTH_REDIRECT || null,
};

/* Aviso al arrancar, no error: el backend tiene que poder correr con la
   identidad propia apagada mientras dure la convivencia. */
if (AUTH_PROPIA) {
  const faltan = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE'].filter(k => !config[k]);
  if (faltan.length) {
    console.warn(`[WARN]  AUTH_PROPIA encendido pero falta ${faltan.join(', ')}. Ver CONFIGURAR.md.`);
  }
  if (!config.GOOGLE_CLIENT_ID) {
    console.warn('[WARN]  AUTH_PROPIA sin GOOGLE_CLIENT_ID: «entrar con Google» quedará apagado.');
  }
}

module.exports = config;
