/* GESTEK — Correos del evento.
   Valida JWT + propiedad del evento y DELEGA el envío al microservicio
   `gestek-mail-service` cuando MAIL_SERVICE_URL está configurada.
   Sin esa variable usa la implementación local de este archivo (respaldo),
   para que la migración al microservicio no deje el correo caído.

   Usa las plantillas que el organizador diseña en el frontend
   (evento.page_json.emails[tipo]) y el SMTP propio de lib/email.js.

   Endpoints (montados en /):
   - POST /eventos/:id/emails/prueba   { tipo }                → envío de prueba al owner
   - POST /eventos/:id/emails/enviar   { tipo, audiencia }     → campaña segmentada

   audiencia: 'todos' | 'equipo' | 'tipo:<ticket_type_id>'
*/

const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { sendMail } = require('../lib/email.js');

const router = express.Router();

const MAX_DESTINATARIOS = 500;  // tope de seguridad por envío
const LOTE = 5;                 // concurrencia para no saturar el SMTP

/* ─────────── Delegación al microservicio de correo ───────────
   Si MAIL_SERVICE_URL está configurada, este router solo valida el JWT y que
   el usuario sea dueño del evento, y delega el envío al microservicio
   (gestek-mail-service) con el secreto compartido.
   Si NO está configurada, se usa la implementación local de abajo — así la
   migración al microservicio no deja el correo caído en ningún momento. */
const MAIL_URL = (process.env.MAIL_SERVICE_URL || '').replace(/\/$/, '');
const MAIL_KEY = process.env.MAIL_SERVICE_KEY || '';

async function delegar(ruta, payload) {
  const r = await fetch(`${MAIL_URL}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-gestek-key': MAIL_KEY },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

/* ─────────── helpers ─────────── */

async function getEventoOwner(eventoId, userId) {
  const { data } = await supabase
    .from('eventos')
    .select('id, titulo, slug, owner_id, fecha_inicio, location_nombre, page_json')
    .eq('id', eventoId).maybeSingle();
  if (!data) return { error: 'Evento no encontrado.', status: 404 };
  if (String(data.owner_id) !== String(userId)) return { error: 'No autorizado.', status: 403 };
  return { evento: data };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(txt, ctx) {
  return String(txt == null ? '' : txt)
    .replace(/\{\{nombre\}\}/g, ctx.nombre || '')
    .replace(/\{\{evento\}\}/g, ctx.evento || '')
    .replace(/\{\{fecha\}\}/g, ctx.fecha || '')
    .replace(/\{\{lugar\}\}/g, ctx.lugar || '')
    .replace(/\{\{tipo_boleta\}\}/g, ctx.tipo_boleta || '')
    .replace(/\{\{codigo\}\}/g, ctx.codigo || '');
}

/* Arma el HTML del correo a partir de la plantilla del organizador. */
function construirHtml(plantilla, ctx) {
  const enc = esc(render(plantilla.encabezado, ctx));
  const cuerpo = esc(render(plantilla.cuerpo, ctx)).replace(/\n/g, '<br/>');
  const footer = esc(render(plantilla.footer, ctx)) || esc(ctx.evento);
  const btnTexto = esc(render(plantilla.boton_texto, ctx));
  const btnUrl = String(plantilla.boton_url || '').trim();
  const btnOk = btnTexto && /^https?:\/\//i.test(btnUrl);
  const img = String(plantilla.imagen || '').trim();
  const imgOk = /^https?:\/\//i.test(img);

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6fb;font-family:Inter,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e9f0;">
      ${imgOk ? `<tr><td><img src="${esc(img)}" alt="" style="display:block;width:100%;max-height:220px;object-fit:cover;"/></td></tr>` : ''}
      <tr><td style="padding:28px 28px 8px 28px;text-align:center;">
        ${enc ? `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.25;color:#0a0f1a;">${enc}</h1>` : ''}
        ${cuerpo ? `<p style="margin:0;font-size:15px;line-height:1.6;color:#475569;">${cuerpo}</p>` : ''}
      </td></tr>
      ${ctx.codigo ? `<tr><td style="padding:16px 28px 0 28px;text-align:center;">
        <div style="display:inline-block;padding:10px 18px;border:1px solid #e6e9f0;border-radius:12px;">
          <div style="font-size:10px;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Código</div>
          <div style="font-size:20px;font-weight:700;letter-spacing:3px;color:#0a0f1a;">${esc(ctx.codigo)}</div>
        </div></td></tr>` : ''}
      ${btnOk ? `<tr><td style="padding:22px 28px 4px 28px;text-align:center;">
        <a href="${esc(btnUrl)}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:#3B82F6;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">${btnTexto}</a>
      </td></tr>` : ''}
      <tr><td style="padding:24px 28px;text-align:center;border-top:1px solid #eef1f6;margin-top:16px;">
        <p style="margin:0;font-size:11px;color:#94a3b8;">${footer}</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function ctxDe(evento, destinatario) {
  return {
    nombre: destinatario.nombre || '',
    evento: evento.titulo || '',
    fecha: evento.fecha_inicio ? new Date(evento.fecha_inicio).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
    lugar: evento.location_nombre || '',
    tipo_boleta: destinatario.tipo_boleta || '',
    codigo: destinatario.codigo || '',
  };
}

/* Resuelve los destinatarios según la audiencia elegida. */
async function resolverDestinatarios(evento, audiencia) {
  if (audiencia === 'equipo') {
    const lista = [];
    const { data: miembros } = await supabase
      .from('event_members')
      .select('email, profile:profiles!user_id(nombre, email)')
      .eq('evento_id', evento.id);
    for (const m of (miembros || [])) {
      const email = m.profile?.email || m.email;
      if (email) lista.push({ email, nombre: m.profile?.nombre || '' });
    }
    const { data: owner } = await supabase.from('profiles').select('nombre, email').eq('id', evento.owner_id).maybeSingle();
    if (owner?.email) lista.push({ email: owner.email, nombre: owner.nombre || '' });
    return lista;
  }

  let q = supabase
    .from('tickets')
    .select('guest_email, guest_nombre, codigo, ticket_type_id, tipo:ticket_types!ticket_type_id(nombre)')
    .eq('evento_id', evento.id)
    .neq('estado', 'invalido');

  if (String(audiencia || '').startsWith('tipo:')) {
    q = q.eq('ticket_type_id', String(audiencia).slice(5));
  }
  const { data: tickets } = await q;
  return (tickets || [])
    .filter(t => t.guest_email)
    .map(t => ({
      email: t.guest_email,
      nombre: t.guest_nombre || '',
      codigo: t.codigo || '',
      tipo_boleta: t.tipo?.nombre || '',
    }));
}

function dedupe(lista) {
  const vistos = new Set();
  const out = [];
  for (const d of lista) {
    const k = String(d.email || '').toLowerCase().trim();
    if (!k || !k.includes('@') || vistos.has(k)) continue;
    vistos.add(k);
    out.push({ ...d, email: k });
  }
  return out;
}

/* ─────────── endpoints ─────────── */

/* POST /eventos/:id/emails/prueba — envía la plantilla al correo del owner */
router.post('/eventos/:id/emails/prueba', verifySupabaseJWT, async (req, res) => {
  const { evento, error, status } = await getEventoOwner(req.params.id, req.user.id);
  if (error) return res.status(status).json({ error });

  const tipo = String(req.body?.tipo || 'personalizado');
  const plantilla = (evento.page_json?.emails || {})[tipo];
  if (!plantilla) return res.status(400).json({ error: 'Esa plantilla aún no está configurada.' });

  const destino = { email: req.user.email, nombre: 'Prueba', codigo: 'ABC123', tipo_boleta: 'General' };

  if (MAIL_URL) {
    const r = await delegar('/prueba', { evento_id: evento.id, tipo, to: destino.email });
    return res.status(r.status).json(r.data);
  }

  const ctx = ctxDe(evento, destino);
  try {
    await sendMail({
      to: destino.email,
      subject: `[Prueba] ${render(plantilla.asunto, ctx) || evento.titulo}`,
      html: construirHtml(plantilla, ctx),
    });
    res.json({ ok: true, enviado_a: destino.email });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo enviar: ' + e.message });
  }
});

/* POST /eventos/:id/emails/enviar — campaña segmentada */
router.post('/eventos/:id/emails/enviar', verifySupabaseJWT, async (req, res) => {
  const { evento, error, status } = await getEventoOwner(req.params.id, req.user.id);
  if (error) return res.status(status).json({ error });

  const tipo = String(req.body?.tipo || 'personalizado');
  const audiencia = String(req.body?.audiencia || 'todos');
  const plantilla = (evento.page_json?.emails || {})[tipo];
  if (!plantilla) return res.status(400).json({ error: 'Esa plantilla aún no está configurada.' });
  if (!String(plantilla.asunto || '').trim()) return res.status(400).json({ error: 'La plantilla necesita un asunto.' });

  if (MAIL_URL) {
    const r = await delegar('/enviar', { evento_id: evento.id, tipo, audiencia });
    return res.status(r.status).json(r.data);
  }

  let destinatarios;
  try { destinatarios = dedupe(await resolverDestinatarios(evento, audiencia)); }
  catch (e) { return res.status(500).json({ error: 'No se pudieron resolver los destinatarios: ' + e.message }); }

  if (destinatarios.length === 0) return res.status(400).json({ error: 'No hay destinatarios para ese segmento.' });
  if (destinatarios.length > MAX_DESTINATARIOS) {
    return res.status(400).json({ error: `Demasiados destinatarios (${destinatarios.length}). El máximo por envío es ${MAX_DESTINATARIOS}.` });
  }

  let enviados = 0;
  const errores = [];
  for (let i = 0; i < destinatarios.length; i += LOTE) {
    const lote = destinatarios.slice(i, i + LOTE);
    await Promise.all(lote.map(async (d) => {
      const ctx = ctxDe(evento, d);
      try {
        await sendMail({
          to: d.email,
          subject: render(plantilla.asunto, ctx),
          html: construirHtml(plantilla, ctx),
        });
        enviados++;
      } catch (e) {
        errores.push({ email: d.email, motivo: e.message });
      }
    }));
  }

  res.json({ enviados, fallidos: errores.length, total: destinatarios.length, errores: errores.slice(0, 20) });
});

module.exports = router;
