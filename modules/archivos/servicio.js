'use strict';

/* modules/archivos/servicio.js — las decisiones: qué se acepta, qué se borra y
 * cuánto puede ocupar cada uno. Ni disco ni SQL ni HTTP: eso son `almacen.js`,
 * `repositorio.js` y `rutas.js`.
 *
 * ── Los cuatro problemas que esto arregla ─────────────────────────────────
 *
 * Están medidos en SUPABASE.md §3.4 y ninguno se podía arreglar mientras el
 * navegador subiera directo a Supabase, porque no había dónde poner la
 * comprobación. Al pasar la subida por aquí, los cuatro caen solos:
 *
 *   a) **40 huérfanos, 28 MB.** Subir uno nuevo borra el anterior de la misma
 *      carpeta. Es lo que explica el salto de 24 a 80 MB: no es que se suba
 *      más, es que no se borraba nunca.
 *   b) **Subida anónima abierta.** `form-uploads` aceptaba escritura de
 *      cualquiera con la llave anónima, que va en el bundle. Aquí cada carpeta
 *      dice si exige sesión.
 *   c) **Hojas de vida en bucket público.** Carpeta nueva y privada, servida
 *      con enlace firmado.
 *   d) **La subida de CV no podía funcionar.** El código mandaba PDF de 8 MB a
 *      un bucket que sólo admitía imágenes de 4 MB, así que nunca se subió uno.
 *      Aquí los límites y los tipos están en el mismo sitio que la validación.
 */

const tipos = require('./tipos.js');
const almacenReal = require('./almacen.js');
const repositorioReal = require('./repositorio.js');
const config = require('../../core/config');

const err = (mensaje, codigo, status = 400) => ({ error: mensaje, codigo, status });

/* Dónde el archivo nuevo sustituye al anterior. `event-media` no está: un
   evento tiene galería, y ahí cada imagen es una más. */
const UNA_SOLA_POR_USUARIO = ['avatars', 'hojas-de-vida'];

function crearServicio({ almacen = almacenReal, repo = repositorioReal } = {}) {

  /* Sube un archivo. `contenido` es un Buffer: los límites de tamaño son de
     pocos MB y leerlo entero en memoria es más simple y más seguro que
     escribir mientras se recibe —así, si el archivo se pasa de tamaño o no es
     lo que dice ser, no llegó a tocar el disco. */
  async function subir({ contenido, carpeta, nombreOriginal, usuarioId, eventoId, reemplazar = true }) {
    if (!tipos.carpetaValida(carpeta)) return err('Esa carpeta no existe.', 'carpeta_invalida', 404);
    const reglas = tipos.reglasDe(carpeta);

    if (reglas.exigeSesion && !usuarioId) {
      return err('Hay que entrar para subir esto.', 'sin_sesion', 401);
    }

    if (!Buffer.isBuffer(contenido) || contenido.length === 0) {
      return err('No llegó ningún archivo.', 'vacio');
    }

    if (contenido.length > reglas.maxBytes) {
      const mb = Math.round(reglas.maxBytes / (1024 * 1024));
      return err(`El archivo pasa de ${mb} MB.`, 'demasiado_grande', 413);
    }

    /* El tipo real, deducido de los primeros bytes. Nunca el que declaró el
       cliente: eso lo escribe quien sube. */
    const mime = tipos.detectar(contenido);
    if (!mime || !reglas.mimes.includes(mime)) {
      return err(
        `Ese tipo de archivo no se admite aquí. Se aceptan: ${reglas.mimes.join(', ')}.`,
        'tipo_no_admitido', 415
      );
    }

    /* La cuota. Sin ella, una cuenta puede llenar el disco de la máquina —que
       en el hosting de destino son 9,81 GB compartidos con todo lo demás— y
       tirar abajo la aplicación entera para todos. */
    if (usuarioId) {
      const usados = await repo.bytesDe(usuarioId);
      if (usados + contenido.length > config.ARCHIVOS_CUOTA_BYTES) {
        return err(
          'Te quedaste sin espacio. Borrá algún archivo antes de subir otro.',
          'sin_cuota', 413
        );
      }
    }

    const ruta = almacen.nuevaRuta({
      carpeta,
      propietario: usuarioId || eventoId,
      prefijo    : carpeta === 'avatars' ? 'avatar' : 'archivo',
      extension  : tipos.extensionDe(mime, nombreOriginal),
    });

    await almacen.guardar(ruta, contenido);

    let ficha;
    try {
      ficha = await repo.registrar({
        ruta, carpeta, usuarioId, eventoId,
        nombreOriginal, tipoMime: mime,
        bytes  : contenido.length,
        publico: reglas.publico,
      });
    } catch (e) {
      /* Si la ficha no se pudo escribir, el archivo del disco no lo referencia
         nadie: es un huérfano recién nacido. Se borra aquí mismo, que es
         exactamente lo que no se hacía antes. */
      await almacen.borrar(ruta).catch(() => {});
      throw e;
    }

    /* El reemplazo: una foto de perfil es una, no un historial. Se hace después
       de que el nuevo esté guardado y registrado, para que un fallo a mitad
       deje dos archivos (recuperable) y nunca cero (una pantalla sin foto). */
    let reemplazados = 0;
    if (reemplazar && usuarioId && UNA_SOLA_POR_USUARIO.includes(carpeta)) {
      const anteriores = await repo.anterioresDe({ usuarioId, carpeta, exceptoId: ficha.id });
      for (const viejo of anteriores) {
        if (await repo.marcarBorrado(viejo.id)) reemplazados += 1;
      }
    }

    return { ok: true, archivo: publico(ficha), reemplazados };
  }

  /* Borrar es marcar. Los bytes se los lleva el barrido un día después, por si
     el borrado fue un error. */
  async function borrar({ id, usuarioId }) {
    const ficha = await repo.porId(id);
    if (!ficha || ficha.borradoAt) return err('Ese archivo no existe.', 'no_existe', 404);

    /* El dueño, y nadie más. Es la comprobación que hoy hace RLS y que, cuando
       RLS desaparezca, tiene que estar escrita en sitios como éste. */
    if (!usuarioId || ficha.usuarioId !== usuarioId) {
      return err('Ese archivo no es tuyo.', 'ajeno', 403);
    }

    await repo.marcarBorrado(id);
    return { ok: true };
  }

  /* Lo que se puede enseñar de una ficha. La ruta absoluta del disco no sale de
     aquí ni por error: dice dónde vive el archivo en la máquina. */
  function publico(ficha) {
    return {
      id      : ficha.id,
      ruta    : ficha.ruta,
      url     : ficha.publico ? `${config.ARCHIVOS_URL_BASE}/${ficha.ruta}` : null,
      carpeta : ficha.carpeta,
      nombre  : ficha.nombreOriginal,
      tipo    : ficha.tipoMime,
      bytes   : ficha.bytes,
      publico : ficha.publico,
      creadoAt: ficha.creadoAt,
    };
  }

  async function listar({ usuarioId, carpeta }) {
    const fichas = await repo.deUsuario(usuarioId, carpeta);
    return { ok: true, archivos: fichas.map(publico), bytesUsados: await repo.bytesDe(usuarioId) };
  }

  /* El barrido, para el cron. Lo que se lleva son bytes de fichas marcadas hace
     más de un día — nunca adivina: si no hay ficha, no lo toca. */
  async function barrer({ dias = 1 } = {}) {
    const pendientes = await repo.borradosPendientes({ dias });
    let bytes = 0;
    let borrados = 0;
    for (const ficha of pendientes) {
      await almacen.borrar(ficha.ruta).catch(() => {});
      await repo.olvidar(ficha.id);
      bytes += ficha.bytes;
      borrados += 1;
    }
    return { ok: true, borrados, bytes };
  }

  return { subir, borrar, listar, barrer, _publico: publico };
}

module.exports = { crearServicio };
