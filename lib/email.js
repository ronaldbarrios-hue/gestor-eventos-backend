/* GESTEK — Transporte de email transaccional.
   Prioridad: cPanel SMTP → Gmail OAuth2 → Resend → no-op

   Este archivo solo SACA el correo. El HTML y las plantillas viven en
   lib/emailPlantillas.js, que es el único renderizador y sabe de la marca del
   evento. Antes había aquí cuatro plantillas escritas a mano, en azul y violeta
   fijos, y eran las que salían de verdad mientras el organizador diseñaba otras
   que nadie usaba. */
let _transport = null;
let _mode = null;

function init() {
  if (_mode !== null) return;

  /* 1) cPanel SMTP (correo propio del dominio) */
  const cUser = process.env.CPANEL_SMTP_USER;
  const cPass = process.env.CPANEL_SMTP_PASS;
  const cHost = process.env.CPANEL_SMTP_HOST || 'mail.gestekeventost.dpdns.org';
  const cPort = Number(process.env.CPANEL_SMTP_PORT || 465);

  if (cUser && cPass) {
    try {
      const nodemailer = require('nodemailer');
      _transport = nodemailer.createTransport({
        host: cHost,
        port: cPort,
        secure: cPort === 465, // true para 465 (SSL), false para 587 (STARTTLS)
        auth: { user: cUser, pass: cPass },
      });
      _mode = 'cpanel_smtp';
      console.log('[email] modo cPanel SMTP activado para:', cUser);
      return;
    } catch (e) {
      console.warn('[email] no se pudo inicializar cPanel SMTP:', e.message);
    }
  }

  /* 2) Gmail OAuth2 */
  const gUser = process.env.GMAIL_USER;
  const gClientId = process.env.GMAIL_CLIENT_ID;
  const gClientSecret = process.env.GMAIL_CLIENT_SECRET;
  const gRefreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (gUser && gClientId && gClientSecret && gRefreshToken) {
    try {
      const nodemailer = require('nodemailer');
      _transport = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: gUser,
          clientId: gClientId,
          clientSecret: gClientSecret,
          refreshToken: gRefreshToken,
        },
      });
      _mode = 'gmail_oauth';
      console.log('[email] modo Gmail OAuth2 activado para:', gUser);
      return;
    } catch (e) {
      console.warn('[email] nodemailer no disponible:', e.message);
    }
  }

  /* 3) Resend */
  if (process.env.RESEND_API_KEY) { _mode = 'resend'; return; }

  _mode = null;
  console.warn('[email] sin proveedor configurado. Emails deshabilitados.');
}

/* La dirección REAL desde la que sale el correo: la del dominio autenticado.
   No se puede sustituir por la del organizador sin romper DMARC — un
   `From: eventos@sudominio.com` firmado por nuestro servidor, sin que él haya
   delegado DKIM en su DNS, no alinea y cae en spam. Ver CORREO-Y-DOMINIOS.md. */
function direccionReal() {
  if (_mode === 'cpanel_smtp') {
    return process.env.EMAIL_FROM || `GESTEK <${process.env.CPANEL_SMTP_USER}>`;
  }
  return process.env.EMAIL_FROM || `GESTEK <${process.env.GMAIL_USER || 'noreply@gestek.app'}>`;
}

/* Saca `algo@dominio` de un «Nombre <algo@dominio>». */
function soloDireccion(s) {
  const m = String(s || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(s || '')).trim();
}

/* Enmascarar el remitente, hasta donde se puede hacer bien.

   Lo que SÍ funciona hoy sin tocar el DNS de nadie: el nombre visible es el del
   evento —en la bandeja se lee «Feria del Libro», no «GESTEK»— y `Reply-To`
   apunta al organizador, así que responder le llega a él. Para el asistente es
   indistinguible de un correo suyo salvo por la dirección técnica.

   Lo que NO se hace a propósito: poner el dominio del organizador en el `From`.
   Eso es suplantación mientras él no publique el CNAME de DKIM, y el castigo no
   es un aviso: es que el correo deja de entregarse. */
function fromAddress(nombreVisible) {
  const real = direccionReal();
  if (!nombreVisible) return real;
  /* Comillas y saltos fuera: un nombre con `"` o `\n` permite inyectar
     cabeceras en el mensaje. */
  const limpio = String(nombreVisible).replace(/["\r\n<>]/g, '').trim().slice(0, 70);
  if (!limpio) return real;
  return `"${limpio}" <${soloDireccion(real)}>`;
}

async function sendMail({ to, subject, html, replyTo, fromName, attachments }) {
  init();
  const destinatarios = (Array.isArray(to) ? to : [to]).filter(e => e && e.includes('@'));
  if (destinatarios.length === 0) return { ok: false, skipped: 'no_recipients' };
  if (!_mode) return { ok: false, skipped: 'no_provider' };

  const from = fromAddress(fromName);
  const responderA = replyTo && String(replyTo).includes('@') ? soloDireccion(replyTo) : null;
  const adjuntos = Array.isArray(attachments) ? attachments.filter(Boolean) : [];

  try {
    if (_mode === 'cpanel_smtp' || _mode === 'gmail_oauth') {
      console.log(`[email] (${_mode}) enviando a:`, destinatarios);
      const info = await _transport.sendMail({
        from,
        to: destinatarios.join(','),
        subject,
        html,
        ...(responderA ? { replyTo: responderA } : {}),
        ...(adjuntos.length ? { attachments: adjuntos } : {}),
      });
      console.log('[email] enviado OK:', info.messageId);
      return { ok: true };
    }

    /* resend — quiere el contenido del adjunto en base64, no en texto. */
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: destinatarios,
        subject,
        html,
        ...(responderA ? { reply_to: responderA } : {}),
        ...(adjuntos.length ? {
          attachments: adjuntos.map(a => ({
            filename: a.filename,
            content: Buffer.from(a.content).toString('base64'),
          })),
        } : {}),
      }),
    });
    if (!resp.ok) return { ok: false, error: `Resend ${resp.status}` };
    return { ok: true };
  } catch (e) {
    console.error(`[email] ERROR (${_mode}):`, e.code, e.message);
    return { ok: false, error: e.message };
  }
}

/* ── Comprobar que el proveedor RESPONDE ────────────────────────────────

   Hasta ahora el diagnóstico sólo miraba si las variables de entorno estaban
   puestas. Eso deja pasar el error más caro: pegar una contraseña equivocada y
   ver «configurado: true» mientras cada envío falla en silencio y la boleta se
   emite igual. Aquí se abre la conexión de verdad y se autentica.

   Los mensajes traducen el código del error a lo que hay que cambiar, porque
   un `EAUTH` a secas manda a la gente a adivinar. */

/* Fuerza que init() vuelva a leer el entorno. Lo usa el script de prueba, que
   cambia las variables sobre la marcha. */
function reiniciar() {
  _transport = null;
  _mode = null;
}

function explicar(e) {
  const codigo = e?.code || '';
  const texto = String(e?.message || '');

  if (codigo === 'EAUTH' || /535|authentication failed/i.test(texto)) {
    return {
      causa: 'usuario_o_clave',
      mensaje: 'El servidor rechazó el usuario o la contraseña.',
      sugerencia: 'En cPanel el usuario suele ser el CORREO COMPLETO (buzon@tudominio.com), no sólo la parte de antes de la arroba. Y la contraseña es la del buzón, no la de la cuenta de cPanel.',
    };
  }
  if (/wrong version number|SSL routines/i.test(texto)) {
    return {
      causa: 'puerto_o_cifrado',
      mensaje: 'El puerto y el cifrado no coinciden.',
      sugerencia: 'El 465 es SSL directo y el 587 es STARTTLS. Si tienes 465 prueba 587, o al revés: es el fallo más común al copiar la configuración.',
    };
  }
  if (/self.signed|certificate/i.test(texto)) {
    return {
      causa: 'certificado',
      mensaje: 'El certificado del servidor de correo no es de fiar.',
      sugerencia: 'Pasa en hostings compartidos cuyo certificado no cubre mail.tudominio.com. Prueba a poner en CPANEL_SMTP_HOST el nombre real del servidor que te dé el proveedor.',
    };
  }
  if (codigo === 'ENOTFOUND' || codigo === 'EDNS') {
    return {
      causa: 'host',
      mensaje: `No existe el servidor «${process.env.CPANEL_SMTP_HOST || '(sin definir)'}».`,
      sugerencia: 'Comprueba el nombre. Suele ser mail.tudominio.com, y lo confirma el propio cPanel en «Cuentas de correo → Conectar dispositivos».',
    };
  }
  if (codigo === 'ETIMEDOUT' || codigo === 'ECONNECTION' || codigo === 'ESOCKET') {
    return {
      causa: 'conexion',
      mensaje: 'No se pudo conectar con el servidor de correo.',
      sugerencia: 'O el puerto está mal, o el hosting bloquea la salida SMTP desde donde corre el backend. Si el backend está en Render y el correo en cPanel, hay que confirmar que el proveedor permite conexiones de fuera.',
    };
  }
  return { causa: 'desconocida', mensaje: texto || 'Error desconocido.', sugerencia: '' };
}

/* Devuelve { ok, modo, mensaje, sugerencia }. No lanza nunca: es para
   enseñarlo en pantalla. */
async function verificarConexion() {
  init();

  if (!_mode) {
    return {
      ok: false,
      modo: null,
      causa: 'sin_proveedor',
      mensaje: 'No hay proveedor de correo configurado.',
      sugerencia: 'Rellena CPANEL_SMTP_USER, CPANEL_SMTP_PASS, CPANEL_SMTP_HOST y CPANEL_SMTP_PORT; o el OAuth de Gmail; o RESEND_API_KEY.',
    };
  }

  if (_mode === 'resend') {
    try {
      const r = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      });
      if (r.status === 401 || r.status === 403) {
        return { ok: false, modo: _mode, causa: 'usuario_o_clave', mensaje: 'Resend rechazó la API key.', sugerencia: 'Genera una nueva en resend.com → API Keys.' };
      }
      if (!r.ok) return { ok: false, modo: _mode, causa: 'conexion', mensaje: `Resend respondió ${r.status}.`, sugerencia: '' };
      return { ok: true, modo: _mode, mensaje: 'Resend responde y la clave es válida.', sugerencia: '' };
    } catch (e) {
      return { ok: false, modo: _mode, ...explicar(e) };
    }
  }

  try {
    /* `verify()` abre la conexión, negocia TLS y hace login. Es la única forma
       de saber que las credenciales sirven sin mandarle un correo a nadie. */
    await _transport.verify();
    return {
      ok: true,
      modo: _mode,
      mensaje: `Conexión correcta con ${process.env.CPANEL_SMTP_HOST || 'el servidor'} por el puerto ${process.env.CPANEL_SMTP_PORT || 465}.`,
      sugerencia: '',
    };
  } catch (e) {
    return { ok: false, modo: _mode, ...explicar(e) };
  }
}

module.exports = { sendMail, verificarConexion, reiniciar };
