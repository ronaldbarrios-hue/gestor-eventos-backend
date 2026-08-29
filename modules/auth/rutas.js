'use strict';

/* modules/auth/rutas.js — la capa más fina posible.
 *
 * Cada ruta hace tres cosas: sacar los datos de la petición, llamar al
 * servicio, y traducir el resultado a una respuesta. Ninguna decide nada. Si
 * aquí aparece un `if` sobre reglas de negocio, está en el sitio equivocado:
 * este archivo es el único que sabe que existe HTTP, y el día que algo de esto
 * se llame desde una cola o desde un socket, el servicio ya sirve tal cual.
 *
 * ── El freno ──────────────────────────────────────────────────────────────
 *
 * `authLimiter` se enchufa a login, registro y recuperación, que son las tres
 * puertas que se atacan por repetición. Estaba escrito en `config/security.js`
 * desde hace meses con un comentario que decía que se dejaba «por si se agregan
 * endpoints propios /auth». Son estos.
 *
 * Frena por IP; el freno por cuenta lo lleva el servicio con `intentos_fallidos`.
 * Hacen falta los dos: el de IP corta la inundación desde una máquina, el de
 * cuenta corta al que prueba una contraseña por IP desde mil sitios.
 */

const express = require('express');
const { authLimiter } = require('../../config/security.js');
const google = require('./google.js');

/* Traduce `{ error, codigo, status }` a una respuesta, o manda el resultado.
   Está aquí y no en cada ruta para que ninguna se deje el `status` y conteste
   200 con un error dentro, que es el fallo que hace que el frontend enseñe una
   pantalla vacía en vez de un mensaje. */
function responder(res, resultado, exito = 200) {
  if (resultado?.error) {
    return res.status(resultado.status || 400).json({ error: resultado.error, codigo: resultado.codigo });
  }
  return res.status(exito).json(resultado);
}

/* La IP real detrás del proxy. `app.set('trust proxy', 1)` ya está puesto en
   `applySecurity`, así que `req.ip` es la del cliente y no la del proxy. */
const datosDePeticion = (req) => ({
  userAgent: req.headers['user-agent'] || null,
  ip       : req.ip || null,
});

function crearRutas({ servicio, exigirSesion }) {
  const r = express.Router();

  /* ── Entrar y salir ─────────────────────────────────────────────────── */

  r.post('/login', authLimiter, async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      const resultado = await servicio.login({ email, password, ...datosDePeticion(req) });
      if (resultado.error) return responder(res, resultado);
      return res.json(resultado.sesion);
    } catch (e) { next(e); }
  });

  r.post('/registro', authLimiter, async (req, res, next) => {
    try {
      const { email, password, metadata } = req.body || {};
      return responder(res, await servicio.registro({ email, password, metadata }), 201);
    } catch (e) { next(e); }
  });

  r.post('/logout', async (req, res, next) => {
    try {
      return responder(res, await servicio.logout({ refresh_token: req.body?.refresh_token }));
    } catch (e) { next(e); }
  });

  /* Sin limitador: es la petición que hace la app sola cada media hora, y un
     límite por IP cortaría a todo un recinto detrás del mismo wifi. Lo que
     protege esto es la rotación: un refresco sólo sirve una vez. */
  r.post('/refresh', async (req, res, next) => {
    try {
      const resultado = await servicio.refrescar({ refresh_token: req.body?.refresh_token, ...datosDePeticion(req) });
      if (resultado.error) return responder(res, resultado);
      return res.json(resultado.sesion);
    } catch (e) { next(e); }
  });

  r.post('/sesiones/cerrar-todas', exigirSesion, async (req, res, next) => {
    try {
      return responder(res, await servicio.cerrarTodas(req.user.id));
    } catch (e) { next(e); }
  });

  r.get('/sesiones', exigirSesion, async (req, res, next) => {
    try {
      return responder(res, await servicio.sesionesDe(req.user.id));
    } catch (e) { next(e); }
  });

  /* ── Correo ─────────────────────────────────────────────────────────── */

  r.post('/confirmar', async (req, res, next) => {
    try {
      return responder(res, await servicio.confirmar({ token: req.body?.token }));
    } catch (e) { next(e); }
  });

  r.post('/reenviar-confirmacion', authLimiter, async (req, res, next) => {
    try {
      return responder(res, await servicio.reenviarConfirmacion({ email: req.body?.email }));
    } catch (e) { next(e); }
  });

  /* ── Contraseña ─────────────────────────────────────────────────────── */

  r.post('/recuperar', authLimiter, async (req, res, next) => {
    try {
      return responder(res, await servicio.recuperar({ email: req.body?.email }));
    } catch (e) { next(e); }
  });

  r.post('/restablecer', authLimiter, async (req, res, next) => {
    try {
      const { token, password } = req.body || {};
      return responder(res, await servicio.restablecer({ token, password }));
    } catch (e) { next(e); }
  });

  r.patch('/password', exigirSesion, async (req, res, next) => {
    try {
      const { password_actual, password_nueva } = req.body || {};
      return responder(res, await servicio.cambiarPassword({
        usuarioId: req.user.id, password_actual, password_nueva,
      }));
    } catch (e) { next(e); }
  });

  /* ── Perfil ─────────────────────────────────────────────────────────── */

  r.patch('/perfil', exigirSesion, async (req, res, next) => {
    try {
      return responder(res, await servicio.actualizarPerfil({
        usuarioId: req.user.id, metadata: req.body?.metadata,
      }));
    } catch (e) { next(e); }
  });

  r.get('/yo', exigirSesion, async (req, res, next) => {
    try {
      return responder(res, await servicio.yo(req.user.id));
    } catch (e) { next(e); }
  });

  /* ── Google ─────────────────────────────────────────────────────────── */

  /* Devuelve la URL en vez de redirigir. Lo pide así el frontend: la llamada
     sale de `fetch`, y un 302 desde ahí lo seguiría el propio fetch en vez del
     navegador — la pantalla de Google acabaría dentro de una respuesta JSON. */
  r.get('/google', (req, res) => {
    if (!google.configurado()) {
      return res.status(503).json({ error: 'Entrar con Google no está configurado en este servidor.', codigo: 'google_apagado' });
    }
    return res.json({ url: google.urlDeConsentimiento({ destino: req.query.destino }) });
  });

  r.get('/google/callback', async (req, res, next) => {
    try {
      const { code, state, error } = req.query || {};

      /* El usuario pulsó «cancelar» en la pantalla de Google. No es un fallo:
         se le devuelve a la pantalla de entrada sin ruido. */
      if (error) return res.redirect(google.urlDeError('cancelado'));
      if (!code) return res.redirect(google.urlDeError('sin_codigo'));

      const estado = google.verificarEstado(state);
      if (!estado) return res.redirect(google.urlDeError('estado_invalido'));

      const tokensGoogle = await google.intercambiarCodigo(code);
      const perfil = await google.perfilDeGoogle(tokensGoogle.access_token);

      const { usuario } = await google.resolverUsuario(perfil, { repo: servicio._repo });
      const sesion = await servicio._abrirSesion(usuario, datosDePeticion(req));

      return res.redirect(google.urlDeVuelta({ destino: estado.d, sesion }));
    } catch (e) {
      /* Un fallo aquí deja a la persona mirando una página en blanco a mitad de
         un login. Se registra entero para poder mirarlo, y se la devuelve a la
         pantalla de entrada con un motivo genérico: el detalle del error de
         Google no le dice nada y a veces lleva datos de la cuenta. */
      console.error('[auth/google] fallo en el callback:', e?.message || e);
      return res.redirect(google.urlDeError('fallo_google'));
    }
  });

  return r;
}

module.exports = { crearRutas, _responder: responder };
