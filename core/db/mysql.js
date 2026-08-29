'use strict';

/* core/db/mysql.js — las conexiones a MySQL de todo el backend.
 *
 * ── Dos bases, no una ─────────────────────────────────────────────────────
 *
 *   `auth`   quién es cada persona: cuentas, identidades de Google, sesiones,
 *            tokens de un solo uso. Nada más.
 *   `datos`  todo lo demás: eventos, boletas, asistentes, archivos.
 *
 * Están separadas a propósito, y no es una preferencia de estilo:
 *
 *   · La cuenta de cPanel admite dos bases, así que el reparto no cuesta nada
 *     y ordena lo que viene.
 *   · Un volcado de `datos` —para llevárselo a un análisis, para una copia que
 *     se comparte, para depurar un evento— no lleva dentro ni un hash de
 *     contraseña ni una sesión viva.
 *   · Las 71 tablas se migran módulo a módulo y en meses; la identidad ya está
 *     escrita. Compartiendo base, cada paso de aquélla habría tenido que
 *     esquivar a ésta.
 *
 * Si `datos` no está configurada, se usa la de `auth`. Es lo que hace que hoy,
 * con una sola base creada, todo funcione igual y el reparto se pueda hacer el
 * día que toque sin tocar una línea de código.
 *
 * ── Por qué un archivo y no un `require('mysql2')` en cada módulo ─────────
 *
 * Hoy hay 38 archivos de rutas que hablan con la base cada uno a su manera. Ese
 * es exactamente el problema que hace cara la migración: cambiar de motor
 * obliga a tocarlos todos. La regla nueva es que el motor se toca aquí, y los
 * módulos piden por `repositorio.js`.
 *
 * ── Por qué los pools se crean tarde ──────────────────────────────────────
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

const NOMBRES = ['auth', 'datos'];

let _mysql = null;
const _pools = new Map();

function mysql() {
  if (!_mysql) _mysql = require('mysql2/promise');
  return _mysql;
}

/* Los ajustes de una base. `datos` cae a los de `auth` campo a campo: en cPanel
   las dos bases viven en el mismo servidor y con el mismo usuario, y lo único
   que suele cambiar es el nombre. */
function ajustes(nombre) {
  if (nombre === 'datos') {
    return {
      host    : config.MYSQL_DATOS_HOST     || config.MYSQL_HOST,
      port    : config.MYSQL_DATOS_PORT     || config.MYSQL_PORT,
      user    : config.MYSQL_DATOS_USER     || config.MYSQL_USER,
      password: config.MYSQL_DATOS_PASSWORD ?? config.MYSQL_PASSWORD,
      database: config.MYSQL_DATOS_DATABASE || config.MYSQL_DATABASE,
      socket  : config.MYSQL_DATOS_SOCKET   || config.MYSQL_SOCKET,
    };
  }
  return {
    host    : config.MYSQL_HOST,
    port    : config.MYSQL_PORT,
    user    : config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    database: config.MYSQL_DATABASE,
    socket  : config.MYSQL_SOCKET,
  };
}

function poolDe(nombre) {
  if (_pools.has(nombre)) return _pools.get(nombre);

  const a = ajustes(nombre);
  if (!a.host || !a.user || !a.database) {
    throw new Error(
      `MySQL (${nombre}) no está configurado. Faltan MYSQL_HOST, MYSQL_USER o ` +
      'MYSQL_DATABASE. Ver CONFIGURAR.md.'
    );
  }

  const pool = mysql().createPool({
    host    : a.host,
    port    : a.port,
    user    : a.user,
    password: a.password,
    database: a.database,

    /* En cPanel la conexión va por socket local: no hay red de por medio y el
       socket es más rápido y no gasta puertos. Si no se define, se usa host. */
    socketPath: a.socket || undefined,

    charset       : 'utf8mb4_unicode_ci',
    /* `timezone: 'Z'` es del DRIVER: le dice a mysql2 cómo convertir entre
       Date de JavaScript y DATETIME. No toca la zona de la SESIÓN de MySQL, que
       es otra cosa y la que usan las funciones de fecha del propio motor
       —`UNIX_TIMESTAMP`, `NOW`, `CONVERT_TZ`—.

       Hacen falta las dos. El esquema guarda todo en UTC (ver la decisión de
       `DATETIME(6)` en NOTAS-ESQUEMA), así que si la sesión heredara la zona
       del servidor —en cPanel suele ser la del país— `UNIX_TIMESTAMP` leería
       esas fechas como si fueran locales. Las franjas del aforo se calculan
       con eso: el pico de las 8 de la noche saldría a las 3 de la tarde, y
       nada fallaría de forma visible. */
    timezone      : 'Z',
    /* Hosting compartido: el límite de conexiones simultáneas de la cuenta es
       bajo y se comparte con phpMyAdmin y con los cron. El tope se reparte
       entre las dos bases, que por eso no se suman: diez en total, no diez
       cada una. */
    connectionLimit   : Math.max(2, Math.floor(config.MYSQL_POOL_MAX / NOMBRES.length)),
    waitForConnections: true,
    queueLimit        : 0,
    enableKeepAlive   : true,

    /* Las fechas se devuelven como string y se convierten donde haga falta.
       Con `dateStrings` en false, mysql2 crea objetos Date en la zona del
       proceso y las horas de los eventos se desplazan al pasar por JSON. */
    dateStrings: true,
  });

  /* La zona de la SESIÓN, en cada conexión nueva del pool. Va aquí y no en una
     consulta suelta porque el pool abre conexiones cuando le hace falta: una
     puesta a mano al arrancar dejaría en UTC sólo la primera, y el resto
     heredaría la del servidor sin que nadie lo note. */
  pool.on('connection', (cx) => {
    cx.query("SET time_zone = '+00:00'", (e) => {
      if (e) console.warn(`[mysql:${nombre}] no se pudo fijar la zona de la sesión:`, e.message);
    });
  });

  _pools.set(nombre, pool);
  return pool;
}

/* ── La superficie que usan los repositorios ──────────────────────────── */

function crearBd(nombre) {
  const pool = () => poolDe(nombre);

  /* Consulta con parámetros. SIEMPRE con `?`: concatenar valores en el SQL es
     como se inyecta, y aquí no hay excepciones «porque el valor viene de
     dentro». `execute` usa sentencias preparadas, que además el servidor
     cachea. */
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
   * Importa más de lo que parece en auth: al rotar un refresco hay que revocar
   * el viejo y crear el nuevo. Si el proceso se cae entre las dos, el usuario
   * se queda sin sesión sin haber hecho nada. Dentro de una transacción, o
   * pasan las dos o no pasa ninguna.
   *
   * Ojo con lo que NO da: una transacción vale para UNA base. Nada que abarque
   * `auth` y `datos` a la vez es atómico, y por eso no hay ninguna operación
   * escrita así — si alguna vez hace falta, se resuelve con un paso que se
   * pueda repetir sin daño, no fingiendo que esto lo cubre.
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
      /* Si el rollback también falla (conexión muerta), el error que interesa
         es el primero, no el del rollback. */
      try { await conexion.rollback(); } catch { /* la conexión ya no sirve */ }
      throw e;
    } finally {
      conexion.release();
    }
  }

  /* ¿Hay base configurada? Sirve para que el arranque y los scripts digan algo
     útil en vez de reventar con un ECONNREFUSED sin contexto. */
  function configurada() {
    const a = ajustes(nombre);
    return Boolean(a.host && a.user && a.database);
  }

  /* Comprobación de vida, para `/health` y para `comprobar-base.js`. Devuelve
     el juego de caracteres real de la conexión, que es el error silencioso más
     caro de los que se pueden cometer aquí. */
  async function estado() {
    return unaFila(
      /* La zona va en la comprobación de vida por lo mismo que el juego de
         caracteres: los dos fallan en silencio y con datos ya escritos. */
      'SELECT VERSION() AS version, @@character_set_connection AS charset, DATABASE() AS base, @@session.time_zone AS zona'
    );
  }

  return { nombre, consultar, unaFila, transaccion, configurada, estado, pool };
}

const bases = { auth: crearBd('auth'), datos: crearBd('datos') };

/* La puerta: `bd('auth')` o `bd('datos')`. Sin argumento, `auth`, que es la que
   ya existía cuando esto tenía una sola base. */
function bd(nombre = 'auth') {
  const elegida = bases[nombre];
  if (!elegida) throw new Error(`No existe la base «${nombre}». Son: ${NOMBRES.join(', ')}.`);
  return elegida;
}

/* ¿Están las dos separadas de verdad, o `datos` está cayendo a la de `auth`?
   Lo pregunta `comprobar-base.js` para poder decirlo en voz alta. */
function separadas() {
  return ajustes('auth').database !== ajustes('datos').database;
}

/* Para los scripts y las pruebas de integración: cerrar los pools deja que el
   proceso termine en vez de quedarse colgado con sockets abiertos. */
async function cerrar() {
  const abiertos = [..._pools.values()];
  _pools.clear();
  await Promise.all(abiertos.map(p => p.end().catch(() => {})));
}

module.exports = {
  bd, bases, separadas, cerrar, NOMBRES, ajustes,
  /* Atajos a `auth`, que es como se usaba esto cuando había una sola base.
     Se mantienen para no tocar lo que ya funcionaba. */
  consultar : (...a) => bases.auth.consultar(...a),
  unaFila   : (...a) => bases.auth.unaFila(...a),
  transaccion: (...a) => bases.auth.transaccion(...a),
  configurada: (...a) => bases.auth.configurada(...a),
  estado    : (...a) => bases.auth.estado(...a),
};
