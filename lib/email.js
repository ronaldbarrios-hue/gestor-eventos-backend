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

function fromAddress() {
  if (_mode === 'cpanel_smtp') {
    return process.env.EMAIL_FROM || `GESTEK <${process.env.CPANEL_SMTP_USER}>`;
  }
  return process.env.EMAIL_FROM || `GESTEK <${process.env.GMAIL_USER || 'noreply@gestek.app'}>`;
}

async function sendMail({ to, subject, html }) {
  init();
  const destinatarios = (Array.isArray(to) ? to : [to]).filter(e => e && e.includes('@'));
  if (destinatarios.length === 0) return { ok: false, skipped: 'no_recipients' };
  if (!_mode) return { ok: false, skipped: 'no_provider' };

  try {
    if (_mode === 'cpanel_smtp' || _mode === 'gmail_oauth') {
      console.log(`[email] (${_mode}) enviando a:`, destinatarios);
      const info = await _transport.sendMail({
        from: fromAddress(),
        to: destinatarios.join(','),
        subject,
        html,
      });
      console.log('[email] enviado OK:', info.messageId);
      return { ok: true };
    }

    /* resend */
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromAddress(), to: destinatarios, subject, html }),
    });
    if (!resp.ok) return { ok: false, error: `Resend ${resp.status}` };
    return { ok: true };
  } catch (e) {
    console.error(`[email] ERROR (${_mode}):`, e.code, e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendMail };
