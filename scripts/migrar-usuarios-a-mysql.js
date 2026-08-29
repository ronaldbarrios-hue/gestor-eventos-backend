#!/usr/bin/env node
'use strict';

/* scripts/migrar-usuarios-a-mysql.js — trae las 29 cuentas de Supabase.
 *
 * ── Las dos cosas que no se pueden estropear ──────────────────────────────
 *
 * 1. **Los UUID se conservan exactamente.** Están referenciados por claves
 *    ajenas en todo el esquema y por `profiles.id`. Un UUID nuevo no es «un
 *    usuario con otro identificador»: es un usuario que perdió sus eventos,
 *    sus boletas y su equipo.
 *
 * 2. **Los hashes de contraseña se copian tal cual.** Los 10 que hay son
 *    `$2a$10$…`, bcrypt estándar, y `bcryptjs` los verifica sin tocarlos. Nadie
 *    restablece su contraseña por la migración. Si este script intentara
 *    «mejorar» el hash, haría falta la contraseña en claro, que no existe en
 *    ningún sitio.
 *
 * ── Por qué lee un archivo y no se conecta a Supabase ─────────────────────
 *
 * Los hashes viven en `auth.users`, que la API de Supabase no expone: ni
 * `supabase.from()` (es otro esquema) ni `auth.admin.listUsers()` (devuelve el
 * usuario sin su hash). Sólo se llega por SQL.
 *
 * Así que el volcado se saca a mano, una vez, con esta consulta en el editor
 * SQL de Supabase (o por el MCP), y se guarda en un archivo:
 *
 *   SELECT json_agg(u) FROM (
 *     SELECT
 *       u.id::text,
 *       u.email,
 *       u.encrypted_password,
 *       u.email_confirmed_at,
 *       u.raw_user_meta_data,
 *       COALESCE((
 *         SELECT json_agg(json_build_object(
 *                  'provider', i.provider,
 *                  'sub',      i.identity_data->>'sub',
 *                  'email',    i.identity_data->>'email'))
 *           FROM auth.identities i
 *          WHERE i.user_id = u.id AND i.provider <> 'email'
 *       ), '[]'::json) AS identidades
 *     FROM auth.users u
 *     WHERE u.deleted_at IS NULL
 *   ) u;
 *
 * Ese archivo es, literalmente, las llaves de las 29 cuentas. Se borra en
 * cuanto la migración termina y no se guarda en el repositorio (`.gitignore`
 * ya excluye `*.json` de volcado; comprobarlo antes de nada).
 *
 * ── Cómo se usa ──────────────────────────────────────────────────────────
 *
 *   node scripts/migrar-usuarios-a-mysql.js --archivo volcado.json
 *       Lee, valida y cuenta. NO escribe nada. Es lo primero que hay que
 *       correr, y hay que leer lo que dice antes de seguir.
 *
 *   node scripts/migrar-usuarios-a-mysql.js --archivo volcado.json --aplicar
 *       Escribe. Las cuentas que ya existan en MySQL se saltan: se puede
 *       repetir sin miedo si se corta a mitad.
 */

const fs = require('fs');
const db = require('../core/db/mysql.js');

const args = process.argv.slice(2);
const opcion = (nombre) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? (args[i + 1] || true) : null;
};

const ARCHIVO = opcion('archivo');
const APLICAR = args.includes('--aplicar');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function salir(mensaje) {
  console.error(`\n✗ ${mensaje}\n`);
  process.exit(1);
}

/* Fechas: Postgres las da en ISO, MySQL las quiere sin la Z y sin la T. */
function aFechaMysql(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function main() {
  if (!ARCHIVO || ARCHIVO === true) salir('Falta --archivo <ruta al volcado JSON>. Ver la cabecera de este archivo.');
  if (!fs.existsSync(ARCHIVO)) salir(`No existe el archivo ${ARCHIVO}.`);

  let usuarios;
  try {
    const crudo = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    /* `json_agg` devuelve el array; si se pegó la fila entera, viene envuelto. */
    usuarios = Array.isArray(crudo) ? crudo : (crudo.json_agg || crudo.usuarios || null);
  } catch (e) {
    salir(`El archivo no es JSON válido: ${e.message}`);
  }
  if (!Array.isArray(usuarios)) salir('El archivo no contiene una lista de usuarios.');

  /* ── Validación, antes de tocar nada ─────────────────────────────────── */

  const problemas = [];
  const correosVistos = new Map();
  let conPassword = 0;
  let conGoogle = 0;
  let sinConfirmar = 0;

  for (const u of usuarios) {
    if (!UUID_RE.test(String(u.id || ''))) problemas.push(`UUID con mala pinta: ${u.id}`);
    if (!u.email) problemas.push(`Usuario sin correo: ${u.id}`);

    const correo = String(u.email || '').trim().toLowerCase();
    if (correosVistos.has(correo)) {
      /* En MySQL el correo es UNIQUE. Si Supabase trae dos, la migración
         fallaría a mitad; mejor saberlo antes y decidir cuál se queda. */
      problemas.push(`Correo repetido: ${correo} (${correosVistos.get(correo)} y ${u.id})`);
    }
    correosVistos.set(correo, u.id);

    if (u.encrypted_password) {
      conPassword += 1;
      /* Sólo bcrypt. Si apareciera un hash de otro tipo (argon2, scrypt),
         `bcryptjs` no lo verificaría y esa persona se quedaría fuera sin que
         nadie se enterara hasta que intentara entrar. */
      if (!/^\$2[aby]\$/.test(u.encrypted_password)) {
        problemas.push(`Hash que no es bcrypt: ${correo} (${String(u.encrypted_password).slice(0, 4)}…)`);
      }
    }

    const ids = Array.isArray(u.identidades) ? u.identidades : [];
    if (ids.some(i => i.provider === 'google')) conGoogle += 1;
    for (const i of ids) {
      if (!i.sub) problemas.push(`Identidad de ${i.provider} sin sub: ${correo}`);
    }

    if (!u.email_confirmed_at) sinConfirmar += 1;
  }

  console.log('\n── Lo que trae el volcado ────────────────────────────────');
  console.log(`   usuarios            ${usuarios.length}`);
  console.log(`   con contraseña      ${conPassword}`);
  console.log(`   con Google          ${conGoogle}`);
  console.log(`   sin confirmar       ${sinConfirmar}`);

  /* El descuadre que hay que mirar ANTES de migrar: quien no tiene ni
     contraseña ni identidad externa no puede entrar de ninguna forma. La fila
     se migra igual —sus eventos dependen de ella— pero hay que saber quién es
     para avisarle o darle acceso por recuperación. */
  const huerfanos = usuarios.filter(u => !u.encrypted_password && !(u.identidades || []).length);
  if (huerfanos.length) {
    console.log(`\n   ⚠ ${huerfanos.length} cuenta(s) sin contraseña y sin identidad externa:`);
    for (const u of huerfanos) console.log(`     · ${u.email} (${u.id})`);
    console.log('     Se migran, pero esas personas sólo podrán entrar por «recuperar contraseña».');
  }

  if (problemas.length) {
    console.log('\n── Problemas ─────────────────────────────────────────────');
    for (const p of problemas) console.log(`   ✗ ${p}`);
    salir('Hay que resolver eso antes de migrar. No se escribió nada.');
  }

  if (!APLICAR) {
    console.log('\n✓ El volcado está bien. Nada escrito (falta --aplicar).\n');
    return;
  }

  /* ── Escritura ───────────────────────────────────────────────────────── */

  if (!db.configurada()) salir('MySQL no está configurado. Ver CONFIGURAR.md.');

  let creados = 0;
  let saltados = 0;
  let identidades = 0;

  for (const u of usuarios) {
    const correo = String(u.email).trim().toLowerCase();

    const ya = await db.unaFila('SELECT id FROM usuarios WHERE id = ? OR email = ? LIMIT 1', [u.id, correo]);
    if (ya) { saltados += 1; continue; }

    await db.consultar(
      `INSERT INTO usuarios (id, email, password_hash, email_confirmado_at, metadata, creado_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, NOW()))`,
      [
        u.id,
        correo,
        u.encrypted_password || null,
        aFechaMysql(u.email_confirmed_at),
        JSON.stringify(u.raw_user_meta_data || {}),
        aFechaMysql(u.created_at),
      ]
    );
    creados += 1;

    for (const i of (u.identidades || [])) {
      if (!i.sub) continue;
      await db.consultar(
        `INSERT IGNORE INTO usuario_identidades (usuario_id, proveedor, proveedor_id, email)
         VALUES (?, ?, ?, ?)`,
        [u.id, i.provider, String(i.sub), (i.email || correo).toLowerCase()]
      );
      identidades += 1;
    }
  }

  console.log('\n── Escrito ───────────────────────────────────────────────');
  console.log(`   cuentas creadas     ${creados}`);
  console.log(`   ya estaban          ${saltados}`);
  console.log(`   identidades         ${identidades}`);
  console.log('\n✓ Listo. Ahora: `node scripts/comprobar-base.js` y una entrada de prueba.');
  console.log('  Y borrar el volcado: son las llaves de todas las cuentas.\n');
}

main()
  .catch((e) => { console.error('\n✗', e.message, '\n'); process.exitCode = 1; })
  .finally(() => db.cerrar().catch(() => {}));
