'use strict';

/* scripts/_origen-supabase.js — leer qué hay en el Storage de Supabase y qué
 * de eso lo usa alguien.
 *
 * Lo usan los dos scripts que tocan archivos: el que copia al almacén propio y
 * el que barre los huérfanos. Está aquí, y no repetido en los dos, porque son
 * exactamente la misma pregunta hecha al revés: «qué se referencia» y «qué no».
 * Si las dos copias se separaran, una de ellas copiaría basura o —peor— la otra
 * borraría algo que sí se usa.
 *
 * El guion bajo del nombre es para que el `node --test` de la suite no lo tome
 * por una prueba.
 */

const supabase = require('../lib/supabase.js');

const BUCKETS = ['avatars', 'event-media', 'form-uploads'];

/* Las 13 columnas de 9 tablas donde la URL vive dentro de la fila. Medidas
   contra las 71 tablas (SUPABASE.md §3.3), no supuestas. Cinco son JSON, y por
   eso se busca sobre el texto de la columna y no por clave: en `page_json` la
   imagen puede estar en cualquier bloque, a cualquier profundidad. */
const COLUMNAS_CON_URL = [
  ['eventos', 'cover_url'], ['eventos', 'gallery'], ['eventos', 'page_json'],
  ['eventos', 'paginas'], ['eventos', 'branding'], ['eventos', 'pago_qr_url'],
  ['torneo_equipos', 'foto_url'], ['tickets', 'respuestas'],
  ['profiles', 'empresa_logo_url'], ['profiles', 'avatar_url'],
  ['chat_messages', 'file_url'], ['speakers', 'foto_url'],
  ['networking_expositores', 'logo_url'],
];

/* Recorre un bucket entero. `list` pagina de 100 en 100 y no baja solo a las
   subcarpetas: hay que recorrerlas. */
async function listarBucket(bucket, prefijo = '') {
  const encontrados = [];
  let desde = 0;

  for (;;) {
    const { data, error } = await supabase.storage.from(bucket)
      .list(prefijo, { limit: 100, offset: desde });
    if (error) throw new Error(`No se pudo listar ${bucket}/${prefijo}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const objeto of data) {
      if (!objeto.id) {                        // sin id es una carpeta
        encontrados.push(...await listarBucket(bucket, prefijo ? `${prefijo}/${objeto.name}` : objeto.name));
        continue;
      }
      encontrados.push({
        bucket,
        ruta  : prefijo ? `${prefijo}/${objeto.name}` : objeto.name,
        bytes : objeto.metadata?.size || 0,
        mime  : objeto.metadata?.mimetype || null,
        creado: objeto.created_at || null,
      });
    }

    if (data.length < 100) break;
    desde += data.length;
  }
  return encontrados;
}

async function listarTodo() {
  const objetos = [];
  for (const b of BUCKETS) objetos.push(...await listarBucket(b));
  return objetos;
}

/* Qué rutas menciona alguna fila, en formato `bucket/ruta`. Se busca el patrón
   de URL dentro del TEXTO de cada columna, que es lo único que alcanza a las
   cinco columnas JSON. */
async function rutasReferenciadas({ avisar = console.warn } = {}) {
  const usadas = new Set();

  for (const [tabla, columna] of COLUMNAS_CON_URL) {
    const { data, error } = await supabase.from(tabla).select(columna).not(columna, 'is', null);
    if (error) { avisar(`   ⚠ no se pudo leer ${tabla}.${columna}: ${error.message}`); continue; }

    for (const fila of data || []) {
      const valor = fila[columna];
      const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
      for (const m of String(texto).matchAll(/\/storage\/v1\/object\/(?:public|sign)\/([^"'\\)\s?]+)/g)) {
        usadas.add(decodeURIComponent(m[1]));
      }
    }
  }
  return usadas;
}

/* Separa lo que usa alguien de lo que no. `dias` protege lo recién subido: una
   foto que se subió hace un minuto puede estar todavía en el formulario que
   aún no se ha guardado, y borrarla sería quitarle el suelo a alguien que está
   trabajando. */
async function clasificar({ dias = 2 } = {}) {
  const objetos = await listarTodo();
  const usadas = await rutasReferenciadas();
  const corte = Date.now() - dias * 24 * 60 * 60 * 1000;

  const referenciados = [];
  const huerfanos = [];
  const recientes = [];

  for (const o of objetos) {
    if (usadas.has(`${o.bucket}/${o.ruta}`)) { referenciados.push(o); continue; }
    if (o.creado && new Date(o.creado).getTime() > corte) { recientes.push(o); continue; }
    huerfanos.push(o);
  }

  return { objetos, referenciados, huerfanos, recientes, usadas };
}

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1);
const suma = (lista) => lista.reduce((n, o) => n + o.bytes, 0);

module.exports = { BUCKETS, COLUMNAS_CON_URL, listarBucket, listarTodo, rutasReferenciadas, clasificar, mb, suma };
