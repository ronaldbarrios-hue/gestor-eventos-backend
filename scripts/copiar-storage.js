#!/usr/bin/env node
'use strict';

/* scripts/copiar-storage.js — trae los archivos de Supabase Storage al disco.
 *
 * ── El orden, que es lo que tiene filo ───────────────────────────────────
 *
 * 1. **Barrer antes de copiar.** De los 107 objetos, 40 no los referencia
 *    ninguna fila: 28 MB, más de un tercio. Copiarlos es pagar el trabajo dos
 *    veces. Con `--solo-referenciados` (que es como viene por defecto) sólo se
 *    traen los que alguien usa.
 * 2. **Copiar conservando la ruta**, `carpeta/archivo` tal cual. Es lo que
 *    convierte la reescritura de las 13 columnas en un cambio de prefijo.
 * 3. **Servir las dos copias en paralelo** mientras dure la ventana. Las URLs
 *    viejas tienen que seguir respondiendo hasta que la reescritura esté
 *    verificada, o cada portada sin migrar es un hueco en una página pública.
 * 4. **Reescribir** con `db/migraciones/postgres/001_reescribir_urls.sql`, que
 *    va dentro de una transacción y compara los conteos.
 * 5. Sólo entonces, apagar el origen.
 *
 * Este script hace el 1 y el 2. El resto es SQL y decisión humana.
 *
 * ── Cómo se usa ──────────────────────────────────────────────────────────
 *
 *   node scripts/copiar-storage.js                 # lista y cuenta, no baja nada
 *   node scripts/copiar-storage.js --aplicar       # baja los referenciados
 *   node scripts/copiar-storage.js --aplicar --todos   # baja también los huérfanos
 *
 * Se puede repetir: lo que ya está en disco se salta.
 */

const path = require('path');
const supabase = require('../lib/supabase.js');
const almacen = require('../modules/archivos/almacen.js');
const repositorio = require('../modules/archivos/repositorio.js');
const tipos = require('../modules/archivos/tipos.js');
const db = require('../core/db/mysql.js');

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const TODOS   = args.includes('--todos');

const BUCKETS = ['avatars', 'event-media', 'form-uploads'];

/* Las 13 columnas de 9 tablas donde la URL vive dentro de la fila. Salen de
   SUPABASE.md §3.3, medidas contra las 71 tablas, no supuestas. Las cinco
   marcadas son JSON, y ahí la URL está a profundidad variable: por eso se
   busca sobre el texto de la columna y no por clave. */
const COLUMNAS_CON_URL = [
  ['eventos', 'cover_url'], ['eventos', 'gallery'], ['eventos', 'page_json'],
  ['eventos', 'paginas'], ['eventos', 'branding'], ['eventos', 'pago_qr_url'],
  ['torneo_equipos', 'foto_url'], ['tickets', 'respuestas'],
  ['profiles', 'empresa_logo_url'], ['profiles', 'avatar_url'],
  ['chat_messages', 'file_url'], ['speakers', 'foto_url'],
  ['networking_expositores', 'logo_url'],
];

/* Recorre un bucket entero. `list` pagina de 100 en 100 y no baja a las
   subcarpetas solo, así que hay que recorrerlas. */
async function listarBucket(bucket, prefijo = '') {
  const encontrados = [];
  let desde = 0;

  for (;;) {
    const { data, error } = await supabase.storage.from(bucket)
      .list(prefijo, { limit: 100, offset: desde });
    if (error) throw new Error(`No se pudo listar ${bucket}/${prefijo}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const objeto of data) {
      /* Sin `id` es una carpeta, no un archivo. */
      if (!objeto.id) {
        encontrados.push(...await listarBucket(bucket, prefijo ? `${prefijo}/${objeto.name}` : objeto.name));
        continue;
      }
      encontrados.push({
        bucket,
        ruta : prefijo ? `${prefijo}/${objeto.name}` : objeto.name,
        bytes: objeto.metadata?.size || 0,
        mime : objeto.metadata?.mimetype || null,
      });
    }

    if (data.length < 100) break;
    desde += data.length;
  }
  return encontrados;
}

/* Qué rutas menciona alguna fila. Se busca el nombre del archivo dentro del
   texto de cada columna, que es lo único que funciona con las cinco JSON. */
async function rutasReferenciadas() {
  const usadas = new Set();

  for (const [tabla, columna] of COLUMNAS_CON_URL) {
    const { data, error } = await supabase
      .from(tabla).select(columna)
      .not(columna, 'is', null);
    if (error) {
      console.warn(`   ⚠ no se pudo leer ${tabla}.${columna}: ${error.message}`);
      continue;
    }
    for (const fila of data || []) {
      const texto = typeof fila[columna] === 'string' ? fila[columna] : JSON.stringify(fila[columna]);
      /* `/object/public/<bucket>/<ruta>` hasta la comilla, el paréntesis o el
         final. Sirve igual dentro de un JSON serializado. */
      for (const m of String(texto).matchAll(/\/storage\/v1\/object\/(?:public|sign)\/([^"'\\)\s?]+)/g)) {
        usadas.add(decodeURIComponent(m[1]));
      }
    }
  }
  return usadas;
}

async function main() {
  console.log('\n── Inventario ────────────────────────────────────────────');

  const objetos = [];
  for (const b of BUCKETS) objetos.push(...await listarBucket(b));

  const usadas = await rutasReferenciadas();
  const conDueño = objetos.filter(o => usadas.has(`${o.bucket}/${o.ruta}`));
  const huerfanos = objetos.filter(o => !usadas.has(`${o.bucket}/${o.ruta}`));

  const mb = (n) => (n / (1024 * 1024)).toFixed(1);
  const suma = (lista) => lista.reduce((n, o) => n + o.bytes, 0);

  console.log(`   objetos             ${objetos.length}  (${mb(suma(objetos))} MB)`);
  console.log(`   referenciados       ${conDueño.length}  (${mb(suma(conDueño))} MB)`);
  console.log(`   huérfanos           ${huerfanos.length}  (${mb(suma(huerfanos))} MB)`);

  if (huerfanos.length) {
    console.log('\n   Los huérfanos no los apunta ninguna fila. Se quedan fuera de la copia');
    console.log('   salvo que se pase --todos. Barrerlos en el origen es la fase 0.');
  }

  const aCopiar = TODOS ? objetos : conDueño;

  if (!APLICAR) {
    console.log(`\n✓ Se copiarían ${aCopiar.length} objetos (${mb(suma(aCopiar))} MB). Nada bajado (falta --aplicar).\n`);
    return;
  }

  console.log(`\n── Copiando ${aCopiar.length} objetos ────────────────────────────`);

  let copiados = 0;
  let saltados = 0;
  const fallos = [];

  for (const o of aCopiar) {
    /* La ruta de destino es la de origen, con el bucket como carpeta. Idéntica
       a propósito: es lo que hace que reescribir sea cambiar el prefijo. */
    const destino = `${o.bucket}/${o.ruta}`;

    if (await almacen.existe(destino)) { saltados += 1; continue; }

    const { data, error } = await supabase.storage.from(o.bucket).download(o.ruta);
    if (error) { fallos.push(`${destino}: ${error.message}`); continue; }

    const contenido = Buffer.from(await data.arrayBuffer());

    /* Se comprueba el tipo también aquí. Si en el bucket hay algo que no es lo
       que dice ser, mejor saberlo ahora que después de servirlo desde nuestro
       dominio. */
    const mime = tipos.detectar(contenido);
    if (!mime) fallos.push(`${destino}: tipo no reconocido (se copia igual)`);

    await almacen.guardar(destino, contenido);

    if (db.configurada()) {
      /* La ficha, para que el archivo tenga dueño y entre en las cuotas y en el
         barrido. El dueño sale de la primera carpeta de la ruta, que en
         `avatars` y `event-media` es el uid. */
      const primerSegmento = o.ruta.split('/')[0];
      const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(primerSegmento);
      await repositorio.registrar({
        ruta          : destino,
        carpeta       : o.bucket,
        usuarioId     : esUuid ? primerSegmento : null,
        eventoId      : esUuid ? null : primerSegmento,
        nombreOriginal: path.basename(o.ruta),
        tipoMime      : mime || o.mime || 'application/octet-stream',
        bytes         : contenido.length,
        publico       : true,
      }).catch((e) => fallos.push(`${destino}: ficha no registrada (${e.message})`));
    }

    copiados += 1;
    if (copiados % 20 === 0) console.log(`   ${copiados}/${aCopiar.length}…`);
  }

  console.log('\n── Resultado ─────────────────────────────────────────────');
  console.log(`   copiados            ${copiados}`);
  console.log(`   ya estaban          ${saltados}`);
  if (fallos.length) {
    console.log(`   con problemas       ${fallos.length}`);
    for (const f of fallos) console.log(`     · ${f}`);
  }

  console.log('\n  Ahora, y NO antes: servir las dos copias en paralelo, y sólo cuando');
  console.log('  las URLs nuevas respondan, correr la reescritura');
  console.log('  (db/migraciones/postgres/001_reescribir_urls.sql).\n');
}

main()
  .catch((e) => { console.error('\n✗', e.message, '\n'); process.exitCode = 1; })
  .finally(() => db.cerrar().catch(() => {}));
