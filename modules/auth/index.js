'use strict';

/* modules/auth/index.js — la única puerta del módulo.
 *
 * Nadie de fuera importa `servicio.js`, `repositorio.js` ni `tokens.js`. Se
 * importa esto y ya. La regla parece burocracia hasta el día que hay que sacar
 * el módulo a otro proceso: si nadie ha entrado por la ventana, se mueve la
 * carpeta y se cambia una línea.
 *
 * Lo que se exporta:
 *
 *   rutas          el Router de Express, para montar en `/auth`
 *   exigirSesion   middleware: 401 si no hay token válido
 *   sesionOpcional middleware: deja `req.user = null` y sigue
 *   verificar      verificación local de un token, para middleware/auth.js
 *   servicio       para los scripts y las pruebas de integración
 */

const tokens = require('./tokens.js');
const repositorio = require('./repositorio.js');
const { crearServicio } = require('./servicio.js');
const { crearRutas } = require('./rutas.js');

const servicio = crearServicio({ repo: repositorio });

/* Verificación local: ni una consulta, ni un viaje de red.
 *
 * Es el cambio de §5.4 y el que más rinde de todo el módulo. Hoy
 * `middleware/auth.js` llama a `supabase.auth.getUser(token)` en CADA petición,
 * o sea un viaje a Supabase por cada petición que hace la aplicación. Con las
 * pantallas sondeando cada pocos segundos, eso son miles de viajes al día que
 * aquí no existen: verificar una firma HMAC son microsegundos de CPU.
 *
 * El precio, que hay que saber: un token robado sigue valiendo hasta que
 * caduca, porque nadie pregunta a la base si sigue siendo bueno. Por eso el
 * acceso dura 30 minutos y no una hora larga, y por eso lo que se revoca de
 * verdad es el refresco.
 */
function usuarioDeLaPeticion(req) {
  const cabecera = req.headers['authorization'] || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  if (!token) return null;

  const carga = tokens.verificarAcceso(token);
  if (!carga) return null;

  /* La misma forma que dejaba Supabase: los 297 usos de `req.user.id` y los 9
     de `req.user.email` que hay repartidos por las 38 rutas siguen valiendo sin
     tocar ni uno. `user_metadata` va vacío a propósito — el único sitio que lo
     usaba ya se cambió, y meterlo en el token lo dejaría obsoleto en cuanto
     alguien edite su perfil. */
  return { id: carga.sub, email: carga.email, user_metadata: {}, _propio: true };
}

function exigirSesion(req, res, next) {
  const usuario = usuarioDeLaPeticion(req);
  if (!usuario) return res.status(401).json({ error: 'Token inválido o expirado.' });
  req.user = usuario;
  next();
}

function sesionOpcional(req, _res, next) {
  req.user = usuarioDeLaPeticion(req);
  next();
}

const rutas = crearRutas({ servicio, exigirSesion });

module.exports = {
  rutas,
  exigirSesion,
  sesionOpcional,
  verificar: usuarioDeLaPeticion,
  servicio,
};
