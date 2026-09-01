/* generar-datos.mjs — saca el contenido de public.* del Postgres de Supabase y
 * escribe db/esquema/03_datos.sql (INSERT de MySQL 8).
 *
 * Sólo LEE la base. No la modifica.
 *
 *   cd gestor-eventos-backend
 *   npm i pg                     # única dependencia; no está en package.json a propósito
 *   export PG_URL='postgresql://postgres:<PASS>@<HOST>:5432/postgres?sslmode=require'
 *   node db/esquema/generar-datos.mjs
 *
 * La cadena PG_URL está en el panel de Supabase:
 *   Project Settings -> Database -> Connection string -> "Session pooler" (o "Direct").
 * La contraseña NO está en el repo: pídesela a quien administre el proyecto.
 *
 * Las cinco conversiones de db/migraciones/CARGA-DE-DATOS.md:
 *   1. timestamptz -> UTC sin sufijo de zona, "YYYY-MM-DD HH:MM:SS.ffffff"
 *      (con los microsegundos que Postgres guarda: se apagan los parsers de
 *       fecha de `pg` para que lleguen como texto crudo y no como Date de JS,
 *       que sólo tiene milisegundos).
 *   2. arreglos de Postgres -> texto JSON  ({read} -> ["read"]).
 *   3. jsonb -> texto JSON tal cual.
 *   4. booleanos -> 1 / 0.
 *   5. NULL se queda NULL. Nunca cadena vacía.
 *
 * El tipo de cada columna se saca de `result.fields[i].dataTypeID`, no de un
 * mapa de nombres: si el esquema cambia, esto lo sigue solo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DST = path.join(__dirname, '03_datos.sql');

const PG_URL = process.env.PG_URL;
if (!PG_URL) {
  console.error('Falta PG_URL. Ejemplo:');
  console.error("  export PG_URL='postgresql://postgres:<PASS>@<HOST>:5432/postgres?sslmode=require'");
  process.exit(1);
}

let pg;
try {
  pg = (await import('pg')).default;
} catch {
  console.error("Falta el paquete 'pg'. Instálalo:  npm i pg");
  process.exit(1);
}

/* OID de tipos de Postgres. */
const OID_NUM  = new Set([20, 21, 23, 26, 700, 701, 1700]); // int8 int2 int4 oid float4 float8 numeric
const OID_DATE = new Set([1082, 1083, 1114, 1184]);         // date time timestamp timestamptz
const OID_JSON = new Set([114, 3802]);                      // json jsonb
const OID_BOOL = 16;

/* Apaga el parser de `pg` para fechas y números: los queremos como texto crudo
 * de Postgres, no como Date (pierde microsegundos) ni como number (pierde
 * precisión en numeric/bigint). */
for (const oid of [...OID_NUM, ...OID_DATE]) pg.types.setTypeParser(oid, v => v);

/* Orden de carga: padres primero. Da igual para la corrección (FK checks off);
 * deja el INSERT legible. Las tablas que no estén aquí van al final, alfabético. */
const ORDER = ['categorias','profiles','eventos','catalogo_roles','event_roles','ticket_types','discount_codes','promociones','agenda_sessions','speakers','sponsors','networking_expositores','networking_horarios','networking_citas','torneos','torneo_categorias','torneo_equipos','torneo_partidos','tickets','event_members','event_form_fields','chat_channels','chat_messages','chat_channel_prefs','tareas','tarea_log','points_log','puntos_balance','recompensas','canjes','user_badges','missions','referral_codes','notificaciones','event_requests','evento_legal','evento_motivos','evento_alertas','evento_anuncios','evento_bolsa_puntos','evento_email_plantillas','evento_smtp','event_waitlist','waitlist','sesion_inscripciones','agenda_favoritos','payment_transactions','cobros_vacantes','push_subscriptions','api_tokens','webhooks','webhook_deliveries','organizador_conexiones','perfil_talento','postulaciones','talento_resenas','vacantes','sugerencias_dinamica','sugerencias_catalogo','recordatorio_inapp_log','ticket_interacciones','ticket_movimientos','zona_cortes','email_log','email_cola','evento_email_envios','oauth_clients','oauth_codes','oauth_tokens','audit_log','event_views'];

function qstr(s) {
  return "'" + String(s).replace(/[\0\b\t\n\r\x1a\\'"]/g, c => ({
    '\0': '\\0', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\r': '\\r',
    '\x1a': '\\Z', '\\': '\\\\', "'": "\\'", '"': '\\"',
  })[c]) + "'";
}

function fmtDate(s) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "'" + s + "'";                 // date
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/);
  if (!m) { console.error('  fecha con forma rara, se deja como texto: ' + s); return qstr(s); }
  const off = (m[4] || 'Z').replace(':', '');
  if (off !== 'Z' && off !== '+0000' && off !== '+00') {
    throw new Error(`Offset no-UTC en los datos (${s}). La sesión no estaba en UTC.`);
  }
  const frac = ((m[3] || '') + '000000').slice(0, 6);
  return `'${m[1]} ${m[2]}.${frac}'`;
}

function val(v, oid) {
  if (v === null || v === undefined) return 'NULL';
  if (oid === OID_BOOL) return v ? '1' : '0';
  if (OID_NUM.has(oid)) return String(v);                    // texto crudo, sin comillas
  if (OID_DATE.has(oid)) return fmtDate(String(v));
  if (OID_JSON.has(oid)) return qstr(JSON.stringify(v));     // json / jsonb (objeto, arreglo o escalar)
  if (typeof v === 'object') return qstr(JSON.stringify(v)); // arreglo de Postgres (text[], uuid[]...)
  return qstr(String(v));
}

const { Client } = pg;
const client = new Client({
  connectionString: PG_URL,
  ssl: /supabase\.(co|com)/.test(PG_URL) ? { rejectUnauthorized: false } : undefined,
});

await client.connect();
await client.query("SET TIME ZONE 'UTC'");

const { rows: tblRows } = await client.query(
  "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name");
const allTables = tblRows.map(r => r.table_name);
const ordered = [...ORDER.filter(t => allTables.includes(t)),
                 ...allTables.filter(t => !ORDER.includes(t))];

const out = [
  '/* ═══════════════════════════════════════════════════════════════════════════',
  ' * GESTEK · Volcado de la base de Supabase — 03 · DATOS',
  ` * Generado por db/esquema/generar-datos.mjs el ${new Date().toISOString().slice(0, 10)}.`,
  ' *',
  ' * ⚠️ DATOS PERSONALES DE PRODUCCIÓN. Trátese como el .env.',
  ' *    Repo privado. Para pruebas, mejor un volcado anonimizado.',
  ' *',
  ' * NO incluye auth.users (los usuarios van en 001_identidad.sql). profiles sí,',
  ' * con su mismo id.',
  ' * ═══════════════════════════════════════════════════════════════════════════ */',
  '',
  'SET NAMES utf8mb4;',
  "SET time_zone = '+00:00';",
  'SET FOREIGN_KEY_CHECKS = 0;',
  'SET UNIQUE_CHECKS = 0;',
  '',
];

let total = 0, conDatos = 0;
for (const t of ordered) {
  const res = await client.query(`select * from public."${t}"`);
  if (res.rows.length === 0) { out.push(`-- ${t} (0)`); continue; }
  const fields = res.fields;                       // [{ name, dataTypeID }]
  const colList = fields.map(f => '`' + f.name + '`').join(', ');
  out.push(`-- ${t} (${res.rows.length})`);
  const CHUNK = 200;
  for (let i = 0; i < res.rows.length; i += CHUNK) {
    out.push('INSERT INTO `' + t + '` (' + colList + ') VALUES');
    out.push(res.rows.slice(i, i + CHUNK)
      .map(r => '(' + fields.map(f => val(r[f.name], f.dataTypeID)).join(', ') + ')')
      .join(',\n') + ';');
  }
  out.push('');
  total += res.rows.length;
  conDatos++;
  console.error(`  ${t.padEnd(32)} ${res.rows.length}`);
}

out.push('SET UNIQUE_CHECKS = 1;', 'SET FOREIGN_KEY_CHECKS = 1;', '',
  `/* ${total} filas en ${conDatos} tablas. */`);

fs.writeFileSync(DST, out.join('\n'));
await client.end();
console.error(`\nOK -> db/esquema/03_datos.sql  (${total} filas, ${conDatos} tablas)`);
