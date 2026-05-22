const express = require('express');
const crypto = require('crypto');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWTOptional } = require('../middleware/auth.js');
const { signTicketQR } = require('../lib/qr.js');
const { notificar } = require('../lib/notificar.js');
const { verifyTurnstile } = require('../lib/turnstile.js');

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

/* GET /eventos/publicos — listado de eventos publicados (para /explorar) */
router.get('/', async (req, res) => {
  const { q, categoria, ciudad, page = 1, limit = 24 } = req.query;
  const desde = (Number(page) - 1) * Number(limit);
  const hasta = desde + Number(limit) - 1;

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

/* Helper: genera un código alfanumérico corto para boletas (8 chars).
   Lo usamos como respaldo del QR cuando el escáner no funciona. */
function generarCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin O,I,0,1 para evitar confusión
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/* GET /eventos/publicos/ticket/:codigo — recuperar la boleta de un cliente por código.
   Útil para que el comprador pueda volver a ver su QR sin tener que guardar el JWT. */
router.get('/ticket/:codigo', async (req, res) => {
  const codigo = req.params.codigo.toUpperCase().trim();
  if (!codigo || codigo.length < 4) return res.status(400).json({ error: 'Código inválido.' });

  const { data, error } = await supabase
    .from('tickets')
    .select(`
      id, codigo, qr_token, estado, precio_pagado, created_at, checked_in_at,
      guest_nombre, guest_email,
      tipo:ticket_types!ticket_type_id(nombre, descripcion, currency),
      evento:eventos!evento_id(id, slug, titulo, fecha_inicio, location_nombre, cover_url)
    `)
    .eq('codigo', codigo)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Boleta no encontrada.' });
  res.json({ ticket: data });
});

/* GET /eventos/publicos/slug/:slug — un evento publicado por slug
   (lo consume la página pública / preview). */
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

  /* Solo tipos de boleta activos, ordenados */
  evento.ticket_types = (evento.ticket_types || [])
    .filter(t => t.activo)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));

  /* Plan efectivo del organizador (para white-label / "Powered by") */
  if (evento.organizador) {
    const o = evento.organizador;
    o.plan = (o.plan === 'pro' && (!o.plan_expires_at || new Date(o.plan_expires_at) > new Date()))
      ? 'pro' : 'free';
    delete o.plan_expires_at;
  }

  /* Registro de visita (best-effort, para Analytics) */
  supabase.from('event_views').insert({
    evento_id    : evento.id,
    visitor_hash : visitorHash(req),
    source       : classifySource(req.headers['referer'] || req.headers['referrer']),
    referrer     : req.headers['referer'] || null,
  }).then(() => {}, () => {});

  res.json({ evento });
});

/* POST /eventos/publicos/slug/:slug/reservar — reservar una boleta gratis.
   Pagos reales (BRE-B) se manejan en otro endpoint con webhook. */
router.post('/slug/:slug/reservar', async (req, res) => {
  const { slug } = req.params;
  const { ticket_type_id, email, nombre, telefono } = req.body;

  if (!ticket_type_id) return res.status(400).json({ error: 'Selecciona un tipo de boleta.' });
  if (!email?.includes('@')) return res.status(400).json({ error: 'Email válido requerido.' });
  if (!nombre?.trim())  return res.status(400).json({ error: 'Tu nombre es requerido.' });

  const cap = await verifyTurnstile(req.body.captcha_token, clientIp(req));
  if (!cap.ok) return res.status(400).json({ error: 'Verificación anti-bot fallida. Recargá e intentá de nuevo.' });

  /* Trae el evento + el tipo de ticket que quieren reservar */
  const { data: evento, error: e1 } = await supabase
    .from('eventos')
    .select('id, owner_id, titulo, estado, deleted_at, aforo_total, aforo_vendido, pago_llave, pago_qr_url, pago_instrucciones')
    .eq('slug', slug).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!evento || evento.deleted_at || evento.estado !== 'publicado')
    return res.status(404).json({ error: 'Evento no disponible.' });

  /* Anti-abuso: límite de boletas por email en un mismo evento */
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

  /* Reglas de venta */
  if (tipo.venta_hasta && new Date(tipo.venta_hasta) < new Date()) {
    return res.status(400).json({ error: 'La venta de este tipo de boleta ya cerró.' });
  }
  if (tipo.cupo != null && tipo.vendidos >= tipo.cupo) {
    return res.status(400).json({ error: 'Este tipo de boleta está agotado.', waitlistAvailable: true });
  }
  if (evento.aforo_total && evento.aforo_vendido >= evento.aforo_total) {
    return res.status(400).json({ error: 'El evento está al aforo máximo.', waitlistAvailable: true });
  }

  /* Precio efectivo: Early Bird si aplica, si no normal */
  const hasEarly = tipo.early_bird_precio != null && tipo.early_bird_hasta && new Date(tipo.early_bird_hasta) > new Date();
  const precioEfectivo = hasEarly ? Number(tipo.early_bird_precio) : Number(tipo.precio);
  const esGratis = precioEfectivo === 0;
  const tienePagoSimple = Boolean(evento.pago_llave || evento.pago_qr_url);

  /* - Gratis → 'pagado' directo.
     - Con pago simple (llave/QR) → 'emitido' (pago manual sin verificación).
     - Con MP full integrado → rechazamos acá, se usa POST /eventos/publicos/slug/:slug/comprar. */
  if (!esGratis && !tienePagoSimple) {
    return res.status(400).json({ error: 'Este ticket requiere pago. Usá el flujo de checkout MP.' });
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
    })
    .select()
    .single();

  if (e3) return res.status(500).json({ error: e3.message });

  /* Firmamos el QR con ticket_id real + lo guardamos en la fila */
  const qr_token = signTicketQR({ ticket_id: ticket.id, evento_id: evento.id, codigo: ticket.codigo });
  await supabase.from('tickets').update({ qr_token }).eq('id', ticket.id);
  ticket.qr_token = qr_token;

  /* Incrementa contadores (best effort, no rompemos si falla) */
  await supabase.from('ticket_types').update({ vendidos: (tipo.vendidos || 0) + 1 }).eq('id', tipo.id);
  if (esGratis) {
    await supabase.from('eventos').update({ aforo_vendido: (evento.aforo_vendido || 0) + 1 }).eq('id', evento.id);
  }

  /* Notifica al organizador (best-effort) */
  notificar({
    userId : evento.owner_id,
    tipo   : 'reserva',
    titulo : esGratis ? 'Nueva reserva' : 'Nueva boleta emitida',
    cuerpo : `${nombre.trim()} reservó "${tipo.nombre}" en ${evento.titulo}.`,
    link   : `/eventos/${evento.id}`,
    eventoId: evento.id,
  });

  res.status(201).json({
    ticket: { id: ticket.id, codigo: ticket.codigo, estado: ticket.estado },
    requierePago: !esGratis,
  });
});


/* POST /eventos/publicos/slug/:slug/waitlist — unirse a la lista de espera.
   No requiere auth. Si el usuario está logueado (verifySupabaseJWTOptional) se vincula su user_id. */
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

  /* posicion = max(posicion) + 1 para este evento+tipo */
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
