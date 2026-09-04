/* generar-esquema.mjs — corre db/migraciones/generar-esquema-mysql.sql contra
 * Postgres y escribe 01_tablas.sql, 04_indices.sql y 05_claves_foraneas.sql.
 *
 * Hace lo mismo que documenta el README de esta carpeta bajo «Cómo regenerar
 * los archivos "Generado"», pero sin pasar por el editor SQL de Supabase ni
 * copiar/pegar tres tablas de resultado a mano (eso fue lo que dejó el acento
 * roto en «-- A MANO (unico parcial)» del volcado anterior).
 *
 * Sólo LEE la base: las mismas dos funciones auxiliares (en pg_temp, que
 * desaparece sola al cerrar la conexión) y los tres SELECT del archivo .sql
 * de siempre. No crea, no borra, no toca ninguna fila.
 *
 *   cd gestor-eventos-backend
 *   npm i pg     # si no lo tenés ya (lo mismo que usa generar-datos.mjs)
 *   export PG_URL='postgresql://postgres.<ref>:<PASS>@<HOST>:5432/postgres'
 *   node db/esquema/generar-esquema.mjs
 *
 * Si el generador encuentra un tipo de columna que no sabe traducir, esto para
 * y no escribe ningún archivo a medias — hay que decidir la traducción en
 * db/migraciones/generar-esquema-mysql.sql antes de seguir (ver NOTAS-ESQUEMA.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../migraciones/generar-esquema-mysql.sql');
const OUT_TABLAS = path.join(__dirname, '01_tablas.sql');
const OUT_INDICES = path.join(__dirname, '04_indices.sql');
const OUT_FKS = path.join(__dirname, '05_claves_foraneas.sql');

const PG_URL = process.env.PG_URL;
if (!PG_URL) {
  console.error('Falta PG_URL. Ejemplo:');
  console.error("  export PG_URL='postgresql://postgres.<ref>:<PASS>@<HOST>:5432/postgres'");
  process.exit(1);
}

let pg;
try {
  pg = (await import('pg')).default;
} catch {
  console.error("Falta el paquete 'pg'. Instálalo:  npm i pg");
  process.exit(1);
}

if (!fs.existsSync(SRC)) {
  console.error(`No encontré ${SRC}`);
  process.exit(1);
}
const full = fs.readFileSync(SRC, 'utf8');
const i3 = full.indexOf('/* ── 3 ·');
const i4 = full.indexOf('/* ── 4 ·');
const i5 = full.indexOf('/* ── 5 ·');
if (i3 < 0 || i4 < 0 || i5 < 0) {
  console.error(`No encontré las tres secciones esperadas dentro de ${SRC}.`);
  console.error('¿Cambió el archivo? Si sí, hay que ajustar los marcadores en este script.');
  process.exit(1);
}
const sqlFunciones = full.slice(0, i3);
const sqlTablas = full.slice(i3, i4);
const sqlIndices = full.slice(i4, i5);
const sqlFks = full.slice(i5);

const hoy = new Date().toISOString().slice(0, 10);
const RAYA = '═'.repeat(79);

function encabezado(titulo, extra) {
  return (
    `/* ${RAYA}\n` +
    ` * GESTEK · Volcado de la base de Supabase — ${titulo}\n` +
    ` * ${RAYA}\n` +
    ` *\n` +
    ` * Generado: ${hoy}, corriendo db/esquema/generar-esquema.mjs contra Postgres\n` +
    ` *           (proyecto \`GestorEventosMarcaBlanca\`, yopontbwgdybfsniqawz).\n` +
    (extra ? extra.split('\n').map(l => ` * ${l}`).join('\n') + '\n' : '') +
    ` *\n` +
    ` * Este archivo es la salida del generador. NO se edita a mano: si el esquema\n` +
    ` * de Postgres cambia, se vuelve a correr este script y se compara con\n` +
    ` * \`git diff\`. El «por qué» de cada traducción está en\n` +
    ` * \`db/migraciones/NOTAS-ESQUEMA.md\`; el orden de aplicación de los seis\n` +
    ` * archivos, en el README.md de esta carpeta.\n` +
    ` * ${RAYA} */\n\n`
  );
}

const { Client } = pg;
const client = new Client({
  connectionString: PG_URL,
  ssl: /supabase\.(co|com)/.test(PG_URL) ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

console.error('Creando las funciones auxiliares (viven sólo en esta conexión)...');
await client.query(sqlFunciones);

console.error('Generando 01_tablas.sql...');
const tablas = await client.query(sqlTablas);
const parar = tablas.rows.find(r => r.ddl && r.ddl.startsWith('/* ¡PARAR!'));
if (parar) {
  console.error('\n' + parar.ddl + '\n');
  console.error('Hay un tipo de columna nuevo que el generador no sabe traducir.');
  console.error('Hay que decidir su traducción en db/migraciones/generar-esquema-mysql.sql');
  console.error('(sección 1, pg_temp.tipo_mysql) antes de seguir. No escribí ningún archivo.');
  await client.end();
  process.exit(1);
}
fs.writeFileSync(
  OUT_TABLAS,
  encabezado('01 · TABLAS', `${tablas.rows.length} tablas.`) +
    'SET NAMES utf8mb4;\n' +
    "SET time_zone = '+00:00';\n" +
    'SET FOREIGN_KEY_CHECKS = 0;\n\n\n' +
    tablas.rows.map(r => r.ddl).join('\n\n') +
    '\n'
);

console.error('Generando 04_indices.sql...');
const indices = await client.query(sqlIndices);
const lineasIndices = indices.rows.filter(r => r.ddl).map(r => r.ddl);
fs.writeFileSync(
  OUT_INDICES,
  encabezado(
    '04 · ÍNDICES (no parciales)',
    'Las PRIMARY KEY ya van en 01_tablas.sql. Los 8 índices únicos parciales\n' +
      'NO están aquí — van en 02_indices_unicos_parciales.sql, a mano. Las líneas\n' +
      '«-- A MANO» de abajo son el recordatorio de cuáles son.'
  ) +
    'SET NAMES utf8mb4;\n' +
    "SET time_zone = '+00:00';\n\n" +
    lineasIndices.join('\n') +
    '\n'
);

console.error('Generando 05_claves_foraneas.sql...');
const fks = await client.query(sqlFks);
fs.writeFileSync(
  OUT_FKS,
  encabezado(
    '05 · CLAVES FORÁNEAS',
    'Va al FINAL, después de tablas, datos e índices: hay ciclos entre tablas y\n' +
      'no existe un orden de creación que las respete todas. NO incluye las claves\n' +
      'que en Postgres apuntan a auth.users — quedan como CHAR(36) con índice; ver\n' +
      'NOTAS-ESQUEMA.md.'
  ) +
    'SET NAMES utf8mb4;\n\n' +
    fks.rows.map(r => r.ddl).join('\n') +
    '\n'
);

await client.end();

console.error(
  `\nOK -> 01_tablas.sql (${tablas.rows.length} tablas), ` +
    `04_indices.sql (${lineasIndices.length} líneas), ` +
    `05_claves_foraneas.sql (${fks.rows.length} claves)`
);
console.error('Revisá con `git diff db/esquema/` qué cambió antes de cargarlo en phpMyAdmin.');
