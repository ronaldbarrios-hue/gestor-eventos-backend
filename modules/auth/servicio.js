'use strict';

/* modules/auth/servicio.js — todo lo que decide, sin saber de HTTP ni de SQL.
 *
 * Entra un objeto plano, sale `{ ok, ... }` o `{ error, codigo, status }`. Las
 * rutas se limitan a traducir eso a una respuesta, y el repositorio a filas.
 * Por eso las pruebas de este archivo no montan Express ni MySQL: le pasan un
 * repositorio falso y comprueban las decisiones, que es donde están los fallos
 * que importan.
 *
 * ── La forma del error ────────────────────────────────────────────────────
 *
 * `error` es el texto que ve la persona, en español y sin jerga. `codigo` es
 * para el frontend, que a veces necesita distinguir (`email_no_confirmado`
 * enciende el botón de reenviar). `status` es el HTTP.
 *
 * ── Lo que NO se cuenta ───────────────────────────────────────────────────
 *
 * Ni el login ni la recuperación dicen nunca si un correo está registrado. Con
 * 29 cuentas hoy y 7.000 personas esperadas en el evento, la lista de quién
 * tiene cuenta es justo lo que busca quien prepara un ataque dirigido. La
 * respuesta a «contraseña incorrecta» y a «ese correo no existe» es la misma,
 * palabra por palabra.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../../core/config');
const tokens = require('./tokens.js');
const repositorioReal = require('./repositorio.js');
const correosReales = require('./correos');

/* El coste de bcrypt. 10 es el que traen los 10 hashes que se migran (`$2a$10$`)
   y hay que mantenerlo: subirlo obligaría a rehashear, y rehashear sin conocer
   la contraseña en claro no se puede. Los que entren después de la migración se
   guardan con el mismo coste para que todo el fichero sea homogéneo. */
const COSTE_BCRYPT = 10;

/* Hash de una contraseña que no existe. Se compara contra él cuando el correo
   no está registrado, para que responder tarde lo mismo en los dos casos: sin
   esto, «no existe» contesta en 1 ms y «contraseña mala» en 80 ms, y esa
   diferencia es una lista de usuarios legible desde fuera. */
const HASH_SEÑUELO = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const MINIMO_PASSWORD = 8;

const err = (mensaje, codigo, status = 400) => ({ error: mensaje, codigo, status });

function crearServicio({
  repo = repositorioReal,
  correos = correosReales,
  ahora = () => new Date(),
} = {}) {

  const enSegundos = (s) => new Date(ahora().getTime() + s * 1000);

  /* La respuesta que espera el frontend (`aSesion` de src/lib/authPropia.js).
     Si esto cambia, cambia también allí, y son los dos únicos sitios. */
  async function abrirSesion(usuario, { userAgent, ip } = {}) {
    const refresco = tokens.nuevoRefresco();
    await repo.crearSesion({
      usuarioId  : usuario.id,
      refreshHash: refresco.hash,
      expiraAt   : enSegundos(config.VIDA_REFRESH_S),
      userAgent, ip,
    });
    await repo.marcarAcceso(usuario.id);
    return sesionParaCliente(usuario, tokens.emitirAcceso(usuario), refresco.token);
  }

  function sesionParaCliente(usuario, accessToken, refreshToken) {
    return {
      access_token : accessToken,
      refresh_token: refreshToken,
      expires_in   : config.VIDA_ACCESO_S,
      token_type   : 'Bearer',
      usuario      : {
        id             : usuario.id,
        email          : usuario.email,
        metadata       : usuario.metadata || {},
        emailConfirmado: Boolean(usuario.emailConfirmado),
      },
    };
  }

  function validarPassword(password) {
    if (typeof password !== 'string' || password.length < MINIMO_PASSWORD) {
      return err(`La contraseña necesita al menos ${MINIMO_PASSWORD} caracteres.`, 'password_corta');
    }
    /* Sin reglas de mayúsculas y símbolos a propósito: obligan a `Verano2024!`,
       que es peor que una frase larga y termina en un papel pegado al monitor.
       Lo que sí se corta es el tope de bcrypt: pasados 72 bytes, los demás se
       ignoran en silencio, y alguien con una frase larguísima creería tener más
       seguridad de la que tiene. */
    if (Buffer.byteLength(password, 'utf8') > 72) {
      return err('La contraseña no puede pasar de 72 caracteres.', 'password_larga');
    }
    return null;
  }

  function emailValido(email) {
    const e = repo.normalizar(email);
    /* Deliberadamente permisiva. Validar correos con una expresión estricta
       rechaza direcciones legítimas (las de un solo carácter, las de dominios
       nuevos), y el que decide de verdad si existe es el correo de
       confirmación, que hay que abrir. */
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
  }

  /* ── Registro ───────────────────────────────────────────────────────── */

  async function registro({ email, password, metadata }) {
    const correo = emailValido(email);
    if (!correo) return err('Ese correo no tiene buena pinta. Revisalo.', 'email_invalido');

    const falloPassword = validarPassword(password);
    if (falloPassword) return falloPassword;

    const existente = await repo.porEmail(correo);
    if (existente) {
      /* No se dice que ya existe: eso convierte el formulario de registro en un
         comprobador de cuentas. Se manda un aviso a la dirección de verdad —el
         dueño se entera de que alguien intentó registrarla, y quien lo intentó
         no ve nada distinto de un registro normal. */
      await correos.avisarIntentoDeRegistro(existente).catch(() => {});
      return { ok: true, mensaje: 'Revisá tu correo para terminar el registro.' };
    }

    const passwordHash = await bcrypt.hash(password, COSTE_BCRYPT);
    const usuario = await repo.crear({
      id      : crypto.randomUUID(),
      email   : correo,
      passwordHash,
      metadata: metadata || {},
      emailConfirmado: false,
    });

    const t = tokens.nuevoTokenCorreo();
    await repo.crearTokenUnUso({
      usuarioId: usuario.id,
      tipo     : 'confirmacion',
      tokenHash: t.hash,
      expiraAt : enSegundos(config.VIDA_CONFIRMACION_S),
    });
    await correos.confirmacion(usuario, t.token);

    /* Nunca se abre sesión al registrarse: primero se confirma el correo. Es lo
       que `signUp` del frontend espera para enseñar «revisá tu correo». */
    return { ok: true, mensaje: 'Revisá tu correo para terminar el registro.' };
  }

  /* ── Login ──────────────────────────────────────────────────────────── */

  async function login({ email, password, userAgent, ip }) {
    const correo = repo.normalizar(email);
    const usuario = correo ? await repo.porEmail(correo) : null;

    if (!usuario) {
      await bcrypt.compare(String(password || ''), HASH_SEÑUELO);
      return err('Correo o contraseña incorrectos.', 'credenciales', 401);
    }

    if (usuario.bloqueadoHasta && new Date(usuario.bloqueadoHasta) > ahora()) {
      return err(
        'Demasiados intentos fallidos. Probá de nuevo en unos minutos o restablecé tu contraseña.',
        'cuenta_bloqueada', 429
      );
    }

    /* Cuenta que sólo tiene Google: no hay contraseña que comparar. Se contesta
       lo mismo que a una contraseña mala —no se revela cómo entra esa cuenta—
       pero con un código que el frontend puede usar para sugerir el botón de
       Google si quiere. */
    if (!usuario.passwordHash) {
      await bcrypt.compare(String(password || ''), HASH_SEÑUELO);
      return err('Correo o contraseña incorrectos.', 'credenciales', 401);
    }

    const vale = await bcrypt.compare(String(password || ''), usuario.passwordHash);
    if (!vale) {
      await repo.sumarIntentoFallido(usuario.id, {
        maximo        : config.INTENTOS_MAX,
        bloqueoMinutos: config.BLOQUEO_MIN,
      });
      return err('Correo o contraseña incorrectos.', 'credenciales', 401);
    }

    if (!usuario.emailConfirmado) {
      return err('Todavía no confirmaste tu correo. Revisá la bandeja de entrada.', 'email_no_confirmado', 403);
    }

    return { ok: true, sesion: await abrirSesion(usuario, { userAgent, ip }) };
  }

  /* ── Refresco ───────────────────────────────────────────────────────── */

  async function refrescar({ refresh_token, userAgent, ip }) {
    if (!refresh_token) return err('Falta el refresco.', 'sin_refresco', 400);

    const hash = tokens.sha256(refresh_token);
    const sesion = await repo.sesionPorHash(hash);
    if (!sesion) return err('La sesión caducó. Entrá otra vez.', 'sesion_invalida', 401);

    /* Un refresco ya rotado que vuelve a aparecer: o lo tiene el dueño (porque
       una petición se perdió y reintentó) o lo tiene quien lo robó, y desde
       aquí no hay forma de distinguirlo. Se cierran TODAS las sesiones de esa
       cuenta. Es molesto —hay que volver a entrar— y es la única respuesta
       honesta: si no se corta, el ladrón se queda dentro para siempre. */
    if (sesion.revocadoAt || sesion.reemplazadaPor) {
      await repo.revocarTodas(sesion.usuarioId);
      return err('Tu sesión se cerró por seguridad. Entrá otra vez.', 'sesion_reutilizada', 401);
    }

    if (new Date(sesion.expiraAt) < ahora()) {
      return err('La sesión caducó. Entrá otra vez.', 'sesion_caducada', 401);
    }

    const usuario = await repo.porId(sesion.usuarioId);
    if (!usuario) return err('La sesión caducó. Entrá otra vez.', 'sesion_invalida', 401);

    const nuevo = tokens.nuevoRefresco();
    await repo.rotarSesion({
      sesionVieja: sesion.id,
      usuarioId  : usuario.id,
      refreshHash: nuevo.hash,
      expiraAt   : enSegundos(config.VIDA_REFRESH_S),
      userAgent, ip,
    });

    return { ok: true, sesion: sesionParaCliente(usuario, tokens.emitirAcceso(usuario), nuevo.token) };
  }

  /* ── Cerrar sesión ──────────────────────────────────────────────────── */

  async function logout({ refresh_token }) {
    /* Sin refresco no hay nada que revocar, pero se contesta que sí: el cliente
       ya borró su copia y decirle que falló sólo lo dejaría en un estado raro. */
    if (refresh_token) await repo.revocarSesion(tokens.sha256(refresh_token));
    return { ok: true };
  }

  async function cerrarTodas(usuarioId) {
    const cerradas = await repo.revocarTodas(usuarioId);
    return { ok: true, cerradas };
  }

  async function sesionesDe(usuarioId) {
    return { ok: true, sesiones: await repo.sesionesDe(usuarioId) };
  }

  /* ── Correo: confirmar y reenviar ───────────────────────────────────── */

  async function confirmar({ token }) {
    if (!token) return err('Falta el token.', 'sin_token');

    const fila = await repo.tokenPorHash(tokens.sha256(token));
    if (!fila || fila.tipo !== 'confirmacion') {
      return err('Ese enlace no vale. Pedí uno nuevo.', 'token_invalido', 400);
    }
    if (fila.usadoAt) {
      /* Ya usado no es un error para quien lo abre: casi siempre es la misma
         persona pulsando dos veces, o el antivirus del correo que abre los
         enlaces antes que ella. La cuenta ya está confirmada, así que se
         contesta que todo bien. */
      return { ok: true, yaEstaba: true };
    }
    if (new Date(fila.expiraAt) < ahora()) {
      return err('Ese enlace caducó. Pedí uno nuevo desde la pantalla de entrada.', 'token_caducado', 400);
    }

    const marcado = await repo.marcarTokenUsado(fila.id);
    if (!marcado) return { ok: true, yaEstaba: true };

    await repo.marcarConfirmado(fila.usuarioId);
    return { ok: true };
  }

  async function reenviarConfirmacion({ email }) {
    const correo = repo.normalizar(email);
    const usuario = correo ? await repo.porEmail(correo) : null;

    /* Misma respuesta exista o no, y esté confirmado o no. */
    if (usuario && !usuario.emailConfirmado) {
      const t = tokens.nuevoTokenCorreo();
      await repo.crearTokenUnUso({
        usuarioId: usuario.id,
        tipo     : 'confirmacion',
        tokenHash: t.hash,
        expiraAt : enSegundos(config.VIDA_CONFIRMACION_S),
      });
      await correos.confirmacion(usuario, t.token);
    }
    return { ok: true, mensaje: 'Si esa cuenta existe y falta confirmarla, te llegará un correo.' };
  }

  /* ── Recuperar contraseña ───────────────────────────────────────────── */

  async function recuperar({ email }) {
    const correo = repo.normalizar(email);
    const usuario = correo ? await repo.porEmail(correo) : null;

    if (usuario) {
      const t = tokens.nuevoTokenCorreo();
      await repo.crearTokenUnUso({
        usuarioId: usuario.id,
        tipo     : 'recuperacion',
        tokenHash: t.hash,
        expiraAt : enSegundos(config.VIDA_RECUPERACION_S),
      });
      await correos.recuperacion(usuario, t.token);
    }
    return { ok: true, mensaje: 'Si esa cuenta existe, te llegará un correo con el enlace.' };
  }

  async function restablecer({ token, password }) {
    if (!token) return err('Falta el token.', 'sin_token');

    const falloPassword = validarPassword(password);
    if (falloPassword) return falloPassword;

    const fila = await repo.tokenPorHash(tokens.sha256(token));
    if (!fila || fila.tipo !== 'recuperacion') {
      return err('Ese enlace no vale. Pedí uno nuevo.', 'token_invalido', 400);
    }
    if (fila.usadoAt)  return err('Ese enlace ya se usó. Pedí uno nuevo.', 'token_usado', 400);
    if (new Date(fila.expiraAt) < ahora()) {
      return err('Ese enlace caducó. Pedí uno nuevo.', 'token_caducado', 400);
    }

    const marcado = await repo.marcarTokenUsado(fila.id);
    if (!marcado) return err('Ese enlace ya se usó. Pedí uno nuevo.', 'token_usado', 400);

    await repo.actualizarPassword(fila.usuarioId, await bcrypt.hash(password, COSTE_BCRYPT));

    /* Cambiar la contraseña cierra todas las sesiones. Es el motivo por el que
       la gente la cambia: creen que alguien entró. Dejar viva la sesión del
       intruso convierte el gesto en teatro. Quien lo hizo vuelve a entrar con
       la nueva; el otro, no. */
    await repo.revocarTodas(fila.usuarioId);

    /* Recuperar la contraseña prueba que la persona lee ese correo, que es
       exactamente lo que confirma la dirección. Una cuenta que se registró y
       nunca confirmó, pero que recupera desde su bandeja, no tiene por qué
       quedarse fuera. */
    await repo.marcarConfirmado(fila.usuarioId);

    return { ok: true };
  }

  /* ── Cambiar contraseña estando dentro ──────────────────────────────── */

  async function cambiarPassword({ usuarioId, password_actual, password_nueva }) {
    const falloPassword = validarPassword(password_nueva);
    if (falloPassword) return falloPassword;

    const usuario = await repo.porId(usuarioId);
    if (!usuario) return err('No hay sesión activa.', 'sin_sesion', 401);

    /* Si ya tenía contraseña, hay que probar la de antes. Sin esto, un token
       robado durante 30 minutos se convierte en una cuenta perdida para
       siempre: el ladrón cambia la contraseña y el dueño se queda fuera. */
    if (usuario.passwordHash) {
      const vale = await bcrypt.compare(String(password_actual || ''), usuario.passwordHash);
      if (!vale) return err('La contraseña actual no es correcta.', 'password_actual_mala', 400);
    }

    await repo.actualizarPassword(usuarioId, await bcrypt.hash(password_nueva, COSTE_BCRYPT));
    return { ok: true };
  }

  /* ── Perfil ─────────────────────────────────────────────────────────── */

  async function actualizarPerfil({ usuarioId, metadata }) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return err('Los datos del perfil tienen que venir en un objeto.', 'metadata_invalida');
    }

    const usuario = await repo.porId(usuarioId);
    if (!usuario) return err('No hay sesión activa.', 'sin_sesion', 401);

    /* Se mezcla, no se sustituye: las pantallas mandan sólo el campo que
       tocaron (`AjustesPage` manda el teléfono, `PerfilTalentoEditor` el CV), y
       sustituir el objeto entero borraría el resto sin que nadie lo pidiera. */
    const fusionada = { ...(usuario.metadata || {}), ...metadata };
    const actualizado = await repo.actualizarMetadata(usuarioId, fusionada);
    return { ok: true, usuario: publico(actualizado) };
  }

  async function yo(usuarioId) {
    const usuario = await repo.porId(usuarioId);
    if (!usuario) return err('No hay sesión activa.', 'sin_sesion', 401);
    return { ok: true, usuario: publico(usuario) };
  }

  /* Lo que sale hacia fuera. El hash de la contraseña no aparece aquí ni por
     accidente, que es la razón de que exista esta función y no un `...usuario`
     repartido por las rutas. */
  function publico(usuario) {
    return {
      id             : usuario.id,
      email          : usuario.email,
      metadata       : usuario.metadata || {},
      emailConfirmado: Boolean(usuario.emailConfirmado),
    };
  }

  return {
    registro, login, refrescar, logout, cerrarTodas, sesionesDe,
    confirmar, reenviarConfirmacion,
    recuperar, restablecer, cambiarPassword, actualizarPerfil, yo,
    /* Las usa `google.js`, que abre sesión sin pasar por contraseña, y que
       necesita el repositorio para enlazar la identidad. Van con guion bajo
       porque son la puerta de servicio: nadie de fuera del módulo las llama. */
    _abrirSesion: abrirSesion,
    _publico: publico,
    _repo: repo,
  };
}

module.exports = { crearServicio, COSTE_BCRYPT, MINIMO_PASSWORD };
