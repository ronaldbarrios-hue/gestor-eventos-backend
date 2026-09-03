/* GESTEK — Pagos con Mercado Pago.
   - POST /eventos/publicos/slug/:slug/comprar   — crea Preference, devuelve init_point.
   - POST /webhooks/mercadopago                  — recibe la notificación, marca ticket pagado.
   - GET  /me/mercadopago/test                   — valida credenciales conectando con MP.
   - POST /me/mercadopago/conectar               — guarda credenciales (access_token, public_key).
   - DELETE /me/mercadopago                      — desconecta. */
const express = require('express');
const crypto  = require('crypto');
const supabase = require('../lib/supabase.js');
const { enlaceBoleta } = require('../lib/enlacePublico.js');
const { verifySupabaseJWT, verifySupabaseJWTOptional } = require('../middleware/auth.js');
const { signTicketQR } = require('../lib/qr.js');
const mp = require('../lib/mercadopago.js');
const { dispatch } = require('../lib/webhooks.js');
const { verifyTurnstile } = require('../lib/turnstile.js');
const { validarFormulario, normalizarRespuestas, COLUMNAS_CAMPO } = require('../lib/formularioCampos.js');
const { webhookLimiter } = require('../config/security.js');
const { enviarEmailEvento } = require('../lib/emailPlantillas.js');
const { avisarExpositorSiAplica } = require('../lib/avisoExpositor.js');
const { ofrecerCupoAlSiguiente, validarOferta, consumirOferta, hayCupoLibre } = require('../lib/waitlistOferta.js');
const { sesion, publica } = require('../core/permisos');
const { generarCodigo } = require('../lib/codigos.js');
const { baseFrontend } = require('../lib/frontend.js');
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || null;

/* Sin el secreto el webhook sigue aceptándose, y es a propósito: rechazarlo
   dejaría sin confirmar los pagos buenos, que es peor que el riesgo que evita.
   El pago nunca se cree lo que llega por el webhook —se vuelve a pedir a
   Mercado Pago— así que la firma no protege el dinero: protege el servidor.

   Lo que sí cambia sin secreto es que el camino caro queda cerrado (ver el
   webhook más abajo). Y se avisa al arrancar, porque el modo degradado
   silencioso es justo lo que hace que una variable lleve meses sin ponerse. */
if (!MP_WEBHOOK_SECRET) {
  console.warn(
    '[webhook MP] MP_WEBHOOK_SECRET no está configurada: las notificaciones se ' +
    'aceptan sin verificar firma y la recuperación de pagos huérfanos queda ' +
    'desactivada. Ponla en el panel de Mercado Pago → Webhooks y añádela al entorno.'
  );
}

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
function publicBaseUrl() {
  return baseFrontend();
}
function apiBaseUrl() {
  return process.env.API_PUBLIC_URL || process.env.BACKEND_URL || 'http://localhost:3000';
}
/* ────────────── Settings del organizador ────────────── */
router.get('/me/mercadopago/test', verifySupabaseJWT, sesion("La cuenta de cobro que el organizador conecta a su perfil."), async (req, res) => {
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
router.post('/me/mercadopago/conectar', verifySupabaseJWT, sesion("La cuenta de cobro que el organizador conecta a su perfil."), async (req, res) => {
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
router.delete('/me/mercadopago', verifySupabaseJWT, sesion("La cuenta de cobro que el organizador conecta a su perfil."), async (req, res) => {
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
/* ────────────── Plan Pro: retirado ──────────────
   GESTEK es de uso gratuito. Aquí vivían /me/plan, el trial, la
   activación de desarrollo y la compra del plan: ciento treinta y cinco
   líneas que ningún cliente llamaba —el frontend no tenía pantalla de
   plan— y que solo servían para mantener viva la idea de que había algo
   detrás de un muro.

   Lo único con límite es el asistente de IA, y ese límite no es del
   usuario: es la capa gratuita del proveedor. Se avisa en su pantalla.

   Las columnas plan y plan_expires_at siguen en profiles: quitarlas es
   una migración destructiva y no hace falta para esto. Nadie las lee. */

/* ────────────── Compra pública ────────────── */
router.post('/eventos/publicos/slug/:slug/comprar', verifySupabaseJWTOptional, publica('La compra se hace sin cuenta: es el punto de vender entradas a quien llega desde fuera. La identidad viaja en el formulario, no en una sesión.'), async (req, res) => {
  const { slug } = req.params;
  const { ticket_type_id, email, nombre, telefono } = req.body;
  if (!ticket_type_id) return res.status(400).json({ error: 'Selecciona un tipo de boleta.' });
  /* Si viene un correo tiene que ser uno de verdad; si no viene ninguno, que
     sea obligatorio o no se decide más abajo, cuando ya se sabe qué evento es. */
  if (email && !email.includes('@')) return res.status(400).json({ error: 'Ese correo no es válido.' });
  const capC = await verifyTurnstile(req.body.captcha_token, (req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '').trim());
  if (!capC.ok) return res.status(400).json({ error: 'Verificación anti-bot fallida. Recargá e intentá de nuevo.' });
  const { data: evento, error: e1 } = await supabase
    .from('eventos')
    .select('id, owner_id, titulo, estado, deleted_at, currency, aforo_total, aforo_vendido, page_json')
    .eq('slug', slug).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!evento || evento.deleted_at || evento.estado !== 'publicado')
    return res.status(404).json({ error: 'Evento no disponible.' });
  /* Nombre y correo son obligatorios por defecto: `undefined` cuenta como «sí
     exigido», así que ningún evento existente cambia de comportamiento a menos
     que el organizador apague el interruptor a propósito. */
  const checkoutCfg = evento.page_json?.checkout || {};
  if (checkoutCfg.requiere_email !== false && !email?.includes('@')) {
    return res.status(400).json({ error: 'Email válido requerido.' });
  }
  if (checkoutCfg.requiere_nombre !== false && !nombre?.trim()) {
    return res.status(400).json({ error: 'Tu nombre es requerido.' });
  }
  const MAX_POR_EMAIL = Number(process.env.MAX_TICKETS_POR_EMAIL || 5);
  if (email) {
    const { count: yaTiene } = await supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', evento.id)
      .eq('guest_email', email.toLowerCase().trim());
    if ((yaTiene || 0) >= MAX_POR_EMAIL) {
      return res.status(429).json({ error: `Alcanzaste el máximo de ${MAX_POR_EMAIL} boletas con este email para este evento.` });
    }
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

  /* Mismo candado que la reserva gratuita: las ofertas vivas de la lista de
     espera ocupan sitio para todos menos para su dueño. Si esto no estuviera
     aquí, el cupo guardado se lo llevaría el primero que pasara por el
     checkout de pago y el correo sería una carrera. */
  const ofertaPago = await validarOferta(req.body.waitlist_token);
  const ofertaMiaPago = ofertaPago
    && String(ofertaPago.evento_id) === String(evento.id)
    && String(ofertaPago.ticket_type_id) === String(tipo.id)
    ? ofertaPago : null;
  if (req.body.waitlist_token && !ofertaMiaPago) {
    return res.status(400).json({ error: 'Ese enlace de cupo ya no vale: o se usó, o se pasó el plazo y le tocó al siguiente.' });
  }
  if (!(await hayCupoLibre({ evento, tipo, exceptoId: ofertaMiaPago?.id }))) {
    const agotadoPorTipo = tipo.cupo != null && (tipo.vendidos || 0) >= tipo.cupo;
    return res.status(400).json({
      error: agotadoPorTipo ? 'Este tipo de boleta está agotado.' : 'El evento está al aforo máximo.',
      waitlistAvailable: true,
    });
  }
  const hasEarly = tipo.early_bird_precio != null && tipo.early_bird_hasta && new Date(tipo.early_bird_hasta) > new Date();
  const precioEfectivo = hasEarly ? Number(tipo.early_bird_precio) : Number(tipo.precio);
  if (precioEfectivo <= 0)
    return res.status(400).json({ error: 'Este tipo de boleta es gratis. Usá la reserva directa.' });
  /* Validar campos personalizados del formulario aplicables a este tipo de
     boleta (globales + específicos de `tipo`). `COLUMNAS_CAMPO` y
     `validarFormulario` — no una lista de columnas recortada con un loop a
     mano — porque sin `visible_si` un campo oculto por su condición se
     exigía igual: pedía una respuesta a algo que nunca se le mostró. */
  const { data: camposReq } = await supabase
    .from('event_form_fields').select(COLUMNAS_CAMPO).eq('evento_id', evento.id);
  const respuestas = req.body.respuestas && typeof req.body.respuestas === 'object' ? req.body.respuestas : {};
  const falloForm = validarFormulario(camposReq, respuestas, tipo.id);
  if (falloForm) return res.status(400).json({ error: falloForm });
  const respuestasLimpias = normalizarRespuestas(camposReq, respuestas);
  const codigo = generarCodigo();
  const { data: ticket, error: e3 } = await supabase
    .from('tickets')
    .insert({
      ticket_type_id: tipo.id,
      evento_id     : evento.id,
      guest_email   : email ? email.toLowerCase().trim() : null,
      guest_nombre  : nombre ? nombre.trim() : null,
      codigo,
      estado        : 'emitido',
      respuestas    : Object.keys(respuestasLimpias).length ? respuestasLimpias : null,
    })
    .select().single();
  if (e3) return res.status(500).json({ error: e3.message });
  const qr_token = signTicketQR({ ticket_id: ticket.id, evento_id: evento.id, codigo: ticket.codigo });
  await supabase.from('tickets').update({ qr_token }).eq('id', ticket.id);

  /* La boleta ya está emitida (falta pagarla): se cierra la fila y se quema el
     token. Si el pago se cae, la persona conserva la boleta en 'emitido' y
     puede reintentar desde /mi-ticket; devolverla a la cola sería peor. */
  if (ofertaMiaPago) await consumirOferta(ofertaMiaPago.id);

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
        name : nombre ? nombre.trim() : undefined,
        email: email ? email.toLowerCase().trim() : undefined,
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
    guest_email   : email ? email.toLowerCase().trim() : null,
    guest_nombre  : nombre ? nombre.trim() : null,
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
router.post('/webhooks/mercadopago', webhookLimiter, publica('Aviso de la pasarela, que llega desde sus servidores y no de un navegador. Se autentica con la firma del proveedor, no con sesión.'), async (req, res) => {
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
    /* Quién cobró, preguntándoselo al aviso en vez de adivinándolo.

       Mercado Pago manda `user_id` —el vendedor— en la notificación, y desde
       que el organizador conecta su cuenta guardamos su equivalente en
       `profiles.mp_user_id`. Con eso el dueño del pago sale de UNA consulta.

       Importa porque la fila de `payment_transactions` se crea con el
       `preference_id` y sin `payment_id`: el primer aviso de cada pago no la
       encuentra y, sin este atajo, caía siempre en el barrido de más abajo.
       Así el barrido pasa a ser lo que debía ser, el último recurso. */
    if (!accessToken) {
      const vendedor = req.body?.user_id || req.query?.user_id;
      if (vendedor) {
        const { data: dueno } = await supabase
          .from('profiles').select('mp_access_token')
          .eq('mp_user_id', String(vendedor))
          .not('mp_access_token', 'is', null)
          .maybeSingle();
        if (dueno?.mp_access_token) accessToken = dueno.mp_access_token;
      }
    }

    if (!accessToken) {
      const platformToken = process.env.MP_PLATFORM_ACCESS_TOKEN;
      if (platformToken) {
        try {
          const pago = await mp.getPayment(platformToken, paymentId);
          await procesarPago(pago);
          return;
        } catch { /* no es de la cuenta de la plataforma */ }
      }

      /* Probar el pago contra el token de CADA organizador conectado es el
         camino normal, no la excepción: `payment_transactions` se crea con el
         `preference_id` y sin `payment_id`, así que el primer aviso de cada
         pago no encuentra fila y cae aquí.

         El problema es que era un amplificador abierto a internet: sin firma,
         cualquiera mandando ids inventados en bucle provocaba una llamada
         saliente a Mercado Pago por cada organizador conectado, y el webhook
         responde 200 antes de procesar, así que ni el limitador lo frenaba.
         Con veinte organizadores, una petición barata para el atacante costaba
         veinte peticiones lentas al servidor.

         Ahora ese recorrido exige firma verificada. Con `MP_WEBHOOK_SECRET`
         puesta el comportamiento es idéntico al de antes; sin ella se pierde
         la recuperación de pagos huérfanos, que es lo que se puede perder sin
         que nadie se quede sin su boleta —el pago vuelve a intentarse y el
         organizador puede marcarlo a mano—, y a cambio no hay palanca. */
      if (!MP_WEBHOOK_SECRET) {
        console.warn('[webhook MP] pago', paymentId, 'sin transacción conocida; se ignora porque no hay firma que verificar.');
        return;
      }

      const { data: conectados } = await supabase
        .from('profiles').select('id, mp_access_token').not('mp_access_token', 'is', null);
      for (const p of conectados || []) {
        try {
          const pago = await mp.getPayment(p.mp_access_token, paymentId);
          accessToken = p.mp_access_token;
          await procesarPago(pago);
          return;
        } catch { /* no es de este organizador */ }
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
          enlace     : await enlaceBoleta(ticket.evento_id, tFull.codigo),
        },
      }).then(r => console.log('[pagos] email confirmación resultado:', r));
      avisarExpositorSiAplica(ticketId).catch(() => {});
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
      await notificarTopWaitlist(ticketRefund.ticket_type_id, ticketRefund.evento_id);
    }
  }
}
/* El reembolso libera un cupo: se le ofrece al primero de la lista de espera.

   Esto era una copia local que marcaba 'contacted' y mandaba un push, sin
   correo, sin enlace y sin manera de pasar al siguiente. Ahora llama al ciclo
   real de `lib/waitlistOferta.js`, que manda el correo `cupo_liberado` con un
   enlace que caduca y guarda el cupo mientras la oferta esté viva. */
async function notificarTopWaitlist(ticketTypeId, eventoId) {
  await ofrecerCupoAlSiguiente({ eventoId, ticketTypeId });
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
  /* Antes esto activaba el plan Pro al aprobarse el pago y lo quitaba al
     reembolsarse. Ya no hay plan: GESTEK es de uso gratuito. La transacción se
     sigue registrando arriba —es dinero que se movió y tiene que quedar
     anotado—, pero no concede nada.

     Si algún día vuelve un cobro de plataforma, aquí es donde va. */
}

module.exports = router;
