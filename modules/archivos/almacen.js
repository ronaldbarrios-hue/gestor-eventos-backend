'use strict';

/* modules/archivos/almacen.js — el disco. Es el único archivo del módulo que
 * toca `fs`, por la misma razón por la que sólo `repositorio.js` toca SQL: el
 * día que esto sea S3, o un disco montado en otra máquina, se reescribe uno.
 *
 * ── Dónde viven los archivos ──────────────────────────────────────────────
 *
 * Fuera del repositorio y fuera de la carpeta del código. En cPanel eso es algo
 * como `/home/cuenta/gestek-archivos`, y en el .env `ARCHIVOS_RAIZ`. Si
 * estuvieran dentro del proyecto, un despliegue que reemplace la carpeta se
 * lleva por delante las fotos de todos los eventos, y no hay copia.
 *
 * ── La ruta es lo peligroso ───────────────────────────────────────────────
 *
 * Todo lo que llega de fuera puede llevar `..`, una barra inicial, un byte
 * nulo o una ruta absoluta. Cualquiera de esas cosas, concatenada sin mirar,
 * escribe o lee fuera del almacén — que en un hosting compartido significa el
 * resto de la cuenta. Por eso hay una sola función que convierte ruta relativa
 * en ruta absoluta, comprueba que el resultado sigue dentro, y es la que usan
 * todas las demás.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../../core/config');

function raiz() {
  return path.resolve(config.ARCHIVOS_RAIZ);
}

/* Sólo lo que no da problemas en un nombre de archivo, en ningún sistema.
   Nada de espacios, acentos ni comillas: el nombre bonito se guarda en la
   ficha (`nombre_original`) y se usa al descargar. */
function limpiarSegmento(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[^\w.-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
}

/* Convierte `avatars/<uid>/foto.jpg` en una ruta absoluta, o lanza.
 *
 * `path.resolve` ya normaliza los `..`, así que la comprobación de después es
 * la que decide: si el resultado no empieza por la raíz más el separador, es
 * que la ruta se salió. Compararlo con `startsWith(raiz)` a secas no vale —
 * `/var/gestek/archivos-otro` empieza por `/var/gestek/archivos`. */
function absoluta(rutaRelativa) {
  const r = String(rutaRelativa || '');
  if (!r || r.includes('\0')) throw new Error('Ruta inválida.');

  const base = raiz();
  const destino = path.resolve(base, r);
  if (destino !== base && !destino.startsWith(base + path.sep)) {
    throw new Error('Ruta fuera del almacén.');
  }
  return destino;
}

/* Arma la ruta de un archivo nuevo. El nombre lleva la marca de tiempo y seis
   bytes al azar: dos personas subiendo a la vez no se pisan, y la ruta no se
   puede adivinar a partir de la anterior — que es la mitad del problema de las
   hojas de vida de hoy, donde `<uid>/cv-<timestamp>.pdf` se acota probando. */
function nuevaRuta({ carpeta, propietario, prefijo = 'archivo', extension }) {
  const trozos = [
    limpiarSegmento(carpeta),
    limpiarSegmento(propietario || 'anonimo'),
    `${limpiarSegmento(prefijo)}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`,
  ];
  return trozos.join('/');
}

/* ── Operaciones ───────────────────────────────────────────────────────── */

async function guardar(rutaRelativa, contenido) {
  const destino = absoluta(rutaRelativa);
  await fsp.mkdir(path.dirname(destino), { recursive: true });
  /* `wx`: falla si ya existe. Con la marca de tiempo y los seis bytes al azar
     no debería pasar nunca, y si pasa es mejor un error que sobrescribir el
     archivo de otro. */
  await fsp.writeFile(destino, contenido, { flag: 'wx' });
  return destino;
}

async function borrar(rutaRelativa) {
  try {
    await fsp.unlink(absoluta(rutaRelativa));
    return true;
  } catch (e) {
    /* Que ya no esté no es un fallo: el barrido puede haber pasado antes, o
       alguien lo borró a mano. Lo que importa es que después de esto no está. */
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

async function existe(rutaRelativa) {
  try {
    await fsp.access(absoluta(rutaRelativa), fs.constants.R_OK);
    return true;
  } catch { return false; }
}

async function tamaño(rutaRelativa) {
  const s = await fsp.stat(absoluta(rutaRelativa));
  return s.size;
}

/* Para servir un privado desde Node cuando no hay Nginx delante. Con Nginx se
   usa `X-Accel-Redirect` y los bytes no pasan por el proceso, que es lo que
   evita que una descarga de 8 MB bloquee el bucle de eventos del servidor. */
function flujoDeLectura(rutaRelativa) {
  return fs.createReadStream(absoluta(rutaRelativa));
}

/* Comprueba que el almacén está utilizable. Se llama al arrancar: mejor un
   error en el log del arranque que el primer usuario que sube una foto. */
async function comprobar() {
  const base = raiz();
  await fsp.mkdir(base, { recursive: true });
  const testigo = path.join(base, `.escritura-${crypto.randomBytes(4).toString('hex')}`);
  await fsp.writeFile(testigo, 'ok');
  await fsp.unlink(testigo);
  return base;
}

module.exports = {
  raiz, absoluta, nuevaRuta, limpiarSegmento,
  guardar, borrar, existe, tamaño, flujoDeLectura, comprobar,
};
