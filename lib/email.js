/* GESTEK — Transporte de email transaccional.
   Prioridad: buzones SMTP de plataforma (alternados) → Gmail OAuth2 → Resend → no-op

   Este archivo solo SACA el correo. El HTML y las plantillas viven en
   lib/emailPlantillas.js, que es el único renderizador y sabe de la marca del
   evento. Antes había aquí cuatro plantillas escritas a mano, en azul y violeta
   fijos, y eran las que salían de verdad mientras el organizador diseñaba otras
   que nadie usaba.

   ── Dos buzones que se alternan ──────────────────────────────────────────
   Puede haber hasta dos buzones SMTP de la plataforma (por ejemplo uno de
   cPanel y otro de Hostinger). Si sólo hay uno, se usa ese; si hay dos, cada
   envío rota al siguiente — es lo que reparte la carga y duplica el límite por
   hora combinado, en vez de agotar el tope de uno solo mientras el otro está
   de brazos cruzados. Si el que le toca a un envío falla, se intenta con el
   otro antes de rendirse: alternar no debe ser motivo para perder un correo
   que el otro buzón sí podía mandar. */
let _buzones = [];      // [{ id, host, user, transport }]
let _rr = 0;            // contador de round-robin, independiente de cuántas veces se llame init()
/* Declarada con `let` a propósito: en un momento se llamó `_fallbackMode` por
   error mientras el resto del archivo seguía usando `_mode`, y eso revienta
   con «ReferenceError: _mode is not defined» en la PRIMERA llamada real del
   servidor — las pruebas no lo veían porque siempre llaman a reiniciar()
   antes, que de paso creaba la variable. Si esto vuelve a pasar, cualquier
   `grep -n '_mode' lib/email.js` sin una línea `let _mode` la delata. */
let _mode = null;       // 'gmail_oauth' | 'resend' | 'cpanel' | 'smtp2' | 'smtp_alternado' | null
let _fallbackTransport = null;

function credencialesBuzon(sufijo) {
  const user = process.env[`CPANEL_SMTP_USER${sufijo}`];
  const pass = process.env[`CPANEL_SMTP_PASS${sufijo}`];
  const host = process.env[`CPANEL_SMTP_HOST${sufijo}`]
    || (sufijo === '' ? 'mail.gestekeventost.dpdns.org' : undefined);
  const port = Number(process.env[`CPANEL_SMTP_PORT${sufijo}`] || 465);
  return { user, pass, host, port };
}

function init() {
  if (_mode !== null) return;

  /* Buzón 1 (CPANEL_SMTP_*, el histórico) y buzón 2 (CPANEL_SMTP_*2, pensado
     para Hostinger u otro proveedor). Los nombres de variable del buzón 1 no
     cambian a propósito: ya están puestos en Render y renombrarlos apagaría
     el correo en el siguiente despliegue sin que nadie lo pida. */
  for (const [id, sufijo] of [['cpanel', ''], ['smtp2', '2']]) {
    const { user, pass, host, port } = credencialesBuzon(sufijo);
    if (!user || !pass) continue;
    if (!host) {
      console.warn(`[email] ${id}: falta CPANEL_SMTP_HOST${sufijo}, no se puede activar.`);
      continue;
    }
    try {
      const nodemailer = require('nodemailer');
      const transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465, // true para 465 (SSL), false para 587 (STARTTLS)
        auth: { user, pass },
      });
      _buzones.push({ id, sufijo, host, port, user, transport });
      console.log(`[email] buzón «${id}» activado para:`, user);
    } catch (e) {
      console.warn(`[email] no se pudo inicializar el buzón «${id}»:`, e.message);
    }
  }

  if (_buzones.length) {
    _mode = _buzones.length > 1 ? 'smtp_alternado' : _buzones[0].id;
    if (_buzones.length > 1) {
      console.log(`[email] ${_buzones.length} buzones activos, alternando envíos entre: ${_buzones.map(b => b.id).join(', ')}`);
    }
    return;
  }

  /* Sin ningún buzón SMTP de plataforma: se cae al fallback de siempre. */

  /* 2) Gmail OAuth2 */
  const gUser = process.env.GMAIL_USER;
  const gClientId = process.env.GMAIL_CLIENT_ID;
  const gClientSecret = process.env.GMAIL_CLIENT_SECRET;
  const gRefreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (gUser && gClientId && gClientSecret && gRefreshToken) {
    try {
      const nodemailer = require('nodemailer');
      _fallbackTransport = nodemailer.createTransport({
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
  if (_buzones.length) {
    return process.env.EMAIL_FROM || `GESTEK <${_buzones[0].user}>`;
  }
  return process.env.EMAIL_FROM || `GESTEK <${process.env.GMAIL_USER || 'noreply@gestek.app'}>`;
}

/* El remitente técnico de UN buzón en concreto. Con dos buzones alternando,
   cada uno SÓLO puede mandar como su propia dirección: proveedores como
   Hostinger rechazan el envío si el `From` no es el mismo buzón autenticado
   («Sender address rejected: not owned by user...»), así que un `EMAIL_FROM`
   compartido entre los dos rompe al que no coincida con él.

   `EMAIL_FROM` (sin sufijo) sigue siendo la de siempre para el buzón 1 — no
   se toca para no cambiar lo que ya hay en Render. `EMAIL_FROM2` es el
   equivalente opcional para el buzón 2; sin ella se usa su propio usuario,
   que es justo la dirección que el proveedor sí va a aceptar. */
function remitenteDe(buzon) {
  return process.env[`EMAIL_FROM${buzon.sufijo}`] || `GESTEK <${buzon.user}>`;
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
function fromAddress(nombreVisible, realOverride) {
  const real = realOverride || direccionReal();
  if (!nombreVisible) return real;
  /* Comillas y saltos fuera: un nombre con `"` o `\n` permite inyectar
     cabeceras en el mensaje. */
  const limpio = String(nombreVisible).replace(/["\r\n<>]/g, '').trim().slice(0, 70);
  if (!limpio) return real;
  return `"${limpio}" <${soloDireccion(real)}>`;
}

/* Transportes de los buzones propios de cada evento, cacheados por evento.
   Crear uno por correo abriría una conexión nueva en cada envío, que es justo
   lo que hace que un proveedor te corte por abuso. */
const _transportesEvento = new Map();

function transporteDeEvento(smtp) {
  const clave = `${smtp.host}:${smtp.port}:${smtp.user}`;
  if (_transportesEvento.has(clave)) return _transportesEvento.get(clave);
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    pool: true,          // reutiliza la conexión entre envíos
    maxConnections: 2,   // conservador: es el buzón de otra persona
  });
  _transportesEvento.set(clave, t);
  return t;
}

/* Cuando cambian las credenciales hay que tirar el transporte viejo, o se
   seguiría usando la contraseña anterior hasta reiniciar el servidor. */
function olvidarTransporte(smtp) {
  if (!smtp) return;
  _transportesEvento.delete(`${smtp.host}:${smtp.port}:${smtp.user}`);
}

async function sendMail({ to, subject, html, replyTo, fromName, attachments, smtp }) {
  const destinatarios = (Array.isArray(to) ? to : [to]).filter(e => e && e.includes('@'));
  if (destinatarios.length === 0) return { ok: false, skipped: 'no_recipients' };

  /* Buzón propio del organizador: el correo sale de su cuenta, así que la
     autenticación ya es correcta y el `From` es suyo de verdad — sin tocar
     DNS. Si no lo hay, se usa el de la plataforma. */
  if (smtp) {
    const from = smtp.remitenteNombre
      ? `"${String(smtp.remitenteNombre).replace(/["\r\n<>]/g, '').slice(0, 70)}" <${smtp.remitente}>`
      : smtp.remitente;
    const responder = smtp.responderA || replyTo;
    try {
      const info = await transporteDeEvento(smtp).sendMail({
        from,
        to: destinatarios.join(','),
        subject,
        html,
        ...(responder && String(responder).includes('@') ? { replyTo: soloDireccion(responder) } : {}),
        ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
      });
      console.log('[email] (buzón del evento) enviado OK:', info.messageId);
      return { ok: true, via: 'evento' };
    } catch (e) {
      /* No se cae a la plataforma en silencio: si el organizador puso su
         buzón, mandar desde otro remitente sin avisar es peor que fallar. */
      console.error('[email] falló el buzón del evento:', e.code, e.message);
      olvidarTransporte(smtp);
      return { ok: false, error: `Buzón del evento: ${e.message}` };
    }
  }

  init();
  if (!_mode) return { ok: false, skipped: 'no_provider' };

  const from = fromAddress(fromName);
  const responderA = replyTo && String(replyTo).includes('@') ? soloDireccion(replyTo) : null;
  const adjuntos = Array.isArray(attachments) ? attachments.filter(Boolean) : [];

  /* Buzones SMTP de plataforma (uno o dos). Con dos, cada llamada empieza por
     el que le toca según el turno y, si ése falla, prueba el otro antes de
     rendirse — alternar reparte la carga en el camino feliz, pero un fallo de
     uno no debe costar el correo si el otro sí podía mandarlo. */
  if (_buzones.length) {
    const orden = _buzones.length > 1
      ? [..._buzones.slice(_rr % _buzones.length), ..._buzones.slice(0, _rr % _buzones.length)]
      : _buzones;
    _rr = (_rr + 1) % _buzones.length;

    let ultimoError = null;
    for (const buzon of orden) {
      /* El `from` de cada buzón es el suyo propio, no el de arriba: ver
         remitenteDe(). Si aquí se usara el `from` genérico, el buzón que no
         coincida con EMAIL_FROM se lo rechazaría el proveedor de correo. */
      const fromDeEsteBuzon = fromAddress(fromName, remitenteDe(buzon));
      try {
        console.log(`[email] (buzón «${buzon.id}») enviando a:`, destinatarios);
        const info = await buzon.transport.sendMail({
          from: fromDeEsteBuzon,
          to: destinatarios.join(','),
          subject,
          html,
          ...(responderA ? { replyTo: responderA } : {}),
          ...(adjuntos.length ? { attachments: adjuntos } : {}),
        });
        console.log(`[email] enviado OK por «${buzon.id}»:`, info.messageId);
        return { ok: true, via: buzon.id };
      } catch (e) {
        console.error(`[email] falló el buzón «${buzon.id}»:`, e.code, e.message);
        ultimoError = e;
      }
    }
    /* Los dos (o el único) buzones SMTP fallaron: no hay a qué más caer salvo
       que también haya Gmail/Resend configurados, que hoy sólo se activan
       cuando NINGÚN buzón SMTP está puesto — así que aquí se devuelve el
       último error real en vez de intentar un fallback que no existe. */
    return { ok: false, error: ultimoError?.message || 'Fallaron los buzones SMTP configurados.' };
  }

  try {
    if (_mode === 'gmail_oauth') {
      console.log(`[email] (${_mode}) enviando a:`, destinatarios);
      const info = await _fallbackTransport.sendMail({
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
    if (!resp.ok) {
      /* El cuerpo de la respuesta es donde Resend dice QUÉ pasa; devolver sólo
         el código dejaba «Resend 422» como único rastro, que no le sirve a
         nadie para arreglarlo. Los dos motivos que se ven en la práctica son
         el dominio sin verificar y el modo de pruebas, así que se traducen. */
      let detalle = '';
      try {
        const cuerpo = await resp.json();
        detalle = cuerpo?.message || cuerpo?.error || '';
      } catch { /* si no vino JSON, nos quedamos con el código */ }

      const t = String(detalle);
      let pista = '';
      if (/domain is not verified|not verified/i.test(t)) {
        pista = ' → El dominio del remitente no está verificado en Resend. Verifícalo en resend.com/domains (pide unos registros DNS) o usa onboarding@resend.dev mientras tanto.';
      } else if (/testing emails|own email address/i.test(t)) {
        pista = ' → Resend está en modo de pruebas: sin dominio verificado sólo deja escribir a la dirección de tu propia cuenta.';
      }

      /* La pista va DELANTE del detalle a propósito: el motivo se recorta al
         guardarlo, y lo que tiene que sobrevivir al recorte es lo que hay que
         hacer, no la redacción de Resend. */
      const error = `Resend ${resp.status}${pista}${detalle ? ` (${detalle})` : ''}`;
      console.error('[email] Resend rechazó el envío:', error);
      return { ok: false, error };
    }
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
  _buzones = [];
  _rr = 0;
  _fallbackTransport = null;
  _mode = null;
}

function explicar(e, info) {
  const codigo = e?.code || '';
  const texto = String(e?.message || '');
  const host = info?.host || process.env.CPANEL_SMTP_HOST;
  const port = info?.port || process.env.CPANEL_SMTP_PORT || 465;

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
      mensaje: `No existe el servidor «${host || '(sin definir)'}».`,
      sugerencia: 'Comprueba el nombre. Suele ser mail.tudominio.com (o smtp.hostinger.com en Hostinger), y lo confirma el propio panel del proveedor en «Cuentas de correo → Conectar dispositivos».',
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
      sugerencia: 'Rellena CPANEL_SMTP_USER/PASS/HOST/PORT (buzón 1) y, si quieres un segundo buzón alternando, CPANEL_SMTP_USER2/PASS2/HOST2/PORT2; o el OAuth de Gmail; o RESEND_API_KEY.',
    };
  }

  /* Con uno o dos buzones SMTP de plataforma, cada uno se verifica por su
     cuenta — `ok` general es true si AL MENOS uno responde, porque con dos
     buzones el correo sigue saliendo aunque uno esté caído; pero el detalle
     por buzón es lo que hay que mirar para saber cuál falla y por qué. */
  if (_buzones.length) {
    const resultados = await Promise.all(_buzones.map(async (buzon) => {
      try {
        await buzon.transport.verify();
        return { id: buzon.id, host: buzon.host, ok: true, mensaje: `Conexión correcta con ${buzon.host}:${buzon.port}.`, sugerencia: '' };
      } catch (e) {
        return { id: buzon.id, host: buzon.host, ok: false, ...explicar(e, buzon) };
      }
    }));

    const algunoOk = resultados.some(r => r.ok);
    const primero = resultados[0];
    return {
      ok: algunoOk,
      modo: _mode,
      buzones: resultados,
      mensaje: resultados.length > 1
        ? resultados.map(r => `${r.id}: ${r.ok ? 'OK' : 'MAL'}`).join(' · ')
        : primero.mensaje,
      sugerencia: algunoOk ? '' : (resultados.find(r => !r.ok)?.sugerencia || ''),
      causa: algunoOk ? undefined : resultados.find(r => !r.ok)?.causa,
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
    await _fallbackTransport.verify();
    return {
      ok: true,
      modo: _mode,
      mensaje: 'Conexión correcta con Gmail.',
      sugerencia: '',
    };
  } catch (e) {
    return { ok: false, modo: _mode, ...explicar(e) };
  }
}

module.exports = { sendMail, verificarConexion, reiniciar, olvidarTransporte };
