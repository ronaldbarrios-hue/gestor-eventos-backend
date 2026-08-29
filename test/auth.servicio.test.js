'use strict';

/* Pruebas de las decisiones: quién entra, quién no, y qué se le cuenta al que
   no entra. Sin base de datos y sin Express — el servicio no los conoce.
 *
 * Lo que se comprueba aquí no es que «el login funcione». Eso se ve a la
 * primera. Es lo que sólo se nota cuando ya es tarde: que el formulario no
 * delate qué correos tienen cuenta, que cambiar la contraseña cierre las
 * sesiones del que se metió, y que un refresco robado no valga dos veces. */

process.env.JWT_SECRET = 'secreto-de-prueba-que-no-es-el-de-produccion';
process.env.AUTH_PROPIA = 'true';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');

const { crearServicio } = require('../modules/auth/servicio.js');
const tokens = require('../modules/auth/tokens.js');
const config = require('../core/config');
const { crearRepoFalso, crearCorreosFalsos, uuid } = require('./_repoFalso.js');

const CLAVE = 'contraseña-larga-de-prueba';

/* Monta un servicio con una cuenta ya creada y confirmada. Devuelve todo lo que
   hace falta para mirar por dentro después. */
async function montar({ confirmado = true, conPassword = true } = {}) {
  const id = uuid();
  const repo = crearRepoFalso({
    usuarios: [{
      id,
      email: 'ana@ejemplo.com',
      passwordHash: conPassword ? await bcrypt.hash(CLAVE, 4) : null,
      emailConfirmado: confirmado,
      metadata: { full_name: 'Ana' },
    }],
  });
  const correos = crearCorreosFalsos(repo._estado);
  return { id, repo, correos, servicio: crearServicio({ repo, correos }) };
}

/* ── Registro ──────────────────────────────────────────────────────────── */

test('el registro crea la cuenta sin sesión y manda el correo', async () => {
  const { repo, correos, servicio } = await montar();
  const r = await servicio.registro({ email: 'nueva@ejemplo.com', password: CLAVE, metadata: { full_name: 'Nueva' } });

  assert.equal(r.ok, true);
  /* Sin sesión: primero se confirma el correo. Es lo que el frontend lee para
     enseñar «revisá tu correo» en vez de entrar. */
  assert.equal(r.sesion, undefined);

  const creada = await repo.porEmail('nueva@ejemplo.com');
  assert.ok(creada);
  assert.equal(creada.emailConfirmado, false);
  assert.equal(creada.metadata.full_name, 'Nueva');

  const correo = repo._estado.correosEnviados.at(-1);
  assert.equal(correo.tipo, 'confirmacion');
  assert.equal(correo.para, 'nueva@ejemplo.com');
});

test('registrarse con un correo que ya existe contesta lo mismo que uno nuevo', async () => {
  const { repo, servicio } = await montar();

  const nuevo = await servicio.registro({ email: 'otra@ejemplo.com', password: CLAVE });
  const repetido = await servicio.registro({ email: 'ana@ejemplo.com', password: CLAVE });

  /* Palabra por palabra. Si aquí dijera «ese correo ya está registrado», el
     formulario de registro sería un comprobador de cuentas para cualquiera. */
  assert.deepEqual(repetido, nuevo);

  /* Y al dueño de verdad se le avisa, que es la parte que sí sirve. */
  assert.equal(repo._estado.correosEnviados.at(-1).tipo, 'aviso_registro');
  assert.equal(repo._estado.correosEnviados.at(-1).para, 'ana@ejemplo.com');
});

test('el registro guarda el correo en minúsculas', async () => {
  const { repo, servicio } = await montar();
  await servicio.registro({ email: '  Mayus@Ejemplo.COM ', password: CLAVE });
  assert.ok(await repo.porEmail('mayus@ejemplo.com'));
});

test('una contraseña corta se rechaza antes de crear nada', async () => {
  const { repo, servicio } = await montar();
  const r = await servicio.registro({ email: 'corta@ejemplo.com', password: '123' });

  assert.equal(r.codigo, 'password_corta');
  assert.equal(await repo.porEmail('corta@ejemplo.com'), null);
});

test('una contraseña de más de 72 bytes se rechaza en vez de recortarse', async () => {
  /* bcrypt ignora en silencio lo que pase de 72 bytes. Aceptarla haría creer a
     quien escribe una frase larguísima que tiene más seguridad de la que tiene. */
  const { servicio } = await montar();
  const r = await servicio.registro({ email: 'larga@ejemplo.com', password: 'a'.repeat(100) });
  assert.equal(r.codigo, 'password_larga');
});

/* ── Login ─────────────────────────────────────────────────────────────── */

test('con la contraseña correcta se abre sesión', async () => {
  const { id, servicio } = await montar();
  const r = await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE });

  assert.equal(r.ok, true);
  assert.equal(r.sesion.usuario.id, id);
  assert.equal(r.sesion.usuario.email, 'ana@ejemplo.com');
  assert.ok(r.sesion.access_token);
  assert.ok(r.sesion.refresh_token);

  /* El token que sale sirve de verdad: es el mismo que verificará el middleware. */
  assert.equal(tokens.verificarAcceso(r.sesion.access_token).sub, id);

  /* Y lo que va hacia el cliente no lleva el hash de la contraseña. */
  assert.equal(r.sesion.usuario.passwordHash, undefined);
});

test('un correo que no existe y una contraseña mala dan la MISMA respuesta', async () => {
  const { servicio } = await montar();

  const inexistente = await servicio.login({ email: 'nadie@ejemplo.com', password: CLAVE });
  const malaClave   = await servicio.login({ email: 'ana@ejemplo.com', password: 'otra-cosa-larga' });

  assert.deepEqual(inexistente, malaClave);
  assert.equal(inexistente.status, 401);
});

test('una cuenta que sólo tiene Google no delata que no tiene contraseña', async () => {
  const { servicio } = await montar({ conPassword: false });
  const r = await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE });

  assert.equal(r.codigo, 'credenciales');
  assert.equal(r.status, 401);
});

test('sin confirmar el correo no se entra, y se dice por qué', async () => {
  /* Aquí sí se cuenta el motivo: quien lo ve ya demostró que sabe la
     contraseña, así que no se le está revelando nada que no supiera, y sin el
     código el frontend no puede enseñar el botón de reenviar. */
  const { servicio } = await montar({ confirmado: false });
  const r = await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE });

  assert.equal(r.codigo, 'email_no_confirmado');
  assert.equal(r.status, 403);
});

test('a los ocho intentos fallidos la cuenta se bloquea un rato', async () => {
  const { servicio } = await montar();

  for (let i = 0; i < config.INTENTOS_MAX; i += 1) {
    await servicio.login({ email: 'ana@ejemplo.com', password: 'no-es-esta-tampoco' });
  }

  /* Y ahora ni siquiera con la buena, que es el punto: el que prueba mil
     contraseñas desde mil IP distintas se queda fuera igual. */
  const r = await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE });
  assert.equal(r.codigo, 'cuenta_bloqueada');
  assert.equal(r.status, 429);
});

test('entrar bien borra los intentos fallidos acumulados', async () => {
  const { id, repo, servicio } = await montar();

  await servicio.login({ email: 'ana@ejemplo.com', password: 'mal-mal-mal-mal' });
  assert.equal((await repo.porId(id)).intentosFallidos, 1);

  await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE });
  assert.equal((await repo.porId(id)).intentosFallidos, 0);
});

/* ── Refresco ──────────────────────────────────────────────────────────── */

test('el refresco devuelve tokens nuevos y el viejo deja de valer', async () => {
  const { servicio } = await montar();
  const { sesion } = await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE });

  const r = await servicio.refrescar({ refresh_token: sesion.refresh_token });
  assert.equal(r.ok, true);
  assert.notEqual(r.sesion.refresh_token, sesion.refresh_token);

  /* Rotación: el viejo muere al usarse. */
  const repetido = await servicio.refrescar({ refresh_token: sesion.refresh_token });
  assert.ok(repetido.error);
});

test('usar dos veces el mismo refresco cierra TODAS las sesiones', async () => {
  /* Un refresco ya rotado que reaparece significa que hay dos copias. Desde
     aquí no se puede saber cuál es la del dueño, así que se corta todo: es
     molesto, y es la única respuesta que deja fuera al ladrón. */
  const { id, repo, servicio } = await montar();
  const primera = (await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE })).sesion;
  const otroDispositivo = (await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE })).sesion;

  await servicio.refrescar({ refresh_token: primera.refresh_token });
  const robado = await servicio.refrescar({ refresh_token: primera.refresh_token });

  assert.equal(robado.codigo, 'sesion_reutilizada');
  assert.equal((await repo.sesionesDe(id)).length, 0);

  /* Incluido el otro dispositivo, que no había hecho nada malo. */
  const despues = await servicio.refrescar({ refresh_token: otroDispositivo.refresh_token });
  assert.ok(despues.error);
});

test('un refresco inventado no abre nada', async () => {
  const { servicio } = await montar();
  const r = await servicio.refrescar({ refresh_token: 'gtkr_inventado' });
  assert.equal(r.status, 401);
});

test('un refresco caducado no vale', async () => {
  const { repo, correos } = await montar();
  /* El servicio pregunta la hora a `ahora()`: se le adelanta el reloj en vez de
     esperar treinta días. */
  const servicio = crearServicio({ repo, correos });
  const { sesion } = await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE });

  const futuro = crearServicio({
    repo, correos,
    ahora: () => new Date(Date.now() + (config.VIDA_REFRESH_S + 60) * 1000),
  });
  const r = await futuro.refrescar({ refresh_token: sesion.refresh_token });
  assert.equal(r.codigo, 'sesion_caducada');
});

/* ── Cerrar sesión ─────────────────────────────────────────────────────── */

test('cerrar sesión revoca sólo ese dispositivo', async () => {
  const { id, repo, servicio } = await montar();
  const movil = (await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE })).sesion;
  await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE });

  await servicio.logout({ refresh_token: movil.refresh_token });

  assert.equal((await repo.sesionesDe(id)).length, 1);
});

test('cerrar en todos los dispositivos deja cero sesiones', async () => {
  const { id, repo, servicio } = await montar();
  await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE });
  await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE });

  const r = await servicio.cerrarTodas(id);
  assert.equal(r.cerradas, 2);
  assert.equal((await repo.sesionesDe(id)).length, 0);
});

test('cerrar sesión sin refresco no falla', async () => {
  /* El cliente ya borró su copia; devolverle un error sólo lo dejaría en un
     estado raro. */
  const { servicio } = await montar();
  assert.equal((await servicio.logout({})).ok, true);
});

/* ── Confirmar el correo ───────────────────────────────────────────────── */

test('el enlace de confirmación confirma la cuenta, y sirve una vez', async () => {
  const { repo, servicio } = await montar({ confirmado: false });
  await servicio.reenviarConfirmacion({ email: 'ana@ejemplo.com' });
  const { token } = repo._estado.correosEnviados.at(-1);

  assert.equal((await servicio.confirmar({ token })).ok, true);
  assert.equal((await repo.porEmail('ana@ejemplo.com')).emailConfirmado, true);

  /* Abrirlo dos veces no es un error: casi siempre es la misma persona, o el
     antivirus del correo que abre los enlaces antes que ella. */
  const segunda = await servicio.confirmar({ token });
  assert.equal(segunda.ok, true);
  assert.equal(segunda.yaEstaba, true);
});

test('un token de recuperación no sirve para confirmar', async () => {
  /* Los dos son cadenas de la misma pinta en la misma tabla. Sin comprobar el
     tipo, el enlace de recuperación confirmaría cuentas y al revés. */
  const { repo, servicio } = await montar({ confirmado: false });
  await servicio.recuperar({ email: 'ana@ejemplo.com' });
  const { token } = repo._estado.correosEnviados.at(-1);

  assert.equal((await servicio.confirmar({ token })).codigo, 'token_invalido');
});

test('pedir otro enlace de confirmación invalida el anterior', async () => {
  const { repo, servicio } = await montar({ confirmado: false });
  await servicio.reenviarConfirmacion({ email: 'ana@ejemplo.com' });
  const primero = repo._estado.correosEnviados.at(-1).token;
  await servicio.reenviarConfirmacion({ email: 'ana@ejemplo.com' });

  const r = await servicio.confirmar({ token: primero });
  assert.equal(r.yaEstaba, true);
  assert.equal((await repo.porEmail('ana@ejemplo.com')).emailConfirmado, false);
});

test('reenviar a un correo que no existe contesta lo mismo', async () => {
  const { repo, servicio } = await montar();
  const antes = repo._estado.correosEnviados.length;
  const r = await servicio.reenviarConfirmacion({ email: 'nadie@ejemplo.com' });

  assert.equal(r.ok, true);
  assert.equal(repo._estado.correosEnviados.length, antes);
});

/* ── Recuperar contraseña ──────────────────────────────────────────────── */

test('recuperar contesta igual exista o no la cuenta', async () => {
  const { servicio } = await montar();
  const existe = await servicio.recuperar({ email: 'ana@ejemplo.com' });
  const noExiste = await servicio.recuperar({ email: 'nadie@ejemplo.com' });
  assert.deepEqual(existe, noExiste);
});

test('el enlace de recuperación cambia la contraseña y cierra las sesiones', async () => {
  const { id, repo, servicio } = await montar();
  await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE });
  assert.equal((await repo.sesionesDe(id)).length, 1);

  await servicio.recuperar({ email: 'ana@ejemplo.com' });
  const { token } = repo._estado.correosEnviados.at(-1);

  const nueva = 'otra-contraseña-nueva';
  assert.equal((await servicio.restablecer({ token, password: nueva })).ok, true);

  /* La razón por la que la gente cambia la contraseña es que cree que alguien
     entró. Si su sesión sigue viva, el gesto no sirve de nada. */
  assert.equal((await repo.sesionesDe(id)).length, 0);

  assert.equal((await servicio.login({ email: 'ana@ejemplo.com', password: nueva })).ok, true);
  assert.equal((await servicio.login({ email: 'ana@ejemplo.com', password: CLAVE })).status, 401);
});

test('el enlace de recuperación sólo vale una vez', async () => {
  const { repo, servicio } = await montar();
  await servicio.recuperar({ email: 'ana@ejemplo.com' });
  const { token } = repo._estado.correosEnviados.at(-1);

  await servicio.restablecer({ token, password: 'primera-nueva-clave' });
  const segunda = await servicio.restablecer({ token, password: 'segunda-nueva-clave' });

  assert.equal(segunda.codigo, 'token_usado');
});

test('recuperar desde el correo también confirma la cuenta', async () => {
  /* Quien abre el enlace demuestra que lee esa bandeja, que es exactamente lo
     que confirma la dirección. Dejarla sin confirmar la deja fuera con una
     contraseña nueva y correcta, que es el peor sitio donde dejar a alguien. */
  const { repo, servicio } = await montar({ confirmado: false });
  await servicio.recuperar({ email: 'ana@ejemplo.com' });
  const { token } = repo._estado.correosEnviados.at(-1);

  await servicio.restablecer({ token, password: 'una-clave-nueva-larga' });
  assert.equal((await repo.porEmail('ana@ejemplo.com')).emailConfirmado, true);
});

test('un enlace de recuperación caducado no vale', async () => {
  const { repo, correos } = await montar();
  const servicio = crearServicio({ repo, correos });
  await servicio.recuperar({ email: 'ana@ejemplo.com' });
  const { token } = repo._estado.correosEnviados.at(-1);

  const futuro = crearServicio({
    repo, correos,
    ahora: () => new Date(Date.now() + (config.VIDA_RECUPERACION_S + 60) * 1000),
  });
  assert.equal((await futuro.restablecer({ token, password: 'clave-nueva-larga' })).codigo, 'token_caducado');
});

/* ── Cambiar contraseña estando dentro ─────────────────────────────────── */

test('cambiar la contraseña exige la actual', async () => {
  /* Sin esto, un token robado durante media hora se convierte en una cuenta
     perdida para siempre: el ladrón cambia la contraseña y el dueño se queda
     fuera de su propio evento. */
  const { id, servicio } = await montar();
  const r = await servicio.cambiarPassword({
    usuarioId: id, password_actual: 'la-que-no-es', password_nueva: 'una-clave-nueva-larga',
  });
  assert.equal(r.codigo, 'password_actual_mala');
});

test('con la contraseña actual correcta, se cambia', async () => {
  const { id, servicio } = await montar();
  const r = await servicio.cambiarPassword({
    usuarioId: id, password_actual: CLAVE, password_nueva: 'una-clave-nueva-larga',
  });

  assert.equal(r.ok, true);
  assert.equal((await servicio.login({ email: 'ana@ejemplo.com', password: 'una-clave-nueva-larga' })).ok, true);
});

test('quien entró con Google puede ponerse contraseña sin tener una anterior', async () => {
  const { id, servicio } = await montar({ conPassword: false });
  const r = await servicio.cambiarPassword({ usuarioId: id, password_nueva: 'su-primera-clave-larga' });
  assert.equal(r.ok, true);
});

/* ── Perfil ────────────────────────────────────────────────────────────── */

test('actualizar el perfil mezcla, no sustituye', async () => {
  /* Cada pantalla manda sólo el campo que tocó. Sustituir el objeto entero
     borraría el nombre al guardar el teléfono. */
  const { id, servicio } = await montar();
  const r = await servicio.actualizarPerfil({ usuarioId: id, metadata: { telefono: '3001234567' } });

  assert.equal(r.usuario.metadata.telefono, '3001234567');
  assert.equal(r.usuario.metadata.full_name, 'Ana');
});

test('el perfil no acepta cualquier cosa en vez de un objeto', async () => {
  const { id, servicio } = await montar();
  assert.equal((await servicio.actualizarPerfil({ usuarioId: id, metadata: 'hola' })).codigo, 'metadata_invalida');
  assert.equal((await servicio.actualizarPerfil({ usuarioId: id, metadata: [1, 2] })).codigo, 'metadata_invalida');
});

test('«yo» devuelve el perfil sin el hash de la contraseña', async () => {
  const { id, servicio } = await montar();
  const r = await servicio.yo(id);

  assert.equal(r.usuario.email, 'ana@ejemplo.com');
  assert.deepEqual(Object.keys(r.usuario).sort(), ['email', 'emailConfirmado', 'id', 'metadata']);
});
