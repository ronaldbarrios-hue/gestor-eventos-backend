/* Wompi — pasarela colombiana (Nequi, Bre-B/PSE, Bancolombia, tarjetas).
   Paralelo a Mercado Pago, sin tocarlo. Cada organizador conecta SUS llaves.
   Flujo: /comprar-wompi crea la boleta + transacción y devuelve la URL del
   Web Checkout firmada; al pagar, Wompi llama /webhooks/wompi y confirmamos.

   REQUIERE que el organizador pegue sus llaves de Wompi (pub_/prv_ + secretos
   de integridad y de eventos). Inerte hasta entonces. */
const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT, verifySupabaseJWTOptional } = require('../middleware/auth.js');
const { signTicketQR } = require('../lib/qr.js');
const { verifyTurnstile } = require('../lib/turnstile.js');
const { checkoutUrl, verificarEvento } = require('../lib/wompi.js');
const { confirmarTicketPagado } = require('../lib/confirmarTicket.js');

const router = express.Router();

function publicBaseUrl() { return (process.env.FRONTEND_URL || 'https://gestor-eventos-frontend.vercel.app').split(',')[0]; }
function generarCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = ''; for (let i = 0; i < 8; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

/* ── Conectar / desconectar (organizador) ── */
router.post('/me/wompi/conectar', verifySupabaseJWT, async (req, res) => {
  const { public_key, private_key, events_secret, integrity_secret } = req.body || {};
  if (!public_key || !/^pub_(test|prod)_/.test(public_key)) return res.status(400).json({ error: 'Llave pública de Wompi inválida (debe empezar por pub_test_ o pub_prod_).' });
  if (!integrity_secret) return res.status(400).json({ error: 'Falta el secreto de integridad.' });
  if (!events_secret) return res.status(400).json({ error: 'Falta el secreto de eventos.' });
  const { data, error } = await supabase.from('profiles').update({
    wompi_public_key: public_key,
    wompi_private_key: private_key || null,
    wompi_events_secret: events_secret,
    wompi_integrity_secret: integrity_secret,
    wompi_connected_at: new Date().toISOString(),
  }).eq('id', req.user.id).select('wompi_public_key, wompi_connected_at').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ profile: data });
});

router.delete('/me/wompi', verifySupabaseJWT, async (req, res) => {
  const { error } = await supabase.from('profiles').update({
    wompi_public_key: null, wompi_private_key: null, wompi_events_secret: null,
    wompi_integrity_secret: null, wompi_connected_at: null,
  }).eq('id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* Estado (para la UI): ¿el organizador tiene Wompi conectado? */
router.get('/me/wompi', verifySupabaseJWT, async (req, res) => {
  const { data } = await supabase.from('profiles').select('wompi_public_key, wompi_connected_at').eq('id', req.user.id).maybeSingle();
  res.json({ conectado: Boolean(data?.wompi_public_key), public_key: data?.wompi_public_key || null, connected_at: data?.wompi_connected_at || null });
});

/* ── Comprar una boleta con Wompi ── */
router.post('/eventos/publicos/slug/:slug/comprar-wompi', verifySupabaseJWTOptional, async (req, res) => {
  const { slug } = req.params;
  const { ticket_type_id, email, nombre, telefono } = req.body || {};
  if (!ticket_type_id) return res.status(400).json({ error: 'Selecciona un tipo de boleta.' });
  if (!email?.includes('@')) return res.status(400).json({ error: 'Email válido requerido.' });
  if (!nombre?.trim()) return res.status(400).json({ error: 'Tu nombre es requerido.' });

  const cap = await verifyTurnstile(req.body.captcha_token, (req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '').trim());
  if (!cap.ok) return res.status(400).json({ error: 'Verificación anti-bot fallida. Recarga e intenta de nuevo.' });

  const { data: evento } = await supabase.from('eventos')
    .select('id, owner_id, titulo, estado, deleted_at, currency, aforo_total, aforo_vendido').eq('slug', slug).maybeSingle();
  if (!evento || evento.deleted_at || evento.estado !== 'publicado') return res.status(404).json({ error: 'Evento no disponible.' });

  const MAX = Number(process.env.MAX_TICKETS_POR_EMAIL || 5);
  const { count: yaTiene } = await supabase.from('tickets').select('id', { count: 'exact', head: true })
    .eq('evento_id', evento.id).eq('guest_email', email.toLowerCase().trim());
  if ((yaTiene || 0) >= MAX) return res.status(429).json({ error: `Alcanzaste el máximo de ${MAX} boletas con este email para este evento.` });

  const { data: owner } = await supabase.from('profiles')
    .select('wompi_public_key, wompi_integrity_secret').eq('id', evento.owner_id).single();
  if (!owner?.wompi_public_key || !owner?.wompi_integrity_secret) return res.status(400).json({ error: 'El organizador aún no conectó Wompi.' });

  const { data: tipo } = await supabase.from('ticket_types').select('*').eq('id', ticket_type_id).eq('evento_id', evento.id).maybeSingle();
  if (!tipo) return res.status(404).json({ error: 'Tipo de boleta no encontrado.' });
  if (!tipo.activo) return res.status(400).json({ error: 'Este tipo de boleta no está disponible.' });
  if (tipo.venta_hasta && new Date(tipo.venta_hasta) < new Date()) return res.status(400).json({ error: 'La venta de este tipo de boleta ya cerró.' });
  if (tipo.cupo != null && tipo.vendidos >= tipo.cupo) return res.status(400).json({ error: 'Este tipo de boleta está agotado.', waitlistAvailable: true });
  if (evento.aforo_total && evento.aforo_vendido >= evento.aforo_total) return res.status(400).json({ error: 'El evento está al aforo máximo.', waitlistAvailable: true });

  const hasEarly = tipo.early_bird_precio != null && tipo.early_bird_hasta && new Date(tipo.early_bird_hasta) > new Date();
  const precio = hasEarly ? Number(tipo.early_bird_precio) : Number(tipo.precio);
  if (precio <= 0) return res.status(400).json({ error: 'Este tipo de boleta es gratis. Usa la reserva directa.' });
  const currency = evento.currency || tipo.currency || 'COP';

  /* Campos de formulario obligatorios (globales + de este tipo). */
  const { data: campos } = await supabase.from('event_form_fields').select('id, etiqueta, requerido, ticket_type_id').eq('evento_id', evento.id);
  const respuestas = req.body.respuestas && typeof req.body.respuestas === 'object' ? req.body.respuestas : {};
  for (const c of campos || []) {
    if (c.ticket_type_id && c.ticket_type_id !== tipo.id) continue;
    if (c.requerido && (respuestas[c.id] === undefined || respuestas[c.id] === null || respuestas[c.id] === '')) {
      return res.status(400).json({ error: `El campo "${c.etiqueta}" es obligatorio.` });
    }
  }

  const codigo = generarCodigo();
  const { data: ticket, error: eT } = await supabase.from('tickets').insert({
    ticket_type_id: tipo.id, evento_id: evento.id,
    guest_email: email.toLowerCase().trim(), guest_nombre: nombre.trim(),
    codigo, estado: 'emitido', respuestas: Object.keys(respuestas).length ? respuestas : null,
  }).select().single();
  if (eT) return res.status(500).json({ error: eT.message });
  const qr_token = signTicketQR({ ticket_id: ticket.id, evento_id: evento.id, codigo: ticket.codigo });
  await supabase.from('tickets').update({ qr_token }).eq('id', ticket.id);

  const referencia = `tx_${ticket.id}`;
  const amountInCents = Math.round(precio * 100);
  await supabase.from('payment_transactions').insert({
    evento_id: evento.id, ticket_id: ticket.id, ticket_type_id: tipo.id,
    gateway: 'wompi', referencia, status: 'pending', monto: precio, currency,
    guest_email: email.toLowerCase().trim(), guest_nombre: nombre.trim(), guest_telefono: telefono || null,
  });

  const url = checkoutUrl({
    publicKey: owner.wompi_public_key, currency, amountInCents, reference: referencia,
    redirectUrl: `${publicBaseUrl()}/mi-ticket/${ticket.codigo}?pago=wompi`,
    integritySecret: owner.wompi_integrity_secret,
  });

  res.status(201).json({ ticket: { id: ticket.id, codigo: ticket.codigo, estado: ticket.estado }, checkout: { url } });
});

/* ── Webhook de Wompi (Events) ── */
router.post('/webhooks/wompi', async (req, res) => {
  res.status(200).json({ received: true });   // Wompi solo requiere 200
  try {
    const trx = req.body?.data?.transaction;
    const referencia = trx?.reference;
    if (!referencia || !referencia.startsWith('tx_')) return;
    const ticketId = referencia.slice(3);

    /* La transacción dice a qué ticket/evento pertenece → sacamos el secreto
       de eventos del organizador para VERIFICAR el checksum. */
    const { data: tk } = await supabase.from('tickets').select('id, evento_id').eq('id', ticketId).maybeSingle();
    if (!tk) return;
    const { data: ev } = await supabase.from('eventos').select('owner_id').eq('id', tk.evento_id).maybeSingle();
    const { data: owner } = await supabase.from('profiles').select('wompi_events_secret').eq('id', ev?.owner_id).maybeSingle();
    if (!verificarEvento(req.body, owner?.wompi_events_secret)) {
      console.warn('[webhook Wompi] checksum inválido para', referencia);
      return;
    }

    const status = String(trx?.status || '').toUpperCase();
    const monto = Number(trx?.amount_in_cents || 0) / 100;
    /* Actualiza la transacción pendiente. */
    const { data: pend } = await supabase.from('payment_transactions')
      .select('id').eq('referencia', referencia).eq('gateway', 'wompi').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (pend) await supabase.from('payment_transactions').update({ status: status.toLowerCase(), payment_id: String(trx.id || ''), raw: req.body }).eq('id', pend.id);

    if (status === 'APPROVED') await confirmarTicketPagado(ticketId, monto, 'wompi');
  } catch (e) {
    console.error('[webhook Wompi] error:', e.message);
  }
});

module.exports = router;
