/* GESTEK — Envío de email transaccional.
   Prioridad: Gmail OAuth2 → Resend → no-op */
let _transport = null;
let _mode = null;

function init() {
  if (_mode !== null) return;

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

  if (process.env.RESEND_API_KEY) { _mode = 'resend'; return; }

  _mode = null;
  console.warn('[email] sin proveedor configurado. Emails deshabilitados.');
}

function fromAddress() {
  return process.env.EMAIL_FROM || `GESTEK <${process.env.GMAIL_USER || 'noreply@gestek.app'}>`;
}

async function sendMail({ to, subject, html }) {
  init();
  const destinatarios = (Array.isArray(to) ? to : [to]).filter(e => e && e.includes('@'));
  if (destinatarios.length === 0) return { ok: false, skipped: 'no_recipients' };
  if (!_mode) return { ok: false, skipped: 'no_provider' };

  try {
    if (_mode === 'gmail_oauth') {
      console.log('[email] enviando a:', destinatarios);
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
    console.error('[email] ERROR:', e.code, e.message);
    return { ok: false, error: e.message };
  }
}

function plantillaTarea({ nombre, tareaTitulo, eventoTitulo, prioridad, venceAt, link }) {
  const venc = venceAt
    ? new Date(venceAt).toLocaleString('es-CO', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })
    : null;
  const prioColor = { urgente: '#EF4444', alta: '#F59E0B', normal: '#3B82F6', baja: '#64748B' }[prioridad] || '#3B82F6';
  return `<!doctype html><html><body style="margin:0;background:#070C18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#E5E5E5;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <p style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#71717A;margin:0 0 12px;">Nueva tarea asignada</p>
    <h1 style="font-size:26px;font-weight:700;margin:0 0 16px;color:#F1F5F9;line-height:1.2;">${tareaTitulo}</h1>
    <p style="font-size:16px;line-height:1.6;color:#94A3B8;margin:0 0 24px;">Hola ${nombre || ''}, te asignaron una tarea${eventoTitulo ? ` en <strong style="color:#F1F5F9;">${eventoTitulo}</strong>` : ''}.</p>
    <div style="background:#0D1525;border:1px solid #1e293b;border-radius:16px;padding:18px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:13px;color:#94A3B8;">Prioridad</p>
      <p style="margin:0 0 14px;font-size:15px;font-weight:600;color:${prioColor};text-transform:capitalize;">${prioridad || 'normal'}</p>
      ${venc ? `<p style="margin:0 0 6px;font-size:13px;color:#94A3B8;">Vence</p><p style="margin:0;font-size:15px;color:#E5E5E5;text-transform:capitalize;">${venc}</p>` : ''}
    </div>
    <a href="${link}" style="display:inline-block;background:#fafafa;color:#0a0a0a;padding:13px 26px;border-radius:999px;text-decoration:none;font-weight:600;font-size:15px;">Ver la tarea</a>
    <p style="font-size:12px;color:#71717A;margin:28px 0 0;">Enviado por GESTEK Event OS.</p>
  </div></body></html>`;
}

module.exports = { sendMail, plantillaTarea };
