/* Copia los objetos de Storage de una instancia Supabase (origen) a otra
   (destino). Útil al self-hostear: mueve avatars/event-media/form-uploads.
   Usa la service key de cada instancia (salta RLS).

   Uso:
     SRC_SUPABASE_URL=... SRC_SERVICE_KEY=... \
     DST_SUPABASE_URL=... DST_SERVICE_KEY=... \
     node deploy/migrar-storage.mjs
*/
import { createClient } from '@supabase/supabase-js';

const ORIGEN  = createClient(process.env.SRC_SUPABASE_URL, process.env.SRC_SERVICE_KEY, { auth: { persistSession: false } });
const DESTINO = createClient(process.env.DST_SUPABASE_URL, process.env.DST_SERVICE_KEY, { auth: { persistSession: false } });
const BUCKETS = ['avatars', 'event-media', 'form-uploads'];

async function listar(cli, bucket, prefix = '') {
  const { data, error } = await cli.storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw error;
  let out = [];
  for (const item of data || []) {
    const full = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) out = out.concat(await listar(cli, bucket, full)); // es carpeta → recursar
    else out.push(full);
  }
  return out;
}

for (const bucket of BUCKETS) {
  await DESTINO.storage.createBucket(bucket, { public: true }).catch(() => {}); // idempotente
  let paths = [];
  try { paths = await listar(ORIGEN, bucket); }
  catch (e) { console.error(`[${bucket}] error listando:`, e.message); continue; }
  console.log(`[${bucket}] ${paths.length} objetos`);
  let ok = 0;
  for (const path of paths) {
    const { data: blob, error } = await ORIGEN.storage.from(bucket).download(path);
    if (error) { console.warn(`  skip ${path}: ${error.message}`); continue; }
    const buf = Buffer.from(await blob.arrayBuffer());
    const up = await DESTINO.storage.from(bucket).upload(path, buf, { upsert: true, contentType: blob.type || undefined });
    if (up.error) console.warn(`  up fail ${path}: ${up.error.message}`);
    else ok++;
  }
  console.log(`[${bucket}] copiados ${ok}/${paths.length}`);
}
console.log('Migración de Storage terminada.');
