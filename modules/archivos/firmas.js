'use strict';

/* modules/archivos/firmas.js — enlaces que caducan, para lo privado.
 *
 * ── Qué problema resuelve ─────────────────────────────────────────────────
 *
 * Las hojas de vida están hoy en un bucket público. El comentario del código
 * dice que se quitó la política de lectura «para que nadie pudiera listar las
 * fotos de otros invitados», y es verdad a medias: no se pueden **listar**,
 * pero cada archivo **se lee** por su URL, porque el bucket es público y eso no
 * pasa por RLS. Con rutas del tipo `<uid>/cv-<timestamp>.pdf`, el uid se conoce
 * y la marca de tiempo se acota probando. Son datos personales de gente que
 * buscaba trabajo.
 *
 * Un enlace firmado arregla las dos mitades: la ruta ya no es adivinable
 * (`almacen.nuevaRuta` le mete seis bytes al azar) y, aunque se filtre, deja de
 * valer en quince minutos.
 *
 * ── Por qué no es un JWT ──────────────────────────────────────────────────
 *
 * Un JWT aquí sobra: no hay nada que transportar más allá de la ruta y la hora,
 * y su cabecera y su base64 harían la URL el doble de larga en un enlace que se
 * pega en un correo. Un HMAC sobre `ruta.caducidad` hace lo mismo con 64
 * caracteres.
 */

const crypto = require('crypto');
const config = require('../../core/config');

const VIDA_POR_DEFECTO_S = 15 * 60;

function firmar(ruta, expira) {
  return crypto.createHmac('sha256', config.JWT_SECRET)
    .update(`${ruta}.${expira}`)
    .digest('hex');
}

/* Devuelve `{ ruta, expira, firma }`. Quien llama arma la URL, porque el host
   depende de la petición y este archivo no sabe de HTTP. */
function firmarRuta(ruta, { vidaSegundos = VIDA_POR_DEFECTO_S, ahora = Date.now } = {}) {
  const expira = Math.floor(ahora() / 1000) + vidaSegundos;
  return { ruta, expira, firma: firmar(ruta, expira) };
}

/* Comprueba la firma y la hora. Devuelve true/false y nunca lanza: le llegan
   valores de la barra de direcciones de cualquiera.
 *
 * La comparación es en tiempo constante. Con `===`, el tiempo que tarda en
 * fallar dice cuántos caracteres se acertaron, y una firma se puede reconstruir
 * carácter a carácter con suficientes intentos. */
function comprobar({ ruta, expira, firma }, { ahora = Date.now } = {}) {
  const exp = Number(expira);
  if (!ruta || !firma || !Number.isFinite(exp)) return false;
  if (exp * 1000 < ahora()) return false;

  const esperada = Buffer.from(firmar(ruta, exp));
  const recibida = Buffer.from(String(firma));
  if (esperada.length !== recibida.length) return false;
  return crypto.timingSafeEqual(esperada, recibida);
}

module.exports = { firmarRuta, comprobar, VIDA_POR_DEFECTO_S, _firmar: firmar };
