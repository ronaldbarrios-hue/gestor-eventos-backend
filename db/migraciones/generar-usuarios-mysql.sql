/* generar-usuarios-mysql.sql — pasa las cuentas de Supabase a `gestek_auth`.
 *
 * ══ CÓMO SE USA ═════════════════════════════════════════════════════════
 *
 *   1. Se pega ENTERO en el editor SQL de Supabase y se ejecuta.
 *   2. Devuelve una fila por sentencia, en la columna `ddl`.
 *   3. Se copian esas filas en orden y se pegan en **`gestek_auth`**.
 *
 * Es de **sólo lectura**: no crea, no borra y no toca ni una fila.
 *
 * ══ POR QUÉ UN GENERADOR Y NO UN ARCHIVO YA ESCRITO ═════════════════════
 *
 * Porque aquí van **hashes de contraseña**. Un archivo con hashes dentro se
 * queda en el repositorio, en el historial de git y en el portapapeles de
 * quien lo abra. Este archivo no tiene ni uno: los hashes sólo existen en la
 * pantalla de quien lo ejecuta y en el destino.
 *
 * Y hay un segundo motivo: la gente sigue registrándose. Un volcado hecho hoy
 * está viejo mañana. Esto se vuelve a correr el día del corte y ya.
 *
 * ══ LO QUE HAY QUE SABER ANTES ══════════════════════════════════════════
 *
 * **El hash se copia tal cual, y por eso funciona.** Supabase guarda bcrypt, y
 * `modules/auth/servicio.js` compara con `bcryptjs`. Es el mismo formato
 * (`$2a$`/`$2b$`), así que las contraseñas siguen sirviendo sin que nadie
 * tenga que cambiarla. Si el hash se transformara —o se recortara al copiar—
 * nadie podría entrar, y el síntoma sería «contraseña incorrecta» para todo el
 * mundo a la vez.
 *
 * **Quien entra con Google no tiene contraseña**, y su `password_hash` queda
 * NULL a propósito. Una cadena vacía sería un hash que bcrypt rechaza siempre,
 * pero que se confunde con «no configurada».
 *
 * **El emparejamiento con Google es por `sub`, no por correo.** Quien cambie
 * su dirección en Google conserva su cuenta. Emparejar por correo es el fallo
 * clásico: la persona entra y se encuentra una cuenta vacía.
 *
 * ── Lo que hay hoy, medido el 4 de septiembre de 2026 ───────────────────
 *
 *   | 29 | cuentas vivas                                   |
 *   | 10 | entran con contraseña                           |
 *   | 22 | entran con Google                               |
 *   |  0 | **sin ninguna forma de entrar**                 |
 *
 * Ese último cero es el que decide si se puede encender `AUTH_PROPIA`. Si
 * alguna vez sale distinto de cero, esas personas necesitan un «olvidé mi
 * contraseña» ANTES del corte, no después: el día del corte ya no tienen a
 * quién pedírselo.
 *
 * (10 + 22 = 32 > 29 a propósito: hay quien tiene las dos cosas.)
 *
 * **`AUTH_PROPIA` sigue apagado** mientras tanto. Esto sólo llena la tabla; el
 * día que se encienda, la gente ya está dentro. Al revés —encender primero y
 * migrar después— es dejar a todo el mundo fuera.
 */

/* ── 1 · Las cuentas ──────────────────────────────────────────────────────
 *
 * `quote_literal` escapa las comillas. Encima va un `replace` que DUPLICA las
 * barras invertidas, y eso no es de adorno: **Postgres y MySQL no las tratan
 * igual**. Para Postgres una `\` dentro de una cadena es una barra y ya; MySQL
 * la lee como un escape y se la come. Un nombre con `\` o un JSON con una
 * barra dentro llegarían distintos a los dos lados, y el fallo saldría en una
 * fila de mil — la peor forma de descubrirlo.
 *
 * Escapar a mano con `replace(x, '''', '''''')` es de donde salen los volcados
 * que fallan en la fila 400 por un apóstrofo en un nombre. Por eso el escapado
 * de comillas se deja en `quote_literal` y sólo se añade lo que le falta.
 *
 * Se saltan los borrados (`deleted_at`) y los anónimos: no son cuentas.
 *
 * `INSERT IGNORE` para poder correrlo dos veces sin duplicar. La segunda vez
 * NO actualiza a los que ya estaban — si hace falta refrescar a alguien, se
 * borra su fila y se vuelve a correr.
 */
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

/* ── 2 · Las identidades externas ─────────────────────────────────────────
 *
 * Una fila por proveedor y cuenta. Hoy sólo hay `google`.
 *
 * `provider_id` es el `sub` de Google. Va tal cual: es lo que empareja a la
 * persona con su cuenta la próxima vez que entre.
 *
 * Se filtra `provider <> 'email'` porque esa «identidad» no es un proveedor
 * externo — es la propia cuenta con contraseña, que ya viaja arriba.
 */
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

/* ══ COMPROBACIÓN ════════════════════════════════════════════════════════
 *
 * Antes, en Postgres — cuántas tendrían que salir:
 *
 *   select count(*) filter (where deleted_at is null and email is not null) as cuentas
 *     from auth.users;
 *   select count(*) from auth.identities where provider <> 'email';
 *
 * Después, en `gestek_auth` — que cuadren:
 *
 *   SELECT COUNT(*) FROM usuarios;
 *   SELECT COUNT(*) FROM usuario_identidades;
 *
 * Y las dos que dicen si de verdad va a poder entrar la gente:
 *
 *   SELECT COUNT(*) FROM usuarios WHERE password_hash IS NOT NULL;
 *     -- los que entran con contraseña
 *   SELECT COUNT(*) FROM usuarios u
 *     WHERE u.password_hash IS NULL
 *       AND NOT EXISTS (SELECT 1 FROM usuario_identidades i WHERE i.usuario_id = u.id);
 *     -- TIENE QUE SER 0. Cualquiera aquí no tiene contraseña NI proveedor:
 *     -- el día del corte no puede entrar por ningún camino.
 *
 * Esa última es la que hay que mirar antes de encender `AUTH_PROPIA`. Si sale
 * distinta de cero, esas personas necesitan un «olvidé mi contraseña» antes,
 * no después.
 *
 * ══ LO QUE ESTE ARCHIVO NO HACE ═════════════════════════════════════════
 *
 * No toca `profiles`. Los perfiles —nombre, avatar, empresa, plan— van en
 * `gestek_datos` con el resto de los datos, y se pasan con el volcado normal.
 * Aquí sólo va lo que hace falta para ENTRAR.
 *
 * Tampoco copia `last_sign_in_at`, `banned_until` ni los tokens de
 * recuperación. Los tokens caducan y arrastrarlos sólo alarga la superficie;
 * quien esté a mitad de un «olvidé mi contraseña» el día del corte lo repite.
 */
