/* GESTEK — Envío de email transaccional.
   Prioridad: cPanel SMTP → Gmail OAuth2 → Resend → no-op */
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

/* ────────────────────────────────────────────────────────────
   Layout compartido — todos los correos usan el mismo "cascarón":
   portada del evento arriba (si hay), luego una tarjeta con el
   contenido, y el footer de GESTEK. Diseño oscuro, consistente
   con la plataforma. */

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtFecha(fechaIso) {
  if (!fechaIso) return null;
  try {
    return new Date(fechaIso).toLocaleString('es-CO', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return null; }
}

function emailLayout({ kicker, coverUrl, eventoTitulo, bodyHtml, ctaText, ctaUrl, footerNote }) {
  const frontendUrl = (process.env.FRONTEND_URL || 'https://gestor-eventos-frontend.vercel.app').split(',')[0];
  const hero = coverUrl
    ? `
      <tr>
        <td style="padding:0;">
          <div style="position:relative;width:100%;height:180px;background:#0D1525;border-radius:20px 20px 0 0;overflow:hidden;">
            <img src="${escapeHtml(coverUrl)}" alt="" width="100%" height="180"
                 style="display:block;width:100%;height:180px;object-fit:cover;" />
            <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,12,24,0) 40%,rgba(7,12,24,0.92) 100%);"></div>
            <div style="position:absolute;left:22px;right:22px;bottom:16px;">
              ${kicker ? `<p style="margin:0 0 4px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#C7B6FF;font-weight:700;">${escapeHtml(kicker)}</p>` : ''}
              ${eventoTitulo ? `<p style="margin:0;font-size:19px;font-weight:700;color:#F8FAFC;line-height:1.25;">${escapeHtml(eventoTitulo)}</p>` : ''}
            </div>
          </div>
        </td>
      </tr>`
    : `
      <tr>
        <td style="padding:28px 28px 0;">
          ${kicker ? `<p style="margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8B7CF6;font-weight:700;">${escapeHtml(kicker)}</p>` : ''}
          ${eventoTitulo ? `<p style="margin:0;font-size:20px;font-weight:700;color:#F8FAFC;">${escapeHtml(eventoTitulo)}</p>` : ''}
        </td>
      </tr>`;

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#04070D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#04070D;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0A1120;border:1px solid #1B2436;border-radius:20px;overflow:hidden;">
          ${hero}
          <tr>
            <td style="padding:28px 28px 8px;">
              ${bodyHtml}
            </td>
          </tr>
          ${ctaText && ctaUrl ? `
          <tr>
            <td style="padding:4px 28px 28px;">
              <a href="${escapeHtml(ctaUrl)}"
                 style="display:inline-block;background:#F8FAFC;color:#04070D;padding:13px 28px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px;">
                ${escapeHtml(ctaText)}
              </a>
            </td>
          </tr>` : ''}
          <tr>
            <td style="padding:18px 28px 26px;border-top:1px solid #151D2E;">
              <p style="margin:0;font-size:12px;color:#5B6478;line-height:1.6;">
                ${footerNote || 'Enviado automáticamente por tu evento en GESTEK.'}<br/>
                <a href="${frontendUrl}" style="color:#8B7CF6;text-decoration:none;">gestek.app</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ────────────────────────────────────────────────────────────
   Plantilla: confirmación de entrada (gratis o pagada) */
function plantillaTicket({ eventoTitulo, eventoCoverUrl, eventoFecha, eventoLugar, nombre, codigo, qrToken, tipoNombre, linkTicket, gratis }) {
  const fecha = fmtFecha(eventoFecha);
  const qrValue = qrToken || codigo;
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(qrValue)}`;

  const body = `
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#34D399;font-weight:700;">
      ${gratis ? 'Reserva confirmada' : 'Compra confirmada'}
    </p>
    <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#F8FAFC;line-height:1.3;">
      ¡Tu entrada está lista${nombre ? `, ${escapeHtml(nombre.split(' ')[0])}` : ''}!
    </h1>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#94A3B8;">
      ${gratis ? 'Reservaste' : 'Compraste'} <strong style="color:#E2E8F0;">${escapeHtml(tipoNombre || 'una entrada')}</strong> para este evento. Muestra el código QR de abajo en la entrada — también puedes usar el link para verlo cuando quieras.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
      <tr>
        <td align="center">
          <div style="display:inline-block;background:#ffffff;padding:14px;border-radius:16px;">
            <img src="${qrImgUrl}" width="220" height="220" alt="Código QR de tu entrada" style="display:block;width:220px;height:220px;" />
          </div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:#0D1525;border:1px dashed #2A3550;border-radius:16px;margin-bottom:22px;">
      <tr><td style="padding:20px 20px 14px;">
        ${fecha ? `<p style="margin:0 0 3px;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.08em;">Fecha</p>
        <p style="margin:0 0 14px;font-size:14px;color:#E2E8F0;text-transform:capitalize;">${fecha}</p>` : ''}
        ${eventoLugar ? `<p style="margin:0 0 3px;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.08em;">Lugar</p>
        <p style="margin:0 0 14px;font-size:14px;color:#E2E8F0;">${escapeHtml(eventoLugar)}</p>` : ''}
      </td></tr>
      <tr><td style="border-top:1px dashed #2A3550;padding:16px 20px;">
        <p style="margin:0 0 3px;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.08em;">Código de tu entrada</p>
        <p style="margin:0;font-size:24px;font-weight:800;color:#F8FAFC;letter-spacing:.08em;font-family:monospace;">${escapeHtml(codigo)}</p>
      </td></tr>
    </table>`;

  return emailLayout({
    kicker: gratis ? 'Tu entrada' : 'Tu entrada · pagada',
    coverUrl: eventoCoverUrl,
    eventoTitulo,
    bodyHtml: body,
    ctaText: 'Ver mi entrada',
    ctaUrl: linkTicket,
  });
}

/* ────────────────────────────────────────────────────────────
   Plantilla: invitación al equipo de un evento */
function plantillaInvitacionEquipo({ eventoTitulo, eventoCoverUrl, rolNombre, link }) {
  const body = `
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8B7CF6;font-weight:700;">Invitación al equipo</p>
    <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#F8FAFC;line-height:1.3;">¡Te sumaron a un equipo!</h1>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#94A3B8;">
      Fuiste invitado como <strong style="color:#E2E8F0;">${escapeHtml(rolNombre)}</strong>
      ${eventoTitulo ? ` en <strong style="color:#E2E8F0;">${escapeHtml(eventoTitulo)}</strong>` : ''}.
      Ya podés entrar y ver tus tareas y permisos.
    </p>`;

  return emailLayout({
    kicker: 'GESTEK · Equipo',
    coverUrl: eventoCoverUrl,
    eventoTitulo,
    bodyHtml: body,
    ctaText: 'Ver el evento',
    ctaUrl: link,
  });
}

/* ────────────────────────────────────────────────────────────
   Plantilla: nueva tarea asignada */
function plantillaTarea({ nombre, tareaTitulo, eventoTitulo, eventoCoverUrl, prioridad, venceAt, link }) {
  const venc = fmtFecha(venceAt);
  const prioColor = { urgente: '#F87171', alta: '#FBBF24', normal: '#60A5FA', baja: '#94A3B8' }[prioridad] || '#60A5FA';
  const body = `
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8B7CF6;font-weight:700;">Nueva tarea asignada</p>
    <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#F8FAFC;line-height:1.3;">${escapeHtml(tareaTitulo)}</h1>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#94A3B8;">
      Hola ${escapeHtml(nombre || '')}, te asignaron esta tarea${eventoTitulo ? ` en <strong style="color:#E2E8F0;">${escapeHtml(eventoTitulo)}</strong>` : ''}.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0D1525;border:1px solid #1e293b;border-radius:16px;margin-bottom:22px;">
      <tr><td style="padding:18px 20px;">
        <p style="margin:0 0 4px;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.08em;">Prioridad</p>
        <p style="margin:0 0 ${venc ? '14px' : '0'};font-size:15px;font-weight:700;color:${prioColor};text-transform:capitalize;">${escapeHtml(prioridad || 'normal')}</p>
        ${venc ? `<p style="margin:0 0 4px;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.08em;">Vence</p><p style="margin:0;font-size:15px;color:#E2E8F0;text-transform:capitalize;">${venc}</p>` : ''}
      </td></tr>
    </table>`;

  return emailLayout({
    kicker: 'GESTEK · Tareas',
    coverUrl: eventoCoverUrl,
    eventoTitulo,
    bodyHtml: body,
    ctaText: 'Ver la tarea',
    ctaUrl: link,
  });
}

module.exports = { sendMail, plantillaTarea, plantillaTicket, plantillaInvitacionEquipo };
