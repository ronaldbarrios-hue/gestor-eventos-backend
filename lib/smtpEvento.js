/* GESTEK — El buzón propio de cada organizador.

   Cada evento puede tener su propio SMTP: el correo sale literalmente de la
   cuenta del organizador, así que la autenticación ya es correcta y no hace
   falta tocar el DNS de nadie. Es la opción que pidió el equipo — «que cada
   uno pegue las credenciales de su correo y ya».

   Lo que NO resuelve, y hay que decirlo cada vez: los topes del proveedor del
   organizador. Gmail gratis ~500/día, Workspace ~2.000, un buzón de cPanel
   200/hora. Para 7.000 asistentes no alcanza; para un evento mediano sí, y
   además el correo se ve suyo.

   Sobre Gmail: desde 2022 no acepta la contraseña normal por SMTP. Hace falta
   una «contraseña de aplicación», que exige tener la verificación en dos pasos
   activada. Quien pegue su contraseña de siempre va a ver un fallo de
   autenticación sin entender por qué, así que el mensaje lo dice. */

const supabase = require('./supabase.js');
const secretos = require('./secretos.js');

/* ── Cifrado ─────────────────────────────────────────────────────────
   La contraseña de correo de otra persona no se guarda en claro, y el cómo
   vive en lib/secretos.js: AES-256-GCM, que además de cifrar autentica.

   Aquí había una copia entera del cifrado. Cuando se sacó a secretos.js, la de
   aquí se quedó — y pasó exactamente lo que avisa el comentario de allí: las
   dos versiones divergieron. secretos.js aprendió a ignorar los espacios
   sobrantes al leer la llave; esta no, así que un espacio de más al pegarla en
   el panel del servidor dejaba el correo del organizador funcionando y la
   llave de IA rota, o al revés, sin ninguna pista de por qué.

   El formato del texto cifrado es el mismo (iv:tag:datos), así que lo ya
   guardado se sigue descifrando igual. */

const { cifrar, descifrar } = secretos;
const cifradoListo = () => secretos.listo();

/* ── Lectura ─────────────────────────────────────────────────────────── */

const faltaTabla = (e) => /evento_smtp|does not exist/i.test(String(e?.message || ''));

/* Lo que se le puede enseñar al panel: todo menos la contraseña. */
const COLS_PUBLICAS = `host, puerto, usuario, remitente, remitente_nombre, responder_a,
  verificado_at, verificado_ok, verificado_error, activo, updated_at`;

async function verConfig(eventoId) {
  const { data, error } = await supabase
    .from('evento_smtp').select(COLS_PUBLICAS).eq('evento_id', eventoId).maybeSingle();
  if (error) return faltaTabla(error) ? { disponible: false } : { disponible: true, config: null };
  return { disponible: true, config: data || null, cifrado_listo: cifradoListo(), cifrado: secretos.diagnostico() };
}

/* Hasta qué parte del cupo se llena un buzón antes de pasar al siguiente.

   70% y no 100% a propósito: el tope que dice el proveedor y el que aplica de
   verdad no siempre coinciden, y pasarse no retrasa el envío — bloquea la
   cuenta de correo durante horas o días. El margen se paga una vez; el bloqueo
   se paga el día de la venta. */
const UMBRAL = Math.min(0.95, Math.max(0.1,
  Number(process.env.EMAIL_UMBRAL_RELEVO) || 0.7));

/* Cuántos salieron por este buzón en la última hora y en el último día. Se
   cuenta sobre el registro de envíos, que ya existía: no hace falta un contador
   aparte que se pueda desincronizar de la realidad. */
async function gastado(smtpId) {
  const desdeHora = new Date(Date.now() - 3600_000).toISOString();
  const desdeDia  = new Date(Date.now() - 86_400_000).toISOString();

  const [h, d] = await Promise.all([
    supabase.from('evento_email_envios').select('id', { count: 'exact', head: true })
      .eq('smtp_id', smtpId).gte('created_at', desdeHora),
    supabase.from('evento_email_envios').select('id', { count: 'exact', head: true })
      .eq('smtp_id', smtpId).gte('created_at', desdeDia),
  ]);
  return { hora: h.count || 0, dia: d.count || 0 };
}

/* Exportada para poder comprobarla: es la regla que decide el relevo, y una
   regla que decide cuándo NO enviar merece una prueba. */
const conSitio = (fila, uso, umbral = UMBRAL) => {
  const topeH = Number(fila.max_por_hora) || 0;
  const topeD = Number(fila.max_por_dia) || 0;
  if (topeH > 0 && uso.hora >= topeH * umbral) return false;
  if (topeD > 0 && uso.dia  >= topeD * umbral) return false;
  return true;
};

const armar = (fila) => ({
  id: fila.id,
  etiqueta: fila.etiqueta || fila.host,
  host: fila.host,
  port: Number(fila.puerto) || 465,
  user: fila.usuario,
  pass: descifrar(fila.pass_cifrada),
  remitente: fila.remitente || fila.usuario,
  remitenteNombre: fila.remitente_nombre || null,
  responderA: fila.responder_a || null,
});

/* Devuelve el buzón por el que toca enviar AHORA, con la contraseña ya
   descifrada. Sólo lo llama el motor de envío — nunca una ruta HTTP.

   El relevo: se recorren en su orden y sale por el primero que aún tenga
   sitio. Cuando todos han llegado a su umbral se devuelve `null` con
   `agotados`, y quien llama debe ESPERAR — no forzar por el último ni caer al
   remitente de la plataforma. Quien conectó sus buzones espera que el correo
   salga de ahí; mandarlo desde otra dirección sin avisar es peor que
   retrasarlo. */
async function credenciales(eventoId) {
  if (!eventoId) return null;
  const { data, error } = await supabase
    .from('evento_smtp')
    .select('id, host, puerto, usuario, pass_cifrada, remitente, remitente_nombre, responder_a, activo, orden, etiqueta, max_por_hora, max_por_dia')
    .eq('evento_id', eventoId)
    .eq('activo', true)
    .order('orden', { ascending: true });

  if (error || !data?.length) return null;

  let huboAlguno = false;
  for (const fila of data) {
    let uso;
    try { uso = await gastado(fila.id); }
    catch { uso = { hora: 0, dia: 0 }; }   /* sin contador, se intenta igual */

    huboAlguno = true;
    if (!conSitio(fila, uso)) continue;

    try { return armar(fila); }
    catch (e) {
      /* Llave cambiada o fila alterada: se salta ESTE buzón y se prueba el
         siguiente, en vez de dejar al evento sin correo por uno roto. */
      console.warn(`[smtp] no se pudo descifrar «${fila.etiqueta || fila.host}» del evento ${eventoId}:`, e.message);
    }
  }

  if (huboAlguno) {
    console.warn(`[smtp] todos los buzones del evento ${eventoId} llegaron a su cupo; el envío espera.`);
    return { agotados: true };
  }
  return null;
}

/* ── Guardado ────────────────────────────────────────────────────────── */

function validar({ host, puerto, usuario, pass, remitente, responder_a }) {
  if (!host || !/^[a-z0-9.-]+$/i.test(String(host))) return 'El servidor (host) no es válido.';
  const p = Number(puerto);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return 'El puerto no es válido.';
  if (!usuario || !String(usuario).includes('@')) {
    return 'El usuario suele ser el correo COMPLETO (buzon@tudominio.com), no sólo la parte de antes de la arroba.';
  }
  if (!pass) return 'Falta la contraseña del buzón.';
  for (const [campo, valor] of [['remitente', remitente], ['responder_a', responder_a]]) {
    if (valor && !String(valor).includes('@')) return `El campo ${campo} no es un correo válido.`;
  }
  /* El remitente tiene que ser del mismo dominio que la cuenta: los
     proveedores rechazan enviar «como» otra dirección. Vale más decirlo aquí
     que dejar que falle en la venta. */
  if (remitente) {
    const domRem = String(remitente).split('@')[1]?.toLowerCase();
    const domUsr = String(usuario).split('@')[1]?.toLowerCase();
    if (domRem && domUsr && domRem !== domUsr) {
      return `El remitente debe ser del mismo dominio que la cuenta (${domUsr}). Tu proveedor no deja enviar como otra dirección.`;
    }
  }
  return null;
}

async function guardar(eventoId, body, userId) {
  const fallo = validar(body);
  if (fallo) return { ok: false, error: fallo };
  if (!cifradoListo()) {
    return { ok: false, error: 'El servidor no tiene SMTP_CRYPTO_KEY configurada, así que no se puede guardar una contraseña de forma segura.' };
  }

  const fila = {
    evento_id: eventoId,
    host: String(body.host).trim(),
    puerto: Number(body.puerto),
    usuario: String(body.usuario).trim(),
    pass_cifrada: cifrar(body.pass),
    remitente: body.remitente ? String(body.remitente).trim() : null,
    remitente_nombre: body.remitente_nombre ? String(body.remitente_nombre).trim().slice(0, 70) : null,
    responder_a: body.responder_a ? String(body.responder_a).trim() : null,
    activo: body.activo !== false,
    updated_by: userId || null,
    updated_at: new Date().toISOString(),
    /* Guardar no es verificar: la comprobación anterior deja de valer en
       cuanto cambian las credenciales. */
    verificado_at: null,
    verificado_ok: null,
    verificado_error: null,
  };

  const { error } = await supabase.from('evento_smtp').upsert(fila, { onConflict: 'evento_id' });
  if (error) {
    if (faltaTabla(error)) return { ok: false, error: 'Falta aplicar la migración 0071.' };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function borrar(eventoId) {
  const { error } = await supabase.from('evento_smtp').delete().eq('evento_id', eventoId);
  if (error && !faltaTabla(error)) return { ok: false, error: error.message };
  return { ok: true };
}

/* ── Comprobar de verdad ─────────────────────────────────────────────── */

/* Traduce el error del proveedor a lo que hay que cambiar. Es la misma idea
   que en lib/email.js, con el añadido de Gmail: la causa número uno de fallo
   al conectar un buzón propio es pegar la contraseña normal de Gmail en vez
   de una contraseña de aplicación. */
function explicar(e, usuario) {
  const codigo = e?.code || '';
  const texto = String(e?.message || '');
  const esGmail = /@gmail\.com|@googlemail\.com/i.test(String(usuario || ''));

  if (codigo === 'EAUTH' || /535|username and password not accepted|authentication failed/i.test(texto)) {
    return esGmail
      ? 'Gmail rechazó la contraseña. Desde 2022 no acepta la contraseña normal por SMTP: necesitas una «contraseña de aplicación», y para generarla hay que tener activada la verificación en dos pasos.'
      : 'El servidor rechazó el usuario o la contraseña. El usuario suele ser el correo COMPLETO, y la contraseña la del buzón (no la de la cuenta de cPanel).';
  }
  if (/wrong version number|SSL routines/i.test(texto)) {
    return 'El puerto y el cifrado no coinciden: 465 es SSL directo y 587 es STARTTLS. Prueba el otro.';
  }
  if (codigo === 'ENOTFOUND') return 'Ese servidor no existe. Revisa el nombre; suele ser mail.tudominio.com.';
  if (codigo === 'ETIMEDOUT' || codigo === 'ECONNECTION') {
    return 'No se pudo conectar. O el puerto está mal, o el proveedor bloquea la conexión desde fuera.';
  }
  if (/self.signed|certificate/i.test(texto)) {
    return 'El certificado del servidor no es de fiar. Pide al proveedor el nombre real de su servidor de correo.';
  }
  return texto || 'Error desconocido.';
}

/* Abre la conexión y hace login de verdad. Guarda el resultado, para que el
   panel pueda decir «comprobado hace dos días» en vez de «configurado». */
async function verificar(eventoId) {
  const cred = await credenciales(eventoId);
  if (!cred) return { ok: false, error: 'Este evento no tiene un buzón propio configurado.' };

  let resultado;
  try {
    const nodemailer = require('nodemailer');
    const transporte = nodemailer.createTransport({
      host: cred.host,
      port: cred.port,
      secure: cred.port === 465,
      auth: { user: cred.user, pass: cred.pass },
    });
    await transporte.verify();
    resultado = { ok: true, mensaje: `Conexión correcta con ${cred.host} por el puerto ${cred.port}.` };
  } catch (e) {
    resultado = { ok: false, error: explicar(e, cred.user) };
  }

  /* Mejor esfuerzo: que no se pueda anotar el resultado no invalida la
     comprobación que se acaba de hacer. */
  try {
    await supabase.from('evento_smtp').update({
      verificado_at: new Date().toISOString(),
      verificado_ok: resultado.ok,
      verificado_error: resultado.ok ? null : String(resultado.error).slice(0, 300),
    }).eq('evento_id', eventoId);
  } catch { /* noop */ }

  return resultado;
}

module.exports = {
  verConfig, credenciales, guardar, borrar, verificar,
  cifradoListo, validar,
  conSitio, UMBRAL,
};
