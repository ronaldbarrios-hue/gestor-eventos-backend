'use strict';

/* modules/auth/repositorio.js — el ÚNICO archivo del módulo que escribe SQL.
 *
 * La regla no es de estilo. Cuando llegue el turno de las 71 tablas (§6 del
 * mapa), lo que hay que reescribir por módulo es este archivo y sólo éste: el
 * servicio, las rutas y los correos no saben si debajo hay MySQL, PostgreSQL o
 * un array en memoria. Es también lo que hace que las pruebas del servicio
 * corran sin base — le pasan otro objeto con estos mismos métodos.
 *
 * Las funciones devuelven objetos con nombres nuestros, no filas crudas. Si
 * mañana la columna se llama distinto, se traduce aquí.
 */

const db = require('../../core/db/mysql.js').bd('auth');

/* MySQL 8 devuelve las columnas JSON ya parseadas casi siempre, pero según
   cómo llegue la fila (a través de `execute` con `dateStrings`, o de un driver
   distinto) puede venir como cadena. Aceptar las dos formas cuesta tres líneas
   y evita un `[object Object]` en el nombre del usuario. */
function leerJson(valor) {
  if (valor == null) return {};
  if (typeof valor === 'object') return valor;
  try { return JSON.parse(valor); } catch { return {}; }
}

function aUsuario(fila) {
  if (!fila) return null;
  return {
    id               : fila.id,
    email            : fila.email,
    passwordHash     : fila.password_hash || null,
    emailConfirmado  : Boolean(fila.email_confirmado_at),
    emailConfirmadoAt: fila.email_confirmado_at || null,
    metadata         : leerJson(fila.metadata),
    intentosFallidos : fila.intentos_fallidos || 0,
    bloqueadoHasta   : fila.bloqueado_hasta || null,
  };
}

/* ── Usuarios ──────────────────────────────────────────────────────────── */

async function porEmail(email) {
  return aUsuario(await db.unaFila('SELECT * FROM usuarios WHERE email = ? LIMIT 1', [normalizar(email)]));
}

async function porId(id) {
  return aUsuario(await db.unaFila('SELECT * FROM usuarios WHERE id = ? LIMIT 1', [id]));
}

/* El correo se guarda siempre en minúsculas y sin espacios alrededor. La
   collation ya ignora mayúsculas, pero normalizar antes de escribir hace que lo
   que se lee sea lo que se guardó, y que un `UNIQUE` no dependa de la
   configuración del servidor. */
function normalizar(email) {
  return String(email || '').trim().toLowerCase();
}

async function crear({ id, email, passwordHash, metadata, emailConfirmado }) {
  await db.consultar(
    `INSERT INTO usuarios (id, email, password_hash, metadata, email_confirmado_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      id,
      normalizar(email),
      passwordHash || null,
      JSON.stringify(metadata || {}),
      emailConfirmado ? new Date() : null,
    ]
  );
  return porId(id);
}

async function actualizarPassword(usuarioId, passwordHash) {
  await db.consultar('UPDATE usuarios SET password_hash = ? WHERE id = ?', [passwordHash, usuarioId]);
}

async function actualizarMetadata(usuarioId, metadata) {
  await db.consultar('UPDATE usuarios SET metadata = ? WHERE id = ?', [JSON.stringify(metadata || {}), usuarioId]);
  return porId(usuarioId);
}

async function marcarConfirmado(usuarioId) {
  await db.consultar(
    'UPDATE usuarios SET email_confirmado_at = COALESCE(email_confirmado_at, NOW()) WHERE id = ?',
    [usuarioId]
  );
}

async function marcarAcceso(usuarioId) {
  await db.consultar(
    'UPDATE usuarios SET ultimo_acceso_at = NOW(), intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?',
    [usuarioId]
  );
}

/* El contador sube y, al pasar del tope, se pone la hora de desbloqueo. Se hace
   en una sola sentencia para que dos intentos simultáneos no se pisen: leer,
   sumar y escribir desde Node deja una ventana en la que dos peticiones leen
   el mismo 7 y las dos escriben 8. */
async function sumarIntentoFallido(usuarioId, { maximo, bloqueoMinutos }) {
  await db.consultar(
    `UPDATE usuarios
        SET intentos_fallidos = intentos_fallidos + 1,
            bloqueado_hasta   = IF(intentos_fallidos + 1 >= ?,
                                   DATE_ADD(NOW(), INTERVAL ? MINUTE),
                                   bloqueado_hasta)
      WHERE id = ?`,
    [maximo, bloqueoMinutos, usuarioId]
  );
}

/* ── Identidades ───────────────────────────────────────────────────────── */

async function porIdentidad(proveedor, proveedorId) {
  const fila = await db.unaFila(
    `SELECT u.* FROM usuarios u
       JOIN usuario_identidades i ON i.usuario_id = u.id
      WHERE i.proveedor = ? AND i.proveedor_id = ? LIMIT 1`,
    [proveedor, String(proveedorId)]
  );
  return aUsuario(fila);
}

/* `INSERT IGNORE` porque la carrera existe de verdad: dos pestañas terminando
   el mismo consentimiento de Google a la vez. La segunda choca contra el
   UNIQUE, y que no pase nada es exactamente lo correcto. */
async function enlazarIdentidad({ usuarioId, proveedor, proveedorId, email }) {
  await db.consultar(
    `INSERT IGNORE INTO usuario_identidades (usuario_id, proveedor, proveedor_id, email)
     VALUES (?, ?, ?, ?)`,
    [usuarioId, proveedor, String(proveedorId), normalizar(email) || null]
  );
}

/* ── Sesiones ──────────────────────────────────────────────────────────── */

async function crearSesion({ usuarioId, refreshHash, expiraAt, userAgent, ip }) {
  const r = await db.consultar(
    `INSERT INTO sesiones (usuario_id, refresh_hash, expira_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?)`,
    [usuarioId, refreshHash, expiraAt, (userAgent || '').slice(0, 255) || null, ip || null]
  );
  return { id: r.insertId };
}

async function sesionPorHash(refreshHash) {
  const fila = await db.unaFila('SELECT * FROM sesiones WHERE refresh_hash = ? LIMIT 1', [refreshHash]);
  if (!fila) return null;
  return {
    id            : fila.id,
    usuarioId     : fila.usuario_id,
    expiraAt      : fila.expira_at,
    usadoAt       : fila.usado_at,
    revocadoAt    : fila.revocado_at,
    reemplazadaPor: fila.reemplazada_por,
  };
}

/* La rotación entera, en una transacción: se marca la vieja como usada y
   apuntando a la nueva, y se crea la nueva. Si el proceso muere en medio, el
   usuario se quedaría con un refresco revocado y ninguno nuevo — o sea, fuera
   de la aplicación sin haber hecho nada. */
async function rotarSesion({ sesionVieja, usuarioId, refreshHash, expiraAt, userAgent, ip }) {
  return db.transaccion(async (tx) => {
    const r = await tx.consultar(
      `INSERT INTO sesiones (usuario_id, refresh_hash, expira_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?)`,
      [usuarioId, refreshHash, expiraAt, (userAgent || '').slice(0, 255) || null, ip || null]
    );
    await tx.consultar(
      `UPDATE sesiones SET usado_at = NOW(), revocado_at = NOW(), reemplazada_por = ?
        WHERE id = ?`,
      [r.insertId, sesionVieja]
    );
    return { id: r.insertId };
  });
}

async function revocarSesion(refreshHash) {
  await db.consultar(
    'UPDATE sesiones SET revocado_at = NOW() WHERE refresh_hash = ? AND revocado_at IS NULL',
    [refreshHash]
  );
}

async function revocarTodas(usuarioId) {
  const r = await db.consultar(
    'UPDATE sesiones SET revocado_at = NOW() WHERE usuario_id = ? AND revocado_at IS NULL',
    [usuarioId]
  );
  return r.affectedRows || 0;
}

async function sesionesDe(usuarioId) {
  return db.consultar(
    `SELECT id, creado_at, usado_at, expira_at, user_agent, ip
       FROM sesiones
      WHERE usuario_id = ? AND revocado_at IS NULL AND expira_at > NOW()
      ORDER BY creado_at DESC`,
    [usuarioId]
  );
}

/* ── Tokens de un solo uso ─────────────────────────────────────────────── */

/* Antes de crear uno nuevo se invalidan los anteriores del mismo tipo. Si no,
   pedir tres veces «recuperar contraseña» deja tres enlaces vivos, y el más
   viejo —el que quizá ya vio otra persona— sigue sirviendo. */
async function crearTokenUnUso({ usuarioId, tipo, tokenHash, expiraAt }) {
  await db.transaccion(async (tx) => {
    await tx.consultar(
      'UPDATE tokens_un_uso SET usado_at = NOW() WHERE usuario_id = ? AND tipo = ? AND usado_at IS NULL',
      [usuarioId, tipo]
    );
    await tx.consultar(
      'INSERT INTO tokens_un_uso (usuario_id, tipo, token_hash, expira_at) VALUES (?, ?, ?, ?)',
      [usuarioId, tipo, tokenHash, expiraAt]
    );
  });
}

async function tokenPorHash(tokenHash) {
  const fila = await db.unaFila('SELECT * FROM tokens_un_uso WHERE token_hash = ? LIMIT 1', [tokenHash]);
  if (!fila) return null;
  return {
    id       : fila.id,
    usuarioId: fila.usuario_id,
    tipo     : fila.tipo,
    expiraAt : fila.expira_at,
    usadoAt  : fila.usado_at,
  };
}

/* Devuelve si lo marcó ESTA llamada. Con dos pestañas abriendo el mismo enlace
   a la vez, sólo una debe poder cambiar la contraseña. El `AND usado_at IS
   NULL` hace que la segunda no afecte a ninguna fila y se entere. */
async function marcarTokenUsado(id) {
  const r = await db.consultar('UPDATE tokens_un_uso SET usado_at = NOW() WHERE id = ? AND usado_at IS NULL', [id]);
  return (r.affectedRows || 0) === 1;
}

/* ── Limpieza ──────────────────────────────────────────────────────────── */

/* Para el cron. Sin esto, `sesiones` crece para siempre con filas que ya no
   valen: 7.000 personas en el evento son 7.000 sesiones al día. */
async function limpiarCaducados() {
  const s = await db.consultar('DELETE FROM sesiones WHERE expira_at < DATE_SUB(NOW(), INTERVAL 7 DAY)');
  const t = await db.consultar('DELETE FROM tokens_un_uso WHERE expira_at < DATE_SUB(NOW(), INTERVAL 7 DAY)');
  return { sesiones: s.affectedRows || 0, tokens: t.affectedRows || 0 };
}

module.exports = {
  normalizar,
  porEmail, porId, porIdentidad,
  crear, actualizarPassword, actualizarMetadata, marcarConfirmado, marcarAcceso,
  sumarIntentoFallido,
  enlazarIdentidad,
  crearSesion, sesionPorHash, rotarSesion, revocarSesion, revocarTodas, sesionesDe,
  crearTokenUnUso, tokenPorHash, marcarTokenUsado,
  limpiarCaducados,
};
