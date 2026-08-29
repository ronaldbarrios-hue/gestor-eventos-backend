'use strict';

/* modules/archivos/rutas.js — la puerta HTTP del almacén.
 *
 * ── Por qué el cuerpo es el archivo, y no un formulario ───────────────────
 *
 * Lo normal sería `multipart/form-data`, y Express no lo parsea solo: haría
 * falta una librería más. Aquí el cuerpo de la petición **es** el archivo, y el
 * nombre viaja en la query:
 *
 *     PUT /archivos/avatars?nombre=foto.jpg
 *     Content-Type: image/jpeg
 *     <los bytes>
 *
 * Desde el navegador es una línea (`fetch(url, { method:'PUT', body: file })`),
 * no arrastra dependencia, y el límite de tamaño se aplica antes de leer nada.
 * El `Content-Type` que llega se ignora a propósito: el tipo se deduce de los
 * primeros bytes, porque la cabecera la escribe quien sube.
 */

const express = require('express');
const { authLimiter } = require('../../config/security.js');
const tipos = require('./tipos.js');
const firmas = require('./firmas.js');
const almacen = require('./almacen.js');
const config = require('../../core/config');

function responder(res, resultado, exito = 200) {
  if (resultado?.error) {
    return res.status(resultado.status || 400).json({ error: resultado.error, codigo: resultado.codigo });
  }
  return res.status(exito).json(resultado);
}

/* El tope más grande de todas las carpetas. Es el límite del parser; el de cada
   carpeta lo aplica el servicio después, con su mensaje. Sin este de aquí, una
   petición de 2 GB se leería entera en memoria antes de que nadie la rechace. */
const TOPE_ABSOLUTO = Math.max(...Object.values(tipos.CARPETAS).map(c => c.maxBytes));

function crearRutas({ servicio, sesionOpcional, exigirSesion, repo }) {
  const r = express.Router();

  /* `express.raw` aceptando cualquier tipo: el cuerpo llega como Buffer sea
     cual sea la cabecera. Va sólo en estas rutas, no en toda la aplicación,
     para no tocar cómo recibe el JSON el resto. */
  const cuerpoCrudo = express.raw({ type: () => true, limit: TOPE_ABSOLUTO });

  r.put('/:carpeta', authLimiter, sesionOpcional, cuerpoCrudo, async (req, res, next) => {
    try {
      return responder(res, await servicio.subir({
        contenido     : req.body,
        carpeta       : req.params.carpeta,
        nombreOriginal: req.query.nombre,
        usuarioId     : req.user?.id || null,
        eventoId      : req.query.evento || null,
      }), 201);
    } catch (e) { next(e); }
  });

  r.get('/mios', exigirSesion, async (req, res, next) => {
    try {
      return responder(res, await servicio.listar({ usuarioId: req.user.id, carpeta: req.query.carpeta }));
    } catch (e) { next(e); }
  });

  r.delete('/:id', exigirSesion, async (req, res, next) => {
    try {
      return responder(res, await servicio.borrar({ id: Number(req.params.id), usuarioId: req.user.id }));
    } catch (e) { next(e); }
  });

  /* ── Lo privado ─────────────────────────────────────────────────────── */

  /* Pide un enlace con caducidad para un archivo privado. Sólo el dueño.
     Quince minutos: lo que se tarda en abrir un CV desde el panel, no lo que
     dura un enlace olvidado en un chat. */
  r.post('/:id/enlace', exigirSesion, async (req, res, next) => {
    try {
      const ficha = await repo.porId(Number(req.params.id));
      if (!ficha || ficha.borradoAt) return res.status(404).json({ error: 'Ese archivo no existe.' });
      if (ficha.usuarioId !== req.user.id) return res.status(403).json({ error: 'Ese archivo no es tuyo.' });

      const { expira, firma } = firmas.firmarRuta(ficha.ruta);
      const p = new URLSearchParams({ ruta: ficha.ruta, expira: String(expira), firma });
      return res.json({ url: `${config.ARCHIVOS_URL_BASE}/privado?${p.toString()}`, expira });
    } catch (e) { next(e); }
  });

  /* Sirve un privado. No mira la sesión: mira la firma. Así el enlace se puede
     abrir desde el cliente de correo o pegarlo en otra pestaña, que es lo que
     la gente hace, sin que eso signifique que cualquiera pueda entrar. */
  r.get('/privado', async (req, res, next) => {
    try {
      const { ruta, expira, firma } = req.query;
      if (!firmas.comprobar({ ruta, expira, firma })) {
        return res.status(403).json({ error: 'El enlace no vale o ya caducó.' });
      }

      const ficha = await repo.porRuta(String(ruta));
      if (!ficha || ficha.borradoAt) return res.status(404).json({ error: 'Ese archivo no existe.' });

      res.setHeader('Content-Type', ficha.tipoMime);
      /* `attachment` para que un PDF se descargue en vez de abrirse dentro de
         la página, y `nosniff` para que el navegador no reinterprete el tipo.
         El nombre entre comillas y sin comillas dentro: si no, un nombre con
         comillas parte la cabecera. */
      const nombre = String(ficha.nombreOriginal || 'archivo').replace(/["\r\n]/g, '');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      /* Un privado no se guarda en ninguna caché intermedia. */
      res.setHeader('Cache-Control', 'private, no-store');

      /* Con Nginx delante, los bytes no pasan por Node: se le dice qué servir y
         él lo hace. Una descarga de 8 MB atendida desde el proceso bloquea el
         bucle de eventos y frena a todos los demás. Sin Nginx —en desarrollo—
         se manda desde aquí. */
      if (config.ARCHIVOS_X_ACCEL) {
        res.setHeader('X-Accel-Redirect', `${config.ARCHIVOS_X_ACCEL}/${ficha.ruta}`);
        return res.end();
      }

      return almacen.flujoDeLectura(ficha.ruta).on('error', next).pipe(res);
    } catch (e) { next(e); }
  });

  return r;
}

module.exports = { crearRutas, TOPE_ABSOLUTO };
