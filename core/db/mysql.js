'use strict';

/* core/db/mysql.js — la única conexión a MySQL de todo el backend.
 *
 * ── Por qué un archivo y no un `require('mysql2')` en cada módulo ──────────
 *
 * Hoy hay 38 archivos de rutas que hablan con la base cada uno a su manera. Ese
 * es exactamente el problema que hace cara la migración: cambiar de motor
 * obliga a tocarlos todos. La regla nueva es que el motor se toca aquí, y los
 * módulos piden por `repositorio.js`. Si mañana esto fuera PostgreSQL otra vez,
 * o un pool distinto, se cambia este archivo.
 *
 * ── Por qué el pool se crea tarde ─────────────────────────────────────────
 *
 * `mysql2` se carga la primera vez que alguien consulta, no al importar. Dos
 * razones concretas:
 *
 *   1. El backend de hoy arranca sin MySQL —todo sigue en Supabase— y no puede
 *      caerse porque falte una variable de una base que aún no existe.
 *   2. Las pruebas no montan ninguna base. Si el pool se creara al importar,
 *      cada `require` del módulo de auth abriría sockets contra un servidor que
 *      no está y las pruebas tardarían el timeout entero en fallar.
 *
 * ── El acento y las tildes ────────────────────────────────────────────────
 *
 * `utf8mb4` en la conexión, no sólo en las tablas. El servidor de cPanel viene
 * en `utf8mb3` por defecto (medido: MySQL 8.0.46, `character_set_server` =
 * utf8mb3), y una conexión en utf8mb3 escribe basura en columnas utf8mb4 sin
 * dar ningún error. Se descubre semanas después, cuando alguien busca «Bogotá»
 * y no aparece.
 */

const config = require('../config');

let _pool = null;
let _mysql = null;

function mysql() {
  if (!_mysql) _mysql = require('mysql2/promise');
  return _mysql;
}

/* ¿Hay base configurada? Sirve para que el arranque y los scripts digan algo
   útil en vez de reventar con un ECONNREFUSED sin contexto. */
function configurada() {
  return Boolean(config.MYSQL_HOST && config.MYSQL_USER && config.MYSQL_DATABASE);
}

function pool() {
  if (_pool) return _pool;

  if (!configurada()) {
    throw new Error(
      'MySQL no está configurado. Faltan MYSQL_HOST, MYSQL_USER o MYSQL_DATABASE. ' +
      'Ver CONFIGURAR.md.'
    );
  }

  _pool = mysql().createPool({
    host    : config.MYSQL_HOST,
    port    : config.MYSQL_PORT,
    user    : config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    database: config.MYSQL_DATABASE,

    /* En cPanel la conexión va por socket local: no hay red de por medio y el
       socket es más rápido y no gasta puertos. Si no se define, se usa host. */
    socketPath: config.MYSQL_SOCKET || undefined,

    charset       : 'utf8mb4_unicode_ci',
    timezone      : 'Z',
    /* Hosting compartido: el límite de conexiones simultáneas de la cuenta es
       bajo y se comparte con phpMyAdmin y con los cron. Diez es holgado para el
       tráfico medido (1.170 peticiones en 24 h) y deja sitio a lo demás. */
    connectionLimit   : config.MYSQL_POOL_MAX,
    waitForConnections: true,
    queueLimit        : 0,
    enableKeepAlive   : true,

    /* Las fechas se devuelven como string y se convierten donde haga falta.
       Con `dateStrings` en false, mysql2 crea objetos Date en la zona del
       proceso y las horas de los eventos se desplazan al pasar por JSON. */
    dateStrings: true,
  });

  return _pool;
}

/* ── La superficie que usan los repositorios ──────────────────────────── */

/* Consulta con parámetros. SIEMPRE con `?`: concatenar valores en el SQL es
   como se inyecta, y aquí no hay excepciones «porque el valor viene de dentro».
   `execute` usa sentencias preparadas, que además el servidor cachea. */
async function consultar(sql, params = []) {
  const [filas] = await pool().execute(sql, params);
  return filas;
}

/* La primera fila o null. Casi todas las lecturas de auth son de una fila y
   escribir `filas[0] || null` en cada sitio invita a olvidarlo una vez. */
async function unaFila(sql, params = []) {
  const filas = await consultar(sql, params);
  return filas.length ? filas[0] : null;
}

/* Ejecuta varias sentencias como una sola operación.
 *
 * Importa más de lo que parece en auth: al rotar un refresco hay que revocar el
 * viejo y crear el nuevo. Si el proceso se cae entre las dos, el usuario se
 * queda sin sesión sin haber hecho nada. Dentro de una transacción, o pasan las
 * dos o no pasa ninguna.
 */
async function transaccion(fn) {
  const conexion = await pool().getConnection();
  try {
    await conexion.beginTransaction();
    const resultado = await fn({
      consultar: async (sql, params = []) => {
        const [filas] = await conexion.execute(sql, params);
        return filas;
      },
      unaFila: async (sql, params = []) => {
        const [filas] = await conexion.execute(sql, params);
        return filas.length ? filas[0] : null;
      },
    });
    await conexion.commit();
    return resultado;
  } catch (e) {
    /* Si el rollback también falla (conexión muerta), el error que interesa es
       el primero, no el del rollback. */
    try { await conexion.rollback(); } catch { /* la conexión ya no sirve */ }
    throw e;
  } finally {
    conexion.release();
  }
}

/* Para los scripts y para las pruebas de integración: cerrar el pool deja que
   el proceso termine en vez de quedarse colgado con sockets abiertos. */
async function cerrar() {
  if (_pool) {
    const p = _pool;
    _pool = null;
    await p.end();
  }
}

/* Comprobación de vida, para `/health` y para `comprobar-base.js`. Devuelve el
   juego de caracteres real de la conexión, que es el error silencioso más caro
   de los que se pueden cometer aquí. */
async function estado() {
  const fila = await unaFila(
    "SELECT VERSION() AS version, @@character_set_connection AS charset, DATABASE() AS base"
  );
  return fila;
}

module.exports = { consultar, unaFila, transaccion, cerrar, estado, configurada, pool };
