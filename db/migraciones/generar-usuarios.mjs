/* generar-usuarios.mjs — corre generar-usuarios-mysql.sql SIN pasar por el
 * editor SQL de Supabase. Usa la misma PG_URL que ya tienes en .env para
 * db/esquema/generar-datos.mjs.
 *
 * Por qué existe: generar-usuarios-mysql.sql se escribió para pegarse en el
 * editor SQL de Supabase, que es acceso de panel (de Juan). Pero las dos
 * consultas que trae son SELECT normales contra `auth.users` / `auth.identities`,
 * y la PG_URL que ya tienes es la del rol postgres del proyecto — ese rol SÍ
 * ve el esquema `auth`. Mismo camino que ya usamos en comparar-bases.js para
 * no depender del panel: conexión directa por PG_URL.
 *
 * Sólo LEE la base. No crea, no borra, no toca una fila en Postgres.
 *
 *   cd gestor-eventos-backend
 *   node --env-file=.env db/migraciones/generar-usuarios.mjs
 *
 * Escribe db/migraciones/salida-usuarios.sql — INSERT con hashes de
 * contraseña de gente real. NO se commitea (está en .gitignore) y NO se pega
 * en el chat: se abre y se pega TAL CUAL en el ejecutor SQL de gestek_auth
 * (phpMyAdmin -> gestek_auth -> SQL), igual que dice el encabezado del .sql
 * original. Lo único que hace falta reportar aquí son los conteos que este
 * script imprime en pantalla — nunca el contenido del archivo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DST = path.join(__dirname, 'salida-usuarios.sql');

const PG_URL = process.env.PG_URL;
if (!PG_URL) {
  console.error('Falta PG_URL en el entorno. Corre con: node --env-file=.env db/migraciones/generar-usuarios.mjs');
  process.exit(1);
}

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

/* Las mismas dos consultas de generar-usuarios-mysql.sql, verbatim. */
const SQL_USUARIOS = `
select 'INSERT IGNORE INTO usuarios (id, email, password_hash, email_confirmado_at, metadata, creado_at) VALUES ('
       || quote_literal(u.id::text) || ', '
       || quote_literal(replace(lower(u.email), '\', '\\')) || ', '
       || coalesce(quote_literal(replace(u.encrypted_password, '\', '\\')), 'NULL') || ', '
       || coalesce(quote_literal(to_char(u.email_confirmed_at, 'YYYY-MM-DD HH24:MI:SS')), 'NULL') || ', '
       || quote_literal(replace(coalesce(u.raw_user_meta_data, '{}'::jsonb)::text, '\', '\\')) || ', '
       || quote_literal(to_char(u.created_at, 'YYYY-MM-DD HH24:MI:SS'))
       || ');' as ddl
  from auth.users u
 where u.deleted_at is null
   and coalesce(u.is_anonymous, false) = false
   and u.email is not null
 order by u.created_at;
`;

const SQL_IDENTIDADES = `
select 'INSERT IGNORE INTO usuario_identidades (usuario_id, proveedor, proveedor_id, email, creado_at) VALUES ('
       || quote_literal(i.user_id::text) || ', '
       || quote_literal(i.provider) || ', '
       || quote_literal(replace(i.provider_id, '\', '\\')) || ', '
       || coalesce(quote_literal(replace(lower(i.email), '\', '\\')), 'NULL') || ', '
       || quote_literal(to_char(i.created_at, 'YYYY-MM-DD HH24:MI:SS'))
       || ');' as ddl
  from auth.identities i
  join auth.users u on u.id = i.user_id
 where i.provider <> 'email'
   and u.deleted_at is null
 order by i.created_at;
`;

/* La comprobación que trae el .sql original, en el mismo Postgres: cuántas
 * cuentas hay y cuántas de ellas NO podrían entrar por ningún camino. Ese
 * último número tiene que dar 0 antes de encender AUTH_PROPIA (que sigue
 * apagado; esto sólo llena la tabla, no enciende nada). */
const SQL_CONTEO_PG = `
select
  count(*) filter (where deleted_at is null and coalesce(is_anonymous, false) = false and email is not null) as cuentas
from auth.users;
`;
const SQL_CONTEO_IDENT_PG = `select count(*) as identidades from auth.identities where provider <> 'email';`;

try {
  const [rUsuarios, rIdent, rConteo, rConteoIdent] = await Promise.all([
    pool.query(SQL_USUARIOS),
    pool.query(SQL_IDENTIDADES),
    pool.query(SQL_CONTEO_PG),
    pool.query(SQL_CONTEO_IDENT_PG),
  ]);

  const lineas = [
    '-- generado por generar-usuarios.mjs — pegar TAL CUAL en gestek_auth (SQL)',
    '-- ' + new Date().toISOString(),
    'SET FOREIGN_KEY_CHECKS = 0;',
    '',
    '-- usuarios',
    ...rUsuarios.rows.map(r => r.ddl),
    '',
    '-- usuario_identidades',
    ...rIdent.rows.map(r => r.ddl),
    '',
    'SET FOREIGN_KEY_CHECKS = 1;',
    '',
  ];

  fs.writeFileSync(DST, lineas.join('\n'), { mode: 0o600 });

  console.log(`\n✅ Escrito ${path.relative(process.cwd(), DST)}`);
  console.log(`   ${rUsuarios.rows.length} cuenta(s), ${rIdent.rows.length} identidad(es) externa(s).`);
  console.log(`   (En Postgres ahora mismo: ${rConteo.rows[0].cuentas} cuentas, ${rConteoIdent.rows[0].identidades} identidades — deben cuadrar con lo de arriba.)`);
  console.log('\n   Siguiente paso — SIN pegarme el contenido del archivo:');
  console.log('   1. Abre el archivo en tu editor (no en el chat).');
  console.log('   2. Cópialo entero y pégalo en phpMyAdmin -> gestek_auth -> pestaña SQL -> Continuar.');
  console.log('   3. Aquí sólo dime si corrió bien o si dio algún error (el texto del error, no el SQL).');
  console.log('\n   Después, para confirmar que todos puedan entrar, corre esto en gestek_auth y dime el número:');
  console.log('   SELECT COUNT(*) FROM usuarios u WHERE u.password_hash IS NULL');
  console.log('     AND NOT EXISTS (SELECT 1 FROM usuario_identidades i WHERE i.usuario_id = u.id);');
  console.log('   -- tiene que dar 0. AUTH_PROPIA sigue apagada; esto no la enciende.\n');
} catch (err) {
  console.error('\n❌ Error leyendo Postgres:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
