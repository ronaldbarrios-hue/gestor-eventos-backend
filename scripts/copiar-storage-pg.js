#!/usr/bin/env node
'use strict';

/* scripts/copiar-storage-pg.js — lo mismo que scripts/copiar-storage.js, sin
 * SUPABASE_SERVICE_KEY.
 *
 * ── Por qué existe, y por qué es seguro ─────────────────────────────────
 *
 * El original lee con el cliente de Supabase (`lib/supabase.js`), que exige
 * `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — el service_role del panel, que es
 * de Juan. Este hace las mismas dos preguntas de otra forma:
 *
 *   1. «¿Qué archivos hay?» — en vez de `storage.list()` (la API), un SELECT
 *      directo a `storage.objects`. Es una tabla de Postgres como cualquier
 *      otra, y la misma PG_URL que ya lees para `auth.users`
 *      (generar-usuarios.mjs) también la ve — mismo rol, mismo camino.
 *   2. «¿Quién lo usa?» — un SELECT a las columnas de `public.*` que guardan
 *      URLs (la misma lista que trae `scripts/_origen-supabase.js`), en vez de
 *      pasar por PostgREST.
 *
 * Ninguna de las dos toca Storage; las dos son lectura de Postgres, con el
 * mismo PG_URL de siempre.
 *
 * Lo único que de verdad usa la red de Storage es bajar los bytes — y ahí no
 * hace falta llave: `avatars`, `event-media` y `form-uploads` están marcados
 * **públicos** (`deploy/MIGRACION.md`, "Recrea buckets ... como públicos"), así
 * que cada archivo se sirve sin autenticar en
 * `https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<ruta>`. Eso es
 * justo la URL que ya está incrustada en cada página pública de evento — no
 * es un atajo nuevo, es la misma puerta por la que ya entra cualquier
 * visitante.
 *
 * (Lo que SÍ sigue pidiendo llave — y por eso este script no lo intenta — es
 * *listar* un bucket completo por la API: la migración 0048 apagó esa
 * política a propósito, para que nadie pueda enumerar todos los avatares
 * probando. Por eso la lista sale de Postgres y no de la API.)
 *
 * ── Cómo se usa — igual que el original ─────────────────────────────────
 *
 *   node --env-file=.env scripts/copiar-storage-pg.js                # cuenta, no baja nada
 *   node --env-file=.env scripts/copiar-storage-pg.js --aplicar       # baja los referenciados
 *   node --env-file=.env scripts/copiar-storage-pg.js --aplicar --todos  # + huérfanos
 *
 * Se puede repetir: lo que ya está en disco (`almacen.existe`) se salta.
 */

const path = require('path');
const almacen = require('../modules/archivos/almacen.js');
const repositorio = require('../modules/archivos/repositorio.js');
const tipos = require('../modules/archivos/tipos.js');
const db = require('../core/db/mysql.js');

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const TODOS   = args.includes('--todos');

const PG_URL = process.env.PG_URL;
if (!PG_URL) {
  console.error('\nFalta PG_URL. Corre con: node --env-file=.env scripts/copiar-storage-pg.js\n');
  process.exit(1);
}

const BUCKETS = ['avatars', 'event-media', 'form-uploads'];

/* Las mismas 13 columnas de scripts/_origen-supabase.js — no se duplica la
   lista para no volver a tener dos "quién usa qué" que puedan discreparse. */
const COLUMNAS_CON_URL = [
  ['eventos', 'cover_url'], ['eventos', 'gallery'], ['eventos', 'page_json'],
  ['eventos', 'paginas'], ['eventos', 'branding'], ['eventos', 'pago_qr_url'],
  ['torneo_equipos', 'foto_url'], ['tickets', 'respuestas'],
  ['profiles', 'empresa_logo_url'], ['profiles', 'avatar_url'],
  ['chat_messages', 'file_url'], ['speakers', 'foto_url'],
  ['networking_expositores', 'logo_url'],
];

/* El project ref sale del PG_URL de dos formas, según qué cadena copiaste del
 * panel (README de db/esquema/ acepta las dos):
 *   pooler: postgresql://postgres.<ref>:...@aws-0-....pooler.supabase.com/...
 *   directa: postgresql://postgres:...@db.<ref>.supabase.co/...
 * Sin el ref no hay URL pública que construir. */
function extraerRef(url) {
  let m = url.match(/postgres\.([a-z0-9]+):/i);
  if (m) return m[1];
  m = url.match(/db\.([a-z0-9]+)\.supabase\.co/i);
  if (m) return m[1];
  return null;
}

const REF = extraerRef(PG_URL);
if (!REF) {
  console.error('\nNo pude sacar el project ref de PG_URL. ¿Es una cadena de Supabase?\n');
  process.exit(1);
}

function urlPublica(bucket, ruta) {
  const segmentos = ruta.split('/').map(encodeURIComponent).join('/');
  return `https://${REF}.supabase.co/storage/v1/object/public/${bucket}/${segmentos}`;
}

async function main() {
  let pg;
  try {
    pg = (await import('pg')).default;
  } catch {
    console.error("Falta el paquete 'pg'. Instálalo:  npm i pg");
    process.exit(1);
  }
  const pool = new pg.Pool({
    connectionString: PG_URL,
    ssl: /supabase\.(co|com)/.test(PG_URL) ? { rejectUnauthorized: false } : undefined,
  });

  try {
    console.log('\n── Inventario ────────────────────────────────────────────');

    const { rows: objetosCrudos } = await pool.query(
      `SELECT bucket_id, name, metadata, created_at
         FROM storage.objects
        WHERE bucket_id = ANY($1::text[])`,
      [BUCKETS]
    );
    const objetos = objetosCrudos.map(o => ({
      bucket: o.bucket_id,
      ruta: o.name,
      bytes: Number(o.metadata?.size) || 0,
      mime: o.metadata?.mimetype || null,
      creado: o.created_at,
    }));

    const usadas = new Set();
    for (const [tabla, columna] of COLUMNAS_CON_URL) {
      let filas;
      try {
        ({ rows: filas } = await pool.query(`SELECT "${columna}" AS v FROM "${tabla}" WHERE "${columna}" IS NOT NULL`));
      } catch (e) {
        console.warn(`   ⚠ no se pudo leer ${tabla}.${columna}: ${e.message}`);
        continue;
      }
      for (const fila of filas) {
        const valor = fila.v;
        const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
        for (const m of String(texto).matchAll(/\/storage\/v1\/object\/(?:public|sign)\/([^"'\\)\s?]+)/g)) {
          usadas.add(decodeURIComponent(m[1]));
        }
      }
    }

    const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1);
    const suma = (lista) => lista.reduce((n, o) => n + o.bytes, 0);

    const referenciados = [];
    const huerfanos = [];
    for (const o of objetos) {
      if (usadas.has(`${o.bucket}/${o.ruta}`)) referenciados.push(o);
      else huerfanos.push(o);
    }

    console.log(`   objetos             ${objetos.length}  (${mb(suma(objetos))} MB)`);
    console.log(`   referenciados       ${referenciados.length}  (${mb(suma(referenciados))} MB)`);
    console.log(`   huérfanos           ${huerfanos.length}  (${mb(suma(huerfanos))} MB)`);

    if (huerfanos.length) {
      console.log('\n   Los huérfanos no los apunta ninguna fila. Se quedan fuera de la copia');
      console.log('   salvo que se pase --todos.');
    }

    const aCopiar = TODOS ? objetos : referenciados;

    if (!APLICAR) {
      console.log(`\n✓ Se copiarían ${aCopiar.length} objetos (${mb(suma(aCopiar))} MB). Nada bajado (falta --aplicar).\n`);
      return;
    }

    console.log(`\n── Copiando ${aCopiar.length} objetos ────────────────────────────`);

    let copiados = 0;
    let saltados = 0;
    const fallos = [];

    for (const o of aCopiar) {
      const destino = `${o.bucket}/${o.ruta}`;

      if (await almacen.existe(destino)) { saltados += 1; continue; }

      let res;
      try {
        res = await fetch(urlPublica(o.bucket, o.ruta));
      } catch (e) {
        fallos.push(`${destino}: ${e.message}`);
        continue;
      }
      if (!res.ok) { fallos.push(`${destino}: HTTP ${res.status}`); continue; }

      const contenido = Buffer.from(await res.arrayBuffer());

      const mime = tipos.detectar(contenido);
      if (!mime) fallos.push(`${destino}: tipo no reconocido (se copia igual)`);

      await almacen.guardar(destino, contenido);

      if (db.configurada()) {
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
  } finally {
    await pool.end();
  }
}

main()
  .catch((e) => { console.error('\n✗', e.message, '\n'); process.exitCode = 1; })
  .finally(() => db.cerrar().catch(() => {}));
