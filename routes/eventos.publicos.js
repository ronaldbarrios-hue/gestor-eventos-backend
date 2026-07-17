const express = require('express');
const crypto = require('crypto');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWTOptional } = require('../middleware/auth.js');
const { signTicketQR } = require('../lib/qr.js');
const { notificar } = require('../lib/notificar.js');
const { verifyTurnstile } = require('../lib/turnstile.js');
const { sendMail, plantillaTicket } = require('../lib/email.js');

function clientIp(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '').trim();
}

function visitorHash(req) {
  const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '').trim();
  const ua = req.headers['user-agent'] || '';
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash('sha256').update(`${ip}::${ua}::${day}`).digest('hex').slice(0, 24);
}

function classifySource(referrer) {
  if (!referrer) return 'direct';
  const r = referrer.toLowerCase();
  if (/google|bing|duckduckgo|yandex/.test(r)) return 'search';
  if (/instagram|facebook|x\.com|twitter|tiktok|linkedin|whatsapp|telegram|youtube/.test(r)) return 'social';
  if (/mail|gmail|outlook/.test(r)) return 'email';
  return 'otro';
}

const router = express.Router();
router.use(verifySupabaseJWTOptional);

/* GET /eventos/publicos — listado de eventos publicados vigentes (para /explorar) */
router.get('/', async (req, res) => {
  const { q, categoria, ciudad, page = 1, limit = 24 } = req.query;
  const desde = (Number(page) - 1) * Number(limit);
  const hasta = desde + Number(limit) - 1;
  const ahora = new Date().toISOString();

  let query = supabase
    .from('eventos')
    .select(
      `id, slug, titulo, descripcion, cover_url, gallery, modalidad,
       fecha_inicio, fecha_fin, location_nombre, location_direccion,
       currency,
       categoria:categorias(slug, nombre),
       organizador:profiles!owner_id(nombre, handle, avatar_url, empresa, branding, empresa_logo_url)`,
      { count: 'exact' }
    )
    .eq('estado', 'publicado')
    .is('deleted_at', null)
    .or(`fecha_fin.gte.${ahora},and(fecha_fin.is.null,fecha_inicio.gte.${ahora})`)
    .order('fecha_inicio', { ascending: true })
    .range(desde, hasta);

  if (q)         query = query.ilike('titulo', `%${q}%`);
  if (ciudad)    query = query.ilike('location_nombre', `%${ciudad}%`);
  if (categoria) {
    const { data: cat } = await supabase.from('categorias').select('id').eq('slug', categoria).maybeSingle();
    if (cat) query = query.eq('categoria_id', cat.id);
  }

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ eventos: data, total: count ?? 0 });
});

function generarCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/* GET /eventos/publicos/ticket/:codigo
   Incluye `respuestas` (del formulario personalizado, si ya se llenaron) y
   `evento.campos_formulario` (para saber qué preguntas hacen falta). */
router.get('/ticket/:codigo', async (req, res) => {
  const codigo = req.params.codigo.toUpperCase().trim();
  if (!codigo || codigo.length < 4) return res.status(400).json({ error: 'Código inválido.' });

  const { data, error } = await supabase
    .from('tickets')
    .select(`
      id, codigo, qr_token, estado, precio_pagado, created_at, checked_in_at, respuestas,
      guest_nombre, guest_email,
      tipo:ticket_types!ticket_type_id(nombre, descripcion, currency),
      evento:eventos!evento_id(id, slug, titulo, fecha_inicio, location_nombre, cover_url)
    `)
    .eq('codigo', codigo)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Boleta no encontrada.' });

  if (data.evento?.id) {
    const { data: campos } = await supabase
      .from('event_form_fields')
      .select('id, tipo, etiqueta, opciones, requerido, orden')
      .eq('evento_id', data.evento.id)
      .order('orden', { ascending: true });
    data.evento.campos_formulario = campos || [];
  }

  res.json({ ticket: data });
});

/* POST /eventos/publicos/ticket/:codigo/formulario — completa las respuestas
   del formulario personalizado de UNA boleta ya existente. */
router.post('/ticket/:codigo/formulario', async (req, res) => {
  const codigo = req.params.codigo.toUpperCase().trim();
  const respuestas = req.body?.respuestas && typeof req.body.respuestas === 'object' ? req.body.respuestas : {};

  const { data: ticket, error: e1 } = await supabase
    .from('tickets')
    .select('id, evento_id, respuestas')
    .eq('codigo', codigo)
    .maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!ticket) return res.status(404).json({ error: 'Boleta no encontrada.' });
  if (ticket.respuestas) return res.status(400).json({ error: 'Esta boleta ya tiene el formulario completado.' });

  const { data: campos } = await supabase
    .from('event_form_fields')
    .select('id, etiqueta, requerido')
    .eq('evento_id', ticket.evento_id);

  for (const c of campos || []) {
    if (c.requerido) {
      const v = respuestas[c.id];
      if (v === undefined || v === null || v === '' || v === false) {
        return res.status(400).json({ error: `El campo "${c.etiqueta}" es obligatorio.` });
      }
    }
  }

  const { error: e2 } = await supabase
    .from('tickets')
    .update({ respuestas: Object.keys(respuestas).length ? respuestas : {} })
    .eq('id', ticket.id);
  if (e2) return res.status(500).json({ error: e2.message });

  res.json({ ok: true });
});

/* GET /eventos/publicos/slug/:slug */
router.get('/slug/:slug', async (req, res) => {
  const { slug } = req.params;

  const { data: evento, error } = await supabase
    .from('eventos')
    .select(`
      id, slug, titulo, descripcion, cover_url, gallery, modalidad,
      fecha_inicio, fecha_fin, timezone, location_nombre, location_direccion,
      lat, lng, url_virtual, links, currency, edad_minima,
      aforo_total, aforo_vendido, page_json, estado,
      pago_llave, pago_qr_url, pago_instrucciones,
      categoria:categorias(slug, nombre),
      organizador:profiles!owner_id(nombre, handle, avatar_url, empresa, branding, empresa_logo_url, plan, plan_expires_at),
      ticket_types(id, nombre, descripcion, precio, currency, cupo, vendidos,
                   early_bird_precio, early_bird_hasta, venta_hasta, zonas_acceso, orden, activo)
    `)
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!evento || evento.estado !== 'publicado') {
    return res.status(404).json({ error: 'Este evento no existe o no está publicado.' });
  }

  evento.ticket_types = (evento.ticket_types || [])
    .filter(t => t.activo)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));

  const { data: camposForm } = await supabase
    .from('event_form_fields')
    .select('id, tipo, etiqueta, opciones, requerido, orden')
    .eq('evento_id', evento.id)
    .order('orden', { ascending: true });
  evento.campos_formulario = camposForm || [];

  /* Bandera para saber si el evento tiene módulo de Rueda de Negocios
     activo (al menos un expositor cargado), y así mostrar el botón en
     la página pública solo cuando aplica. */
  const { count: expCount } = await supabase
    .from('networking_expositores')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', evento.id);
  evento.tiene_networking = (expCount || 0) > 0;

  if (evento.organizador) {
    const o = evento.organizador;
    o.plan = (o.plan === 'pro' && (!o.plan_expires_at || new Date(o.plan_expires_at) > new Date()))
      ? 'pro' : 'free';
    delete o.plan_expires_at;
  }

  supabase.from('event_views').insert({
    evento_id    : evento.id,
    visitor_hash : visitorHash(req),
    source       : classifySource(req.headers['referer'] || req.headers['referrer']),
    referrer     : req.headers['referer'] || null,
  }).then(() => {}, () => {});

  res.json({ evento });
});

/* GET /eventos/publicos/invitacion-pendiente?email=... */
router.get('/invitacion-pendiente', async (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email inválido.' });

  const { data, error } = await supabase
    .from('event_members')
    .select(`
      id, rol, evento_id,
      evento:eventos!evento_id(id, titulo)
    `)
    .eq('email', email)
    .eq('status', 'invited')
    .order('invited_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.json({ invitado: false });

  res.json({
    invitado: true,
    rol: data.rol,
    eventoId: data.evento_id,
    eventoTitulo: data.evento?.titulo || null,
  });
});

/* POST /eventos/publicos/slug/:slug/reservar */
router.post('/slug/:slug/reservar', async (req, res) => {
  const { slug } = req.params;
  const { ticket_type_id, email, nombre, telefono } = req.body;

  if (!ticket_type_id) return res.status(400).json({ error: 'Selecciona un tipo de boleta.' });
  if (!email?.includes('@')) return res.status(400).json({ error: 'Email válido requerido.' });
  if (!nombre?.trim())  return res.status(400).json({ error: 'Tu nombre es requerido.' });

  const cap = await verifyTurnstile(req.body.captcha_token, clientIp(req));
  if (!cap.ok) return res.status(400).json({ error: 'Verificación anti-bot fallida. Recargá e intentá de nuevo.' });

  const { data: evento, error: e1 } = await supabase
    .from('eventos')
    .select('id, owner_id, titulo, cover_url, fecha_inicio, location_nombre, estado, deleted_at, aforo_total, aforo_vendido, pago_llave, pago_qr_url, pago_instrucciones')
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

  const { data: tipo, error: e2 } = await supabase
    .from('ticket_types')
    .select('*')
    .eq('id', ticket_type_id)
    .eq('evento_id', evento.id)
    .maybeSingle();
  if (e2) return res.status(500).json({ error: e2.message });
  if (!tipo) return res.status(404).json({ error: 'Tipo de boleta no encontrado.' });
  if (!tipo.activo) return res.status(400).json({ error: 'Este tipo de boleta no está disponible.' });

  if (tipo.venta_hasta && new Date(tipo.venta_hasta) < new Date()) {
    return res.status(400).json({ error: 'La venta de este tipo de boleta ya cerró.' });
  }
  if (tipo.cupo != null && tipo.vendidos >= tipo.cupo) {
    return res.status(400).json({ error: 'Este tipo de boleta está agotado.', waitlistAvailable: true });
  }
  if (evento.aforo_total && evento.aforo_vendido >= evento.aforo_total) {
    return res.status(400).json({ error: 'El evento está al aforo máximo.', waitlistAvailable: true });
  }

  const hasEarly = tipo.early_bird_precio != null && tipo.early_bird_hasta && new Date(tipo.early_bird_hasta) > new Date();
  const precioEfectivo = hasEarly ? Number(tipo.early_bird_precio) : Number(tipo.precio);
  const esGratis = precioEfectivo === 0;
  const tienePagoSimple = Boolean(evento.pago_llave || evento.pago_qr_url);

  if (!esGratis && !tienePagoSimple) {
    return res.status(400).json({ error: 'Este ticket requiere pago. Usá el flujo de checkout MP.' });
  }

  const { data: camposReq } = await supabase
    .from('event_form_fields').select('id, etiqueta, requerido').eq('evento_id', evento.id);
  const respuestas = req.body.respuestas && typeof req.body.respuestas === 'object' ? req.body.respuestas : {};
  for (const c of camposReq || []) {
    if (c.requerido) {
      const v = respuestas[c.id];
      if (v === undefined || v === null || v === '') {
        return res.status(400).json({ error: `El campo "${c.etiqueta}" es obligatorio.` });
      }
    }
  }

  const codigo = generarCodigo();
  const estado = esGratis ? 'pagado' : 'emitido';

  const { data: ticket, error: e3 } = await supabase
    .from('tickets')
    .insert({
      ticket_type_id: tipo.id,
      evento_id     : evento.id,
      guest_email   : email.toLowerCase().trim(),
      guest_nombre  : nombre.trim(),
      codigo,
      estado,
      precio_pagado : esGratis ? 0 : null,
      pagado_at     : esGratis ? new Date().toISOString() : null,
      respuestas    : Object.keys(respuestas).length ? respuestas : null,
    })
    .select()
    .single();

  if (e3) return res.status(500).json({ error: e3.message });

  const qr_token = signTicketQR({ ticket_id: ticket.id, evento_id: evento.id, codigo: ticket.codigo });
  await supabase.from('tickets').update({ qr_token }).eq('id', ticket.id);
  ticket.qr_token = qr_token;

  await supabase.from('ticket_types').update({ vendidos: (tipo.vendidos || 0) + 1 }).eq('id', tipo.id);
  if (esGratis) {
    await supabase.from('eventos').update({ aforo_vendido: (evento.aforo_vendido || 0) + 1 }).eq('id', evento.id);

    sendMail({
      to: ticket.guest_email,
      subject: `Tu entrada para "${evento.titulo}" está confirmada`,
      html: plantillaTicket({
        eventoTitulo: evento.titulo,
        eventoCoverUrl: evento.cover_url,
        eventoFecha: evento.fecha_inicio,
        eventoLugar: evento.location_nombre,
        nombre: ticket.guest_nombre,
        codigo: ticket.codigo,
        qrToken: ticket.qr_token,
        tipoNombre: tipo.nombre,
        linkTicket: `${process.env.FRONTEND_URL?.split(',')[0] || 'https://gestor-eventos-frontend.vercel.app'}/mi-ticket/${ticket.codigo}`,
        gratis: true,
      }),
    }).then(r => console.log('[reservar] email confirmación resultado:', r));
  }

  notificar({
    userId  : evento.owner_id,
    tipo    : 'reserva',
    titulo  : esGratis ? 'Nueva reserva' : 'Nueva boleta emitida',
    cuerpo  : `${nombre.trim()} reservó "${tipo.nombre}" en ${evento.titulo}.`,
    link    : `/eventos/${evento.id}`,
    eventoId: evento.id,
  });

  res.status(201).json({
    ticket: { id: ticket.id, codigo: ticket.codigo, estado: ticket.estado },
    requierePago: !esGratis,
  });
});

/* POST /eventos/publicos/slug/:slug/waitlist */
router.post('/slug/:slug/waitlist', async (req, res) => {
  const { slug } = req.params;
  const { ticket_type_id, email, nombre } = req.body;

  if (!ticket_type_id)       return res.status(400).json({ error: 'Selecciona un tipo de boleta.' });
  if (!email?.includes('@')) return res.status(400).json({ error: 'Email válido requerido.' });
  if (!nombre?.trim())       return res.status(400).json({ error: 'Tu nombre es requerido.' });

  const capWl = await verifyTurnstile(req.body.captcha_token, clientIp(req));
  if (!capWl.ok) return res.status(400).json({ error: 'Verificación anti-bot fallida. Recargá e intentá de nuevo.' });

  const { data: evento, error: e1 } = await supabase
    .from('eventos')
    .select('id, estado, deleted_at')
    .eq('slug', slug).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!evento || evento.deleted_at || evento.estado !== 'publicado')
    return res.status(404).json({ error: 'Evento no disponible.' });

  const { data: tipo, error: e2 } = await supabase
    .from('ticket_types')
    .select('id, nombre, activo')
    .eq('id', ticket_type_id)
    .eq('evento_id', evento.id)
    .maybeSingle();
  if (e2) return res.status(500).json({ error: e2.message });
  if (!tipo)        return res.status(404).json({ error: 'Tipo de boleta no encontrado.' });
  if (!tipo.activo) return res.status(400).json({ error: 'Este tipo de boleta no está disponible.' });

  const { data: maxRow } = await supabase
    .from('event_waitlist')
    .select('posicion')
    .eq('evento_id', evento.id)
    .eq('ticket_type_id', tipo.id)
    .order('posicion', { ascending: false })
    .limit(1)
    .maybeSingle();
  const posicion = (maxRow?.posicion || 0) + 1;

  const { data: entry, error: e3 } = await supabase
    .from('event_waitlist')
    .insert({
      evento_id     : evento.id,
      ticket_type_id: tipo.id,
      user_id       : req.user?.id || null,
      guest_email   : email.toLowerCase().trim(),
      guest_nombre  : nombre.trim(),
      posicion,
    })
    .select('id, posicion, estado, added_at')
    .single();

  if (e3) {
    if (e3.code === '23505') {
      return res.status(409).json({ error: 'Ya estás en la lista de espera para este tipo de boleta.' });
    }
    return res.status(500).json({ error: e3.message });
  }

  res.status(201).json({ entry });
});

module.exports = router;
