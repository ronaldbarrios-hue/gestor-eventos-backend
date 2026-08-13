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

const crypto = require('crypto');
const supabase = require('./supabase.js');

/* ── Cifrado ─────────────────────────────────────────────────────────
   La contraseña de correo de otra persona no se guarda en claro. AES-256-GCM
   porque además de cifrar autentica: si alguien altera la fila en la base, el
   descifrado falla en vez de devolver basura. */

function llave() {
  const hex = process.env.SMTP_CRYPTO_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

function cifrar(texto) {
  const k = llave();
  if (!k) throw new Error('Falta SMTP_CRYPTO_KEY en el servidor (32 bytes en hex).');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const datos = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return [iv.toString('hex'), c.getAuthTag().toString('hex'), datos.toString('hex')].join(':');
}

function descifrar(guardado) {
  const k = llave();
  if (!k) throw new Error('Falta SMTP_CRYPTO_KEY en el servidor.');
  const [ivHex, tagHex, datosHex] = String(guardado || '').split(':');
  if (!ivHex || !tagHex || !datosHex) throw new Error('La credencial guardada está corrupta.');
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(ivHex, 'hex'));
  d.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([d.update(Buffer.from(datosHex, 'hex')), d.final()]).toString('utf8');
}

const cifradoListo = () => Boolean(llave());

/* ── Lectura ─────────────────────────────────────────────────────────── */

const faltaTabla = (e) => /evento_smtp|does not exist/i.test(String(e?.message || ''));

/* Lo que se le puede enseñar al panel: todo menos la contraseña. */
const COLS_PUBLICAS = `host, puerto, usuario, remitente, remitente_nombre, responder_a,
  verificado_at, verificado_ok, verificado_error, activo, updated_at`;

async function verConfig(eventoId) {
  const { data, error } = await supabase
    .from('evento_smtp').select(COLS_PUBLICAS).eq('evento_id', eventoId).maybeSingle();
  if (error) return faltaTabla(error) ? { disponible: false } : { disponible: true, config: null };
  return { disponible: true, config: data || null, cifrado_listo: cifradoListo() };
}

/* Devuelve lo necesario para construir un transporte, con la contraseña ya
   descifrada. Sólo lo llama el motor de envío — nunca una ruta HTTP. */
async function credenciales(eventoId) {
  if (!eventoId) return null;
  const { data, error } = await supabase
    .from('evento_smtp')
    .select('host, puerto, usuario, pass_cifrada, remitente, remitente_nombre, responder_a, activo')
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (error || !data || !data.activo) return null;

  try {
    return {
      host: data.host,
      port: Number(data.puerto) || 465,
      user: data.usuario,
      pass: descifrar(data.pass_cifrada),
      remitente: data.remitente || data.usuario,
      remitenteNombre: data.remitente_nombre || null,
      responderA: data.responder_a || null,
    };
  } catch (e) {
    /* Llave cambiada o fila alterada: se cae al remitente de la plataforma en
       vez de dejar al evento sin correo. */
    console.warn(`[smtp] no se pudo descifrar la credencial del evento ${eventoId}:`, e.message);
    return null;
  }
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
};
