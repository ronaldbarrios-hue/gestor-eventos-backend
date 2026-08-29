#!/usr/bin/env node
'use strict';

/* scripts/copiar-storage.js — trae los archivos de Supabase Storage al disco.
 *
 * ── El orden, que es lo que tiene filo ───────────────────────────────────
 *
 * 1. **Barrer antes de copiar.** De los 107 objetos, 36 no los referencia
 *    ninguna fila: 28,1 MB, más de un tercio (medido el 29 de agosto). Copiarlos
 *    es pagar el trabajo dos veces. Por defecto sólo se traen los que alguien
 *    usa; `scripts/barrer-huerfanos.js` se lleva el resto.
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

/* Listar el origen y saber qué usa alguien es la misma pregunta que se hace
   el barrido de huérfanos, así que vive en un solo sitio: si las dos copias se
   separaran, una copiaría basura o la otra borraría algo que sí se usa. */
const origen = require('./_origen-supabase.js');

async function main() {
  console.log('\n── Inventario ────────────────────────────────────────────');

  const { objetos, referenciados: conDueño, huerfanos } = await origen.clasificar({ dias: 0 });
  const { mb, suma } = origen;

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
