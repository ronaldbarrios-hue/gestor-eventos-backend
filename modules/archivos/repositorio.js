'use strict';

/* modules/archivos/repositorio.js — la ficha de cada archivo. El único sitio
 * del módulo que escribe SQL, igual que en `auth`.
 */

/* La ficha de un archivo es dato del evento, no identidad: va en `datos`.
   Mientras no haya una segunda base creada, `datos` cae a la de `auth` y esto
   funciona igual. */
const db = require('../../core/db/mysql.js').bd('datos');

function aArchivo(fila) {
  if (!fila) return null;
  return {
    id            : fila.id,
    ruta          : fila.ruta,
    carpeta       : fila.carpeta,
    usuarioId     : fila.usuario_id,
    eventoId      : fila.evento_id,
    nombreOriginal: fila.nombre_original,
    tipoMime      : fila.tipo_mime,
    bytes         : Number(fila.bytes),
    publico       : Boolean(fila.publico),
    creadoAt      : fila.creado_at,
    borradoAt     : fila.borrado_at,
  };
}

async function registrar({ ruta, carpeta, usuarioId, eventoId, nombreOriginal, tipoMime, bytes, publico }) {
  const r = await db.consultar(
    `INSERT INTO archivos (ruta, carpeta, usuario_id, evento_id, nombre_original, tipo_mime, bytes, publico)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [ruta, carpeta, usuarioId || null, eventoId || null,
     (nombreOriginal || '').slice(0, 255) || null, tipoMime, bytes, publico ? 1 : 0]
  );
  return porId(r.insertId);
}

async function porId(id) {
  return aArchivo(await db.unaFila('SELECT * FROM archivos WHERE id = ? LIMIT 1', [id]));
}

async function porRuta(ruta) {
  return aArchivo(await db.unaFila('SELECT * FROM archivos WHERE ruta = ? LIMIT 1', [ruta]));
}

/* Los que hay que borrar cuando alguien sube uno nuevo en la misma carpeta.
 * Es la función que arregla los 40 huérfanos: hoy nadie la tiene, así que cada
 * cambio de foto deja la anterior en el disco para siempre. */
async function anterioresDe({ usuarioId, carpeta, exceptoId }) {
  const filas = await db.consultar(
    `SELECT * FROM archivos
      WHERE usuario_id = ? AND carpeta = ? AND borrado_at IS NULL AND id <> ?`,
    [usuarioId, carpeta, exceptoId || 0]
  );
  return filas.map(aArchivo);
}

async function marcarBorrado(id) {
  const r = await db.consultar(
    'UPDATE archivos SET borrado_at = NOW() WHERE id = ? AND borrado_at IS NULL',
    [id]
  );
  return (r.affectedRows || 0) === 1;
}

/* Lo que lleva gastado una cuenta. Sólo lo vivo: lo borrado no ocupa. */
async function bytesDe(usuarioId) {
  const fila = await db.unaFila(
    'SELECT COALESCE(SUM(bytes), 0) AS total FROM archivos WHERE usuario_id = ? AND borrado_at IS NULL',
    [usuarioId]
  );
  return Number(fila?.total || 0);
}

async function deUsuario(usuarioId, carpeta) {
  const filas = await db.consultar(
    `SELECT * FROM archivos
      WHERE usuario_id = ? AND borrado_at IS NULL ${carpeta ? 'AND carpeta = ?' : ''}
      ORDER BY creado_at DESC`,
    carpeta ? [usuarioId, carpeta] : [usuarioId]
  );
  return filas.map(aArchivo);
}

/* Para el barrido: las fichas marcadas hace más de un día. El retraso es a
   propósito — si el borrado fue un error, hay margen para deshacerlo antes de
   que los bytes desaparezcan. */
async function borradosPendientes({ dias = 1, limite = 500 } = {}) {
  const filas = await db.consultar(
    `SELECT * FROM archivos
      WHERE borrado_at IS NOT NULL AND borrado_at < DATE_SUB(NOW(), INTERVAL ? DAY)
      LIMIT ?`,
    [dias, limite]
  );
  return filas.map(aArchivo);
}

async function olvidar(id) {
  await db.consultar('DELETE FROM archivos WHERE id = ?', [id]);
}

module.exports = {
  registrar, porId, porRuta, anterioresDe, marcarBorrado,
  bytesDe, deUsuario, borradosPendientes, olvidar,
};
