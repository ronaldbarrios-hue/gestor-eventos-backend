#!/usr/bin/env node
'use strict';

/* scripts/comprobar-base.js — ¿está la base como tiene que estar?
 *
 * Se corre después de crear la base y aplicar `db/migraciones/001_identidad.sql`,
 * y otra vez después de migrar las cuentas. Tarda un segundo y evita las tres
 * formas conocidas de perder una tarde:
 *
 *   1. La base creada en utf8mb3 porque en cPanel no se elige juego de
 *      caracteres. No da ningún error: escribe las tildes mal y se descubre
 *      semanas después, cuando alguien busca «Bogotá».
 *   2. Las migraciones a medias — una tabla creada y otra no.
 *   3. Hashes que no son bcrypt, que es una persona que no puede entrar y que
 *      no se entera hasta que lo intenta.
 *
 * No escribe nada. Se puede correr en producción.
 */

const mysql = require('../core/db/mysql.js');
const config = require('../core/config');

const db = mysql.bd('auth');
const datos = mysql.bd('datos');

/* Cada base con lo suyo: la identidad en `auth`, las fichas de archivos —y con
   el tiempo, las 71 tablas— en `datos`. */
const TABLAS = ['usuarios', 'usuario_identidades', 'sesiones', 'tokens_un_uso'];
const TABLAS_DATOS = ['archivos'];

let fallos = 0;
const ok    = (t) => console.log(`   ✓ ${t}`);
const mal   = (t) => { fallos += 1; console.log(`   ✗ ${t}`); };
const aviso = (t) => console.log(`   ⚠ ${t}`);

async function main() {
  console.log('\n── Conexión ──────────────────────────────────────────────');

  if (!db.configurada()) {
    console.log('   ✗ Falta MYSQL_HOST, MYSQL_USER o MYSQL_DATABASE. Ver CONFIGURAR.md.\n');
    process.exitCode = 1;
    return;
  }

  const estado = await db.estado();
  ok(`MySQL ${estado.version}, base de identidad «${estado.base}»`);

  /* Las dos bases o una sola. Que `datos` caiga a la de `auth` no es un fallo
     —así arranca todo hasta que se cree la segunda— pero conviene decirlo en
     voz alta: mientras compartan base, un volcado de los datos del evento
     lleva dentro los hashes de contraseña. */
  if (mysql.separadas()) {
    const e2 = await datos.estado();
    ok(`base de datos del evento «${e2.base}», separada de la identidad`);
  } else {
    aviso('`datos` y `auth` son la MISMA base: todavía no se creó la segunda.');
    console.log('     Funciona igual, pero un volcado de los datos lleva dentro los hashes.');
    console.log('     Se separan poniendo MYSQL_DATOS_DATABASE. Ver CONFIGURAR.md.');
  }

  /* El error silencioso. La conexión tiene su propio juego de caracteres, y una
     conexión utf8mb3 escribe basura en columnas utf8mb4 sin quejarse. */
  if (String(estado.charset).startsWith('utf8mb4')) ok(`conexión en ${estado.charset}`);
  else mal(`la conexión va en ${estado.charset}, no en utf8mb4 — las tildes y los emoji se guardarán mal`);

  const base = await db.unaFila(
    `SELECT DEFAULT_CHARACTER_SET_NAME AS cs, DEFAULT_COLLATION_NAME AS col
       FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()`
  );
  if (String(base?.cs).startsWith('utf8mb4')) ok(`base en ${base.cs} / ${base.col}`);
  else mal(`la base está en ${base?.cs} — arreglar con: ALTER DATABASE \`${estado.base}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);

  console.log('\n── Tablas ────────────────────────────────────────────────');

  /* Los `?` se arman según cuántas tablas haya: escribirlos a mano es lo que
     hace que añadir una tabla a la lista rompa la consulta en silencio. */
  const huecos = (lista) => lista.map(() => '?').join(', ');

  const presentes = (await db.consultar(
    `SELECT TABLE_NAME AS nombre, TABLE_COLLATION AS col
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${huecos(TABLAS)})`,
    TABLAS
  ));
  const porNombre = new Map(presentes.map(t => [t.nombre, t]));

  for (const t of TABLAS) {
    const fila = porNombre.get(t);
    if (!fila) { mal(`falta la tabla ${t} — aplicar db/migraciones/001_identidad.sql`); continue; }
    if (!String(fila.col).startsWith('utf8mb4')) mal(`${t} está en ${fila.col}, no en utf8mb4`);
    else ok(`${t}`);
  }

  /* Las de la otra base. Si `archivos` no está, el almacén propio no puede
     registrar nada: se sube el archivo y se queda sin ficha, que es
     exactamente el huérfano que este trabajo vino a eliminar. */
  const enDatos = await datos.consultar(
    `SELECT TABLE_NAME AS nombre, TABLE_COLLATION AS col
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${huecos(TABLAS_DATOS)})`,
    TABLAS_DATOS,
  ).catch(() => []);
  const datosPorNombre = new Map(enDatos.map(t => [t.nombre, t]));

  for (const t of TABLAS_DATOS) {
    const fila = datosPorNombre.get(t);
    if (!fila) {
      if (config.ARCHIVOS_PROPIOS) mal(`falta la tabla ${t} — aplicar db/migraciones/002_archivos.sql`);
      else aviso(`falta la tabla ${t}, pero ARCHIVOS_PROPIOS está apagado: por ahora da igual`);
      continue;
    }
    if (!String(fila.col).startsWith('utf8mb4')) mal(`${t} está en ${fila.col}, no en utf8mb4`);
    else ok(`${t} (en la base de datos del evento)`);
  }

  if (fallos) {
    console.log('\n✗ La base no está lista. Arreglar lo de arriba y volver a correr.\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n── Datos ─────────────────────────────────────────────────');

  const n = await db.unaFila(
    `SELECT
       (SELECT COUNT(*) FROM usuarios)                                        AS usuarios,
       (SELECT COUNT(*) FROM usuarios WHERE password_hash IS NOT NULL)        AS con_password,
       (SELECT COUNT(*) FROM usuarios WHERE email_confirmado_at IS NOT NULL)  AS confirmados,
       (SELECT COUNT(*) FROM usuario_identidades WHERE proveedor = 'google')  AS google,
       (SELECT COUNT(*) FROM sesiones WHERE revocado_at IS NULL AND expira_at > NOW()) AS sesiones_vivas`
  );

  console.log(`   usuarios            ${n.usuarios}`);
  console.log(`   con contraseña      ${n.con_password}`);
  console.log(`   confirmados         ${n.confirmados}`);
  console.log(`   identidades Google  ${n.google}`);
  console.log(`   sesiones vivas      ${n.sesiones_vivas}`);

  if (Number(n.usuarios) === 0) {
    aviso('no hay ninguna cuenta: falta correr scripts/migrar-usuarios-a-mysql.js');
  }

  /* Un hash que no sea bcrypt es una persona que no va a poder entrar. Se
     cuenta, nunca se imprime: un hash en el registro del servidor es material
     para probar contraseñas sin límite y sin que nadie lo vea. */
  const raros = await db.unaFila(
    `SELECT COUNT(*) AS n FROM usuarios
      WHERE password_hash IS NOT NULL AND password_hash NOT LIKE '$2%'`
  );
  if (Number(raros.n) === 0) ok('todos los hashes son bcrypt');
  else mal(`${raros.n} hash(es) que no son bcrypt: esas personas no podrán entrar`);

  /* Quien no tiene ni contraseña ni identidad externa no puede entrar de
     ninguna manera. Es el descuadre que hay que mirar antes del evento. */
  const sinPuerta = await db.consultar(
    `SELECT u.email FROM usuarios u
      WHERE u.password_hash IS NULL
        AND NOT EXISTS (SELECT 1 FROM usuario_identidades i WHERE i.usuario_id = u.id)`
  );
  if (sinPuerta.length) {
    aviso(`${sinPuerta.length} cuenta(s) sin contraseña y sin identidad externa:`);
    for (const u of sinPuerta) console.log(`     · ${u.email}`);
    console.log('     Sólo pueden entrar por «recuperar contraseña».');
  } else {
    ok('todas las cuentas tienen alguna forma de entrar');
  }

  console.log('\n── Configuración ─────────────────────────────────────────');

  if (config.AUTH_PROPIA) ok('AUTH_PROPIA encendido');
  else aviso('AUTH_PROPIA apagado: el backend sigue usando Supabase Auth');

  if (process.env.JWT_SECRET) ok('JWT_SECRET configurado');
  else mal('falta JWT_SECRET: sin él los tokens no se firman de verdad');

  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_AUTH_REDIRECT) ok('Google configurado');
  else aviso('Google sin configurar: «entrar con Google» quedará apagado');

  console.log(fallos ? '\n✗ Hay cosas que arreglar.\n' : '\n✓ Todo en orden.\n');
  if (fallos) process.exitCode = 1;
}

main()
  .catch((e) => { console.error('\n✗', e.message, '\n'); process.exitCode = 1; })
  .finally(() => mysql.cerrar().catch(() => {}));
