#!/usr/bin/env node
'use strict';

/* scripts/barrer-huerfanos.js — borra del Storage lo que ya no apunta nadie.
 *
 * ── Qué son los huérfanos y de dónde salen ───────────────────────────────
 *
 * Cuatro de los cinco uploaders del frontend suben el archivo nuevo y dejan el
 * viejo donde estaba. Nadie lo borra porque nadie sabe que existe. Medido el 29
 * de agosto: **36 objetos, 28,1 MB de los 80 que ocupa el almacenamiento** —
 * más de un tercio— que ninguna de las 13 columnas menciona.
 *
 * Eso es lo que explica el salto de 24 a 80 MB: no es que se suba más, es que
 * no se borra nunca. El arreglo de raíz es `modules/archivos/`, que borra el
 * anterior al subir uno nuevo. Este script limpia lo que se acumuló antes.
 *
 * ── Las tres cosas que lo hacen seguro ───────────────────────────────────
 *
 * 1. **No adivina.** Un objeto sólo se borra si NINGUNA de las 13 columnas lo
 *    menciona, y esas 13 son las medidas contra las 71 tablas.
 * 2. **No toca lo reciente.** Lo subido en los últimos dos días se queda,
 *    aunque no lo referencie nadie: puede estar en un formulario a medio
 *    llenar. Se ajusta con `--dias N`.
 * 3. **Deja constancia.** Antes de borrar escribe un manifiesto con la ruta,
 *    el tamaño y la fecha de cada archivo. Los bytes no vuelven, pero al menos
 *    se sabe exactamente qué había.
 *
 * ── Cómo se usa ──────────────────────────────────────────────────────────
 *
 *   node scripts/barrer-huerfanos.js                # lista y cuenta, no borra
 *   node scripts/barrer-huerfanos.js --aplicar      # borra
 *
 * Necesita `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` en el entorno: borrar del
 * Storage no se puede con la llave anónima, y tampoco vale borrar las filas de
 * `storage.objects` por SQL — eso quita la ficha y deja el archivo ocupando
 * sitio, que es peor que no hacer nada.
 */

const fs = require('fs');
const path = require('path');
const supabase = require('../lib/supabase.js');
const origen = require('./_origen-supabase.js');

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const DIAS = (() => {
  const i = args.indexOf('--dias');
  return i >= 0 ? parseInt(args[i + 1], 10) || 2 : 2;
})();

async function main() {
  console.log('\n── Mirando qué usa alguien ───────────────────────────────');

  const { objetos, referenciados, huerfanos, recientes } = await origen.clasificar({ dias: DIAS });

  console.log(`   objetos             ${objetos.length}  (${origen.mb(origen.suma(objetos))} MB)`);
  console.log(`   referenciados       ${referenciados.length}  (${origen.mb(origen.suma(referenciados))} MB)`);
  console.log(`   huérfanos           ${huerfanos.length}  (${origen.mb(origen.suma(huerfanos))} MB)`);
  if (recientes.length) {
    console.log(`   recientes           ${recientes.length}  — sin referencia pero de hace menos de ${DIAS} días: NO se tocan`);
  }

  if (huerfanos.length === 0) {
    console.log('\n✓ No hay nada que barrer.\n');
    return;
  }

  console.log('\n── Lo que se borraría ────────────────────────────────────');
  for (const o of huerfanos) {
    console.log(`   ${String(Math.round(o.bytes / 1024)).padStart(6)} KB  ${o.bucket}/${o.ruta}`);
  }

  if (!APLICAR) {
    console.log(`\n✓ ${huerfanos.length} huérfanos, ${origen.mb(origen.suma(huerfanos))} MB. Nada borrado (falta --aplicar).\n`);
    return;
  }

  /* El manifiesto va ANTES del borrado: si el proceso se cae a mitad, lo que
     queda escrito es la lista entera, no media. */
  const manifiesto = path.join(process.cwd(), `huerfanos-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(manifiesto, `${JSON.stringify({
    fecha: new Date().toISOString(),
    dias_de_gracia: DIAS,
    total: huerfanos.length,
    bytes: origen.suma(huerfanos),
    archivos: huerfanos,
  }, null, 2)}\n`);
  console.log(`\n   manifiesto → ${manifiesto}`);

  console.log('\n── Borrando ──────────────────────────────────────────────');

  let borrados = 0;
  const fallos = [];

  /* Por bucket y de 50 en 50: `remove` acepta una lista, y mandar 36 rutas de
     tres buckets distintos en una sola llamada no se puede. */
  for (const bucket of origen.BUCKETS) {
    const rutas = huerfanos.filter(o => o.bucket === bucket).map(o => o.ruta);
    for (let i = 0; i < rutas.length; i += 50) {
      const lote = rutas.slice(i, i + 50);
      const { data, error } = await supabase.storage.from(bucket).remove(lote);
      if (error) { fallos.push(`${bucket}: ${error.message}`); continue; }
      borrados += (data || lote).length;
    }
  }

  console.log(`   borrados            ${borrados}`);
  if (fallos.length) {
    console.log(`   con problemas       ${fallos.length}`);
    for (const f of fallos) console.log(`     · ${f}`);
  }

  console.log('\n✓ Listo. Comprobar en el panel que el almacenamiento bajó, y guardar el manifiesto.\n');
}

main().catch((e) => { console.error('\n✗', e.message, '\n'); process.exitCode = 1; });
