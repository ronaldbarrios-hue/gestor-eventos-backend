/* GESTEK — Pagos con Mercado Pago.
   - POST /eventos/publicos/slug/:slug/comprar   — crea Preference, devuelve init_point.
   - POST /webhooks/mercadopago                  — recibe la notificación, marca ticket pagado.
   - GET  /me/mercadopago/test                   — valida credenciales conectando con MP.
   - POST /me/mercadopago/conectar               — guarda credenciales (access_token, public_key).
   - DELETE /me/mercadopago                      — desconecta. */
const express = require('express');
const crypto  = require('crypto');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT, verifySupabaseJWTOptional } = require('../middleware/auth.js');
const { signTicketQR } = require('../lib/qr.js');
const mp = require('../lib/mercadopago.js');
const { dispatch } = require('../lib/webhooks.js');
const { verifyTurnstile } = require('../lib/turnstile.js');
const { enviarEmailEvento } = require('../lib/emailPlantillas.js');
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || null;
function verifyMPSignature(req) {
  if (!MP_WEBHOOK_SECRET) return { ok: true, reason: 'no_secret_configured' };
  const sigHeader = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  if (!sigHeader || !requestId) return { ok: false, reason: 'missing_headers' };
  const parts = String(sigHeader).split(',').reduce((acc, part) => {
    const [k, v] = part.split('=').map(s => s.trim());
    if (k && v) acc[k] = v;
    return acc;
  }, {});
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return { ok: false, reason: 'malformed_signature' };
  const tsAge = Math.abs(Date.now() / 1000 - Number(ts));
  if (tsAge > 300) return { ok: false, reason: 'timestamp_too_old' };
  const dataId = req.body?.data?.id || req.query?.['data.id'] || req.query?.id || '';
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const hmac = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex');
  if (hmac !== v1) return { ok: false, reason: 'signature_mismatch' };
  return { ok: true };
}
const router = express.Router();
function generarCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
const PLAN_PRO_PRICE = Number(process.env.PLAN_PRO_PRICE || 79900);
const PLAN_PRO_CURRENCY = process.env.PLAN_PRO_CURRENCY || 'COP';
const PLAN_PRO_PRICE_USD = Number(process.env.PLAN_PRO_PRICE_USD || 19.99);
const PLAN_PRO_DURATION_DAYS = Number(process.env.PLAN_PRO_DURATION_DAYS || 30);
const PLAN_PRO_TRIAL_DAYS = Number(process.env.PLAN_PRO_TRIAL_DAYS || 14);
function publicBaseUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
}
function apiBaseUrl() {
  return process.env.API_PUBLIC_URL || process.env.BACKEND_URL || 'http://localhost:3000';
}
/* ────────────── Settings del organizador ────────────── */
router.get('/me/mercadopago/test', verifySupabaseJWT, async (req, res) => {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('mp_access_token')
    .eq('id', req.user.id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!profile?.mp_access_token) return res.status(400).json({ error: 'Cuenta de Mercado Pago no conectada.' });
  try {
    const info = await mp.getUserInfo(profile.mp_access_token);
    res.json({ ok: true, mp_user: { id: info.id, nickname: info.nickname, email: info.email, country_id: info.country_id } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
router.post('/me/mercadopago/conectar', verifySupabaseJWT, async (req, res) => {
  const { mp_access_token, mp_public_key } = req.body;
  if (!mp_access_token) return res.status(400).json({ error: 'access_token requerido.' });
  let info;
  try {
    info = await mp.getUserInfo(mp_access_token);
  } catch (e) {
    return res.status(400).json({ error: `Credenciales inválidas: ${e.message}` });
  }
  const { data, error } = await supabase
    .from('profiles')
    .update({
      mp_access_token,
      mp_public_key  : mp_public_key || null,
      mp_user_id     : String(info.id),
      mp_connected_at: new Date().toISOString(),
    })
    .eq('id', req.user.id)
    .select('mp_user_id, mp_public_key, mp_connected_at')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ profile: data, mp_user: { id: info.id, nickname: info.nickname } });
});
router.delete('/me/mercadopago', verifySupabaseJWT, async (req, res) => {
  const { error } = await supabase
    .from('profiles')
    .update({
      mp_access_token: null,
      mp_public_key  : null,
      mp_user_id     : null,
      mp_connected_at: null,
    })
    .eq('id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
/* ────────────── Plan Pro (cuenta receptora = GESTEK) ────────────── */
router.get('/me/plan', verifySupabaseJWT, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at, plan_updated_at, plan_payment_id')
    .eq('id', req.user.id).single();
  if (error) return res.status(500).json({ error: error.message });
  const activo = data?.plan === 'pro' && (!data.plan_expires_at || new Date(data.plan_expires_at) > new Date());
  const enTrial = activo && String(data?.plan_payment_id || '').startsWith('trial_');
  const trialUsado = String(data?.plan_payment_id || '').startsWith('trial_');
  res.json({
    plan: activo ? 'pro' : 'free',
    expires_at: data?.plan_expires_at,
    updated_at: data?.plan_updated_at,
    precio: PLAN_PRO_PRICE,
    currency: PLAN_PRO_CURRENCY,
    precio_usd: PLAN_PRO_PRICE_USD,
    duracion_dias: PLAN_PRO_DURATION_DAYS,
    trial_dias: PLAN_PRO_TRIAL_DAYS,
    en_trial: enTrial,
    trial_disponible: !activo && !trialUsado,
    dev_activation: process.env.ALLOW_DEV_PRO_ACTIVATION === 'true',
  });
});
router.post('/me/plan/pro/trial', verifySupabaseJWT, async (req, res) => {
  const { data: prof, error: e1 } = await supabase
    .from('profiles').select('plan, plan_expires_at, plan_payment_id').eq('id', req.user.id).single();
  if (e1) return res.status(500).json({ error: e1.message });
  const activo = prof?.plan === 'pro' && (!prof.plan_expires_at || new Date(prof.plan_expires_at) > new Date());
  if (activo) return res.status(400).json({ error: 'Ya tienes Pro activo.' });
  if (String(prof?.plan_payment_id || '').startsWith('trial_')) {
    return res.status(400).json({ error: 'Ya usaste tu prueba gratuita.' });
  }
  const venc = new Date(Date.now() + PLAN_PRO_TRIAL_DAYS * 24 * 3600 * 1000);
  const { data, error } = await supabase
    .from('profiles')
    .update({
      plan: 'pro',
      plan_expires_at: venc.toISOString(),
      plan_payment_id: `trial_${Date.now()}`,
      plan_updated_at: new Date().toISOString(),
    })
    .eq('id', req.user.id)
    .select('plan, plan_expires_at').single();
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('payment_transactions').insert({
    user_id: req.user.id, kind: 'plan', status: 'approved',
    monto: 0, currency: 'TRIAL',
    raw: { trial: true, dias: PLAN_PRO_TRIAL_DAYS, at: new Date().toISOString() },
  });
  res.json({ ok: true, profile: data, trial_dias: PLAN_PRO_TRIAL_DAYS });
});
router.post('/me/plan/pro/activar-dev', verifySupabaseJWT, async (req, res) => {
  if (process.env.ALLOW_DEV_PRO_ACTIVATION !== 'true') {
    return res.status(403).json({ error: 'Activación dev no habilitada en este entorno.' });
  }
  const { data: prof } = await supabase
    .from('profiles').select('plan, plan_expires_at').eq('id', req.user.id).single();
  const base = prof?.plan === 'pro' && prof?.plan_expires_at && new Date(prof.plan_expires_at) > new Date()
    ? new Date(prof.plan_expires_at)
    : new Date();
  const nuevoVenc = new Date(base.getTime() + PLAN_PRO_DURATION_DAYS * 24 * 3600 * 1000);
  const { data, error } = await supabase
    .from('profiles')
    .update({
      plan            : 'pro',
      plan_expires_at : nuevoVenc.toISOString(),
      plan_payment_id : `dev_${Date.now()}`,
      plan_updated_at : new Date().toISOString(),
    })
    .eq('id', req.user.id)
    .select('plan, plan_expires_at').single();
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('payment_transactions').insert({
    user_id : req.user.id,
    kind    : 'plan',
    status  : 'approved',
    monto   : 0,
    currency: 'DEV',
    raw     : { dev_activation: true, at: new Date().toISOString() },
  });
  res.json({ ok: true, profile: data });
});
router.post('/me/plan/pro/comprar', verifySupabaseJWT, async (req, res) => {
  const platformToken = process.env.MP_PLATFORM_ACCESS_TOKEN;
  if (!platformToken) {
    return res.status(503).json({ error: 'GESTEK aún no tiene configurada la pasarela de pagos del plan Pro. Contactá al admin.' });
  }
  const { data: profile, error: ep } = await supabase
    .from('profiles').select('id, email, nombre').eq('id', req.user.id).single();
  if (ep) return res.status(500).json({ error: ep.message });
  const externalRef = `plan_${req.user.id}`;
  let preference;
  try {
    preference = await mp.createPreference(platformToken, {
      items: [{
        id          : 'gestek_plan_pro',
        title       : 'GESTEK — Plan Pro',
        description : `Suscripción de ${PLAN_PRO_DURATION_DAYS} días al plan Pro`,
        quantity    : 1,
        currency_id : PLAN_PRO_CURRENCY,
        unit_price  : PLAN_PRO_PRICE,
      }],
      payer: {
        name : profile.nombre || undefined,
        email: profile.email  || req.user.email,
      },
      externalReference: externalRef,
      notificationUrl  : `${apiBaseUrl()}/webhooks/mercadopago`,
      successUrl       : `${publicBaseUrl()}/configuracion?plan=ok`,
      failureUrl       : `${publicBaseUrl()}/planes?pago=fallo`,
      pendingUrl       : `${publicBaseUrl()}/configuracion?plan=pendiente`,
    });
  } catch (e) {
    return res.status(502).json({ error: `Mercado Pago rechazó la preferencia: ${e.message}` });
  }
  await supabase.from('payment_transactions').insert({
    user_id      : req.user.id,
    kind         : 'plan',
    preference_id: preference.id,
    status       : 'pending',
    monto        : PLAN_PRO_PRICE,
    currency     : PLAN_PRO_CURRENCY,
    guest_email  : profile.email,
    guest_nombre : profile.nombre,
    raw          : { preference_id: preference.id, plan: 'pro' },
  });
  res.status(201).json({
    checkout: {
      preference_id: preference.id,
      init_point: preference.init_point,
      sandbox_init_point: preference.sandbox_init_point,
    },
  });
});
/* ────────────── Compra pública ────────────── */
router.post('/eventos/publicos/slug/:slug/comprar', verifySupabaseJWTOptional, async (req, res) => {
  const { slug } = req.params;
  const { ticket_type_id, email, nombre, telefono } = req.body;
  if (!ticket_type_id) return res.status(400).json({ error: 'Selecciona un tipo de boleta.' });
  if (!email?.includes('@')) return res.status(400).json({ error: 'Email válido requerido.' });
  if (!nombre?.trim()) return res.status(400).json({ error: 'Tu nombre es requerido.' });
  const capC = await verifyTurnstile(req.body.captcha_token, (req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '').trim());
  if (!capC.ok) return res.status(400).json({ error: 'Verificación anti-bot fallida. Recargá e intentá de nuevo.' });
  const { data: evento, error: e1 } = await supabase
    .from('eventos')
    .select('id, owner_id, titulo, estado, deleted_at, currency, aforo_total, aforo_vendido')
    .eq('slug', slug).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!evento || evento.deleted_at || evento.estado !== 'publicado')
    return res.status(404).json({ error: 'Evento no disponible.' });
  const MAX_POR_EMAIL = Number(process.env.MAX_TICKETS_POR_EMAIL || 5);
  const { count: yaTiene } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', evento.id)
    .eq('guest_email', email.toLowerCase().trim());
  if ((yaTiene || 0) >= MAX_POR_EMAIL) {
    return res.status(429).json({ error: `Alcanzaste el máximo de ${MAX_POR_EMAIL} boletas con este email para este evento.` });
  }
  const { data: owner, error: eOwner } = await supabase
    .from('profiles').select('mp_access_token').eq('id', evento.owner_id).single();
  if (eOwner) return res.status(500).json({ error: eOwner.message });
  if (!owner?.mp_access_token)
    return res.status(400).json({ error: 'El organizador aún no conectó Mercado Pago.' });
  const { data: tipo, error: e2 } = await supabase
    .from('ticket_types').select('*').eq('id', ticket_type_id).eq('evento_id', evento.id).maybeSingle();
  if (e2) return res.status(500).json({ error: e2.message });
  if (!tipo) return res.status(404).json({ error: 'Tipo de boleta no encontrado.' });
  if (!tipo.activo) return res.status(400).json({ error: 'Este tipo de boleta no está disponible.' });
  if (tipo.venta_hasta && new Date(tipo.venta_hasta) < new Date())
    return res.status(400).json({ error: 'La venta de este tipo de boleta ya cerró.' });
  if (tipo.cupo != null && tipo.vendidos >= tipo.cupo)
    return res.status(400).json({ error: 'Este tipo de boleta está agotado.', waitlistAvailable: true });
  if (evento.aforo_total && evento.aforo_vendido >= evento.aforo_total)
    return res.status(400).json({ error: 'El evento está al aforo máximo.', waitlistAvailable: true });
  const hasEarly = tipo.early_bird_precio != null && tipo.early_bird_hasta && new Date(tipo.early_bird_hasta) > new Date();
  const precioEfectivo = hasEarly ? Number(tipo.early_bird_precio) : Number(tipo.precio);
  if (precioEfectivo <= 0)
    return res.status(400).json({ error: 'Este tipo de boleta es gratis. Usá la reserva directa.' });
  /* Validar campos personalizados del formulario aplicables a este tipo de
     boleta (globales + específicos de `tipo`). */
  const { data: camposReq } = await supabase
    .from('event_form_fields').select('id, etiqueta, requerido, ticket_type_id').eq('evento_id', evento.id);
  const respuestas = req.body.respuestas && typeof req.body.respuestas === 'object' ? req.body.respuestas : {};
  for (const c of camposReq || []) {
    if (c.ticket_type_id && c.ticket_type_id !== tipo.id) continue;
    if (c.requerido) {
      const v = respuestas[c.id];
      if (v === undefined || v === null || v === '') {
        return res.status(400).json({ error: `El campo "${c.etiqueta}" es obligatorio.` });
      }
    }
  }
  const codigo = generarCodigo();
  const { data: ticket, error: e3 } = await supabase
    .from('tickets')
    .insert({
      ticket_type_id: tipo.id,
      evento_id     : evento.id,
      guest_email   : email.toLowerCase().trim(),
      guest_nombre  : nombre.trim(),
      codigo,
      estado        : 'emitido',
      respuestas    : Object.keys(respuestas).length ? respuestas : null,
    })
    .select().single();
  if (e3) return res.status(500).json({ error: e3.message });
  const qr_token = signTicketQR({ ticket_id: ticket.id, evento_id: evento.id, codigo: ticket.codigo });
  await supabase.from('tickets').update({ qr_token }).eq('id', ticket.id);
  const externalRef = `tx_${ticket.id}`;
  const currency = evento.currency || tipo.currency || 'COP';
  let preference;
  try {
    preference = await mp.createPreference(owner.mp_access_token, {
      items: [{
        id          : tipo.id,
        title       : `${evento.titulo} — ${tipo.nombre}`,
        description : tipo.descripcion || undefined,
        quantity    : 1,
        currency_id : currency,
        unit_price  : precioEfectivo,
      }],
      payer: {
        name : nombre.trim(),
        email: email.toLowerCase().trim(),
        phone: telefono ? { number: telefono } : undefined,
      },
      externalReference: externalRef,
      notificationUrl  : `${apiBaseUrl()}/webhooks/mercadopago`,
      successUrl       : `${publicBaseUrl()}/mi-ticket/${ticket.codigo}`,
      failureUrl       : `${publicBaseUrl()}/explorar/${slug}?pago=fallo`,
      pendingUrl       : `${publicBaseUrl()}/mi-ticket/${ticket.codigo}?pago=pendiente`,
    });
  } catch (e) {
    return res.status(502).json({ error: `Mercado Pago rechazó la preferencia: ${e.message}` });
  }
  await supabase.from('payment_transactions').insert({
    evento_id     : evento.id,
    ticket_id     : ticket.id,
    ticket_type_id: tipo.id,
    preference_id : preference.id,
    status        : 'pending',
    monto         : precioEfectivo,
    currency,
    guest_email   : email.toLowerCase().trim(),
    guest_nombre  : nombre.trim(),
    guest_telefono: telefono || null,
    raw           : { preference_id: preference.id },
  });
  res.status(201).json({
    ticket: { id: ticket.id, codigo: ticket.codigo, estado: ticket.estado },
    checkout: {
      preference_id: preference.id,
      init_point: preference.init_point,
      sandbox_init_point: preference.sandbox_init_point,
    },
  });
});
/* ────────────── Webhook Mercado Pago ────────────── */
router.post('/webhooks/mercadopago', async (req, res) => {
  const sig = verifyMPSignature(req);
  if (!sig.ok) {
    console.warn('[webhook MP] firma inválida:', sig.reason);
    return res.status(401).json({ error: 'Invalid signature', reason: sig.reason });
  }
  res.status(200).json({ received: true });
  try {
    const paymentId = req.body?.data?.id || req.query?.['data.id'] || req.query?.id;
    const type      = req.body?.type      || req.query?.type;
    if (!paymentId || (type && type !== 'payment')) return;
    const { data: existing } = await supabase
      .from('payment_transactions')
      .select('id, ticket_id, evento_id, status')
      .eq('payment_id', String(paymentId))
      .maybeSingle();
    let accessToken = null;
    let knownTx = existing;
    if (knownTx) {
      const { data: ev } = await supabase
        .from('eventos').select('owner_id').eq('id', knownTx.evento_id).single();
      const { data: pr } = await supabase
        .from('profiles').select('mp_access_token').eq('id', ev.owner_id).single();
      accessToken = pr?.mp_access_token || null;
    }
    if (!accessToken) {
      const platformToken = process.env.MP_PLATFORM_ACCESS_TOKEN;
      if (platformToken) {
        try {
          const pago = await mp.getPayment(platformToken, paymentId);
          await procesarPago(pago);
          return;
        } catch { /* not it */ }
      }
      const { data: conectados } = await supabase
        .from('profiles').select('id, mp_access_token').not('mp_access_token', 'is', null);
      for (const p of conectados || []) {
        try {
          const pago = await mp.getPayment(p.mp_access_token, paymentId);
          accessToken = p.mp_access_token;
          await procesarPago(pago);
          return;
        } catch { /* try next */ }
      }
      return;
    }
    const pago = await mp.getPayment(accessToken, paymentId);
    await procesarPago(pago);
  } catch (e) {
    console.error('[webhook MP] error:', e.message);
  }
});
async function procesarPago(pago) {
  if (!pago?.id) return;
  const externalRef = pago.external_reference || '';
  if (externalRef.startsWith('plan_')) {
    return procesarPagoPlan(pago, externalRef.slice(5));
  }
  const ticketId = externalRef.startsWith('tx_') ? externalRef.slice(3) : null;
  if (!ticketId) return;
  const status = pago.status;
  const monto  = Number(pago.transaction_amount || 0);
  const { data: existing } = await supabase
    .from('payment_transactions')
    .select('id, ticket_id')
    .eq('payment_id', String(pago.id))
    .maybeSingle();
  if (existing) {
    await supabase.from('payment_transactions').update({
      status, raw: pago,
    }).eq('id', existing.id);
  } else {
    const { data: pending } = await supabase
      .from('payment_transactions')
      .select('id')
      .eq('ticket_id', ticketId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();
    if (pending) {
      await supabase.from('payment_transactions').update({
        payment_id: String(pago.id), status, raw: pago,
      }).eq('id', pending.id);
    } else {
      await supabase.from('payment_transactions').insert({
        evento_id : null,
        ticket_id : ticketId,
        payment_id: String(pago.id),
        status, monto, raw: pago,
      });
    }
  }
  if (status === 'approved') {
    const { data: ticket } = await supabase
      .from('tickets').select('id, evento_id, estado').eq('id', ticketId).single();
    if (!ticket) return;
    if (ticket.estado === 'pagado') return;
    await supabase.from('tickets').update({
      estado       : 'pagado',
      precio_pagado: monto,
      pagado_at    : new Date().toISOString(),
    }).eq('id', ticketId);
    const { data: evWh } = await supabase
      .from('eventos')
      .select('owner_id, titulo, slug, cover_url, fecha_inicio, location_nombre')
      .eq('id', ticket.evento_id).single();
    const { data: tFull } = await supabase
      .from('tickets')
      .select('codigo, guest_nombre, guest_email, ticket_type_id, qr_token')
      .eq('id', ticketId).single();
    let tipoNombre = null;
    if (tFull?.ticket_type_id) {
      const { data: tt } = await supabase
        .from('ticket_types').select('nombre').eq('id', tFull.ticket_type_id).maybeSingle();
      tipoNombre = tt?.nombre || null;
    }
    if (evWh?.owner_id) {
      dispatch(evWh.owner_id, 'ticket.pagado', {
        ticket_id: ticketId, evento_id: ticket.evento_id,
        codigo: tFull?.codigo, nombre: tFull?.guest_nombre, email: tFull?.guest_email,
        monto, via: 'mercadopago',
      });
    }
    if (tFull?.guest_email) {
      enviarEmailEvento({
        evento: ticket.evento_id,
        tipo: 'ticket',
        to: tFull.guest_email,
        ctx: {
          nombre     : tFull.guest_nombre,
          tipo_boleta: tipoNombre,
          codigo     : tFull.codigo,
          qr_token   : tFull.qr_token,
          enlace     : `${process.env.FRONTEND_URL?.split(',')[0] || 'https://gestor-eventos-frontend.vercel.app'}/mi-ticket/${tFull.codigo}`,
        },
      }).then(r => console.log('[pagos] email confirmación resultado:', r));
    }
    const { data: ev } = await supabase
      .from('eventos').select('aforo_vendido').eq('id', ticket.evento_id).single();
    if (ev) {
      await supabase.from('eventos')
        .update({ aforo_vendido: (ev.aforo_vendido || 0) + 1 })
        .eq('id', ticket.evento_id);
    }
    const { data: tt } = await supabase
      .from('tickets').select('ticket_type_id').eq('id', ticketId).single();
    if (tt?.ticket_type_id) {
      const { data: tipo } = await supabase
        .from('ticket_types').select('vendidos').eq('id', tt.ticket_type_id).single();
      if (tipo) {
        await supabase.from('ticket_types')
          .update({ vendidos: (tipo.vendidos || 0) + 1 })
          .eq('id', tt.ticket_type_id);
      }
    }
  } else if (status === 'refunded' || status === 'cancelled') {
    const { data: ticketRefund } = await supabase
      .from('tickets')
      .select('ticket_type_id, evento_id, estado')
      .eq('id', ticketId)
      .maybeSingle();
    await supabase.from('tickets').update({ estado: 'cancelado' }).eq('id', ticketId);
    if (ticketRefund?.estado === 'pagado') {
      const { data: ev } = await supabase
        .from('eventos').select('aforo_vendido, slug, titulo').eq('id', ticketRefund.evento_id).single();
      if (ev && ev.aforo_vendido > 0) {
        await supabase.from('eventos')
          .update({ aforo_vendido: ev.aforo_vendido - 1 })
          .eq('id', ticketRefund.evento_id);
      }
      const { data: tipoCt } = await supabase
        .from('ticket_types').select('vendidos').eq('id', ticketRefund.ticket_type_id).single();
      if (tipoCt && tipoCt.vendidos > 0) {
        await supabase.from('ticket_types')
          .update({ vendidos: tipoCt.vendidos - 1 })
          .eq('id', ticketRefund.ticket_type_id);
      }
      await notificarTopWaitlist(ticketRefund.ticket_type_id, ticketRefund.evento_id, ev?.slug, ev?.titulo);
    }
  }
}
async function notificarTopWaitlist(ticketTypeId, eventoId, eventoSlug, eventoTitulo) {
  const { data: top } = await supabase
    .from('event_waitlist')
    .select('*')
    .eq('ticket_type_id', ticketTypeId)
    .eq('evento_id', eventoId)
    .eq('estado', 'active')
    .order('posicion', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!top) return;
  await supabase.from('event_waitlist').update({
    estado               : 'contacted',
    notified_at          : new Date().toISOString(),
    last_contact_at      : new Date().toISOString(),
    notification_attempts: (top.notification_attempts || 0) + 1,
  }).eq('id', top.id);
  if (!top.user_id) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const pri = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !pri) return;
  const webpush = require('web-push');
  webpush.setVapidDetails(process.env.VAPID_CONTACT || 'mailto:hello@gestek.io', pub, pri);
  const { data: subs } = await supabase
    .from('push_subscriptions').select('*').eq('user_id', top.user_id);
  if (!subs || subs.length === 0) return;
  const payload = JSON.stringify({
    title: '¡Hay un cupo disponible!',
    body : `Se liberó un lugar en "${eventoTitulo || 'tu evento'}". Entrá rápido antes de que se llene.`,
    url  : eventoSlug ? `/explorar/${eventoSlug}` : '/',
  });
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }
}
async function procesarPagoPlan(pago, userId) {
  if (!userId) return;
  const status = pago.status;
  const monto  = Number(pago.transaction_amount || 0);
  const { data: existing } = await supabase
    .from('payment_transactions')
    .select('id').eq('payment_id', String(pago.id)).maybeSingle();
  if (existing) {
    await supabase.from('payment_transactions').update({ status, raw: pago }).eq('id', existing.id);
  } else {
    const { data: pending } = await supabase
      .from('payment_transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('kind', 'plan')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();
    if (pending) {
      await supabase.from('payment_transactions').update({
        payment_id: String(pago.id), status, raw: pago,
      }).eq('id', pending.id);
    } else {
      await supabase.from('payment_transactions').insert({
        user_id: userId, kind: 'plan', payment_id: String(pago.id),
        status, monto, currency: pago.currency_id || 'USD', raw: pago,
      });
    }
  }
  if (status === 'approved') {
    const { data: prof } = await supabase
      .from('profiles').select('plan, plan_expires_at').eq('id', userId).single();
    const base = prof?.plan === 'pro' && prof?.plan_expires_at && new Date(prof.plan_expires_at) > new Date()
      ? new Date(prof.plan_expires_at)
      : new Date();
    const nuevoVencimiento = new Date(base.getTime() + PLAN_PRO_DURATION_DAYS * 24 * 3600 * 1000);
    await supabase.from('profiles').update({
      plan            : 'pro',
      plan_expires_at : nuevoVencimiento.toISOString(),
      plan_payment_id : String(pago.id),
      plan_updated_at : new Date().toISOString(),
    }).eq('id', userId);
  } else if (status === 'refunded' || status === 'cancelled') {
    await supabase.from('profiles').update({
      plan: 'free', plan_expires_at: null, plan_updated_at: new Date().toISOString(),
    }).eq('id', userId);
  }
}
module.exports = router;
