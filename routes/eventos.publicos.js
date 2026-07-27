const express = require('express');
const crypto = require('crypto');
const supabase = require('../lib/supabase.js');
const { saldoDeTicket, recompensasDisponibles } = require('../lib/saldoTicket.js');
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
      tipo:ticket_types!ticket_type_id(nombre, descripcion, currency, es_expositor),
      evento:eventos!evento_id(id, slug, titulo, fecha_inicio, location_nombre, cover_url)
    `)
    .eq('codigo', codigo)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Boleta no encontrada.' });

  if (data.evento?.id) {
    const { data: campos } = await supabase
      .from('event_form_fields')
      .select('id, tipo, etiqueta, opciones, requerido, orden, ticket_type_id')
      .eq('evento_id', data.evento.id)
      .order('orden', { ascending: true });
    data.evento.campos_formulario = campos || [];
  }

  /* Puntos, historial y qué puede reclamar: es lo que vuelve híbrida la
     escarapela — el asistente ve en su móvil lo que le fueron marcando y a
     qué le alcanza. El saldo respeta el alcance que fijó el organizador. */
  const { data: inter } = await supabase
    .from('ticket_interacciones')
    .select('id, tipo, puntos, motivo_texto, nota, lugar, created_at')
    .eq('ticket_id', data.id)
    .order('created_at', { ascending: false })
    .limit(50);
  data.interacciones = inter || [];

  if (data.evento?.id) {
    const { data: ev } = await supabase
      .from('eventos').select('owner_id').eq('id', data.evento.id).maybeSingle();
    if (ev?.owner_id) {
      const saldo = await saldoDeTicket(data, { organizadorId: ev.owner_id, eventoId: data.evento.id });
      data.puntos = saldo.saldo;
      data.puntos_detalle = saldo;
      const recs = await recompensasDisponibles(ev.owner_id, data.evento.id);
      data.recompensas = recs.map(r => ({ ...r, alcanzable: !r.agotada && saldo.saldo >= r.costo_puntos }));
      const { data: mis } = await supabase
        .from('canjes').select('id, titulo, costo_puntos, codigo, estado, created_at')
        .eq('ticket_id', data.id).order('created_at', { ascending: false });
      data.canjes = mis || [];
    }
  }
  if (data.puntos == null) data.puntos = (inter || []).reduce((s, r) => s + (r.puntos || 0), 0);

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

/* ─────────── Ficha del expositor (boleta-Stand) ───────────
   La empresa edita su propia ficha con el código de su boleta-Stand, igual
   que el asistente completa su formulario. Editar la ficha propia no emite
   valor (a diferencia de dar puntos), así que el código basta como credencial. */

/* Resuelve la ficha por el código de una boleta cuyo tipo es_expositor. */
async function resolverFichaExpositor(codigo) {
  const cod = String(codigo || '').toUpperCase().trim();
  if (cod.length < 4) return { error: 'Código inválido.' };
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, evento_id, estado, guest_nombre, guest_email, ticket_type_id, tipo:ticket_types!ticket_type_id(nombre, es_expositor)')
    .eq('codigo', cod).maybeSingle();
  if (!ticket) return { error: 'Boleta no encontrada.' };
  if (!ticket.tipo?.es_expositor) return { error: 'Esta boleta no es de expositor.' };
  const { data: ficha } = await supabase
    .from('networking_expositores').select('*').eq('ticket_id', ticket.id).maybeSingle();
  return { ticket, ficha };
}

/* GET /eventos/publicos/expositor/:codigo — la empresa carga su ficha. */
router.get('/expositor/:codigo', async (req, res) => {
  const { error, ticket, ficha } = await resolverFichaExpositor(req.params.codigo);
  if (error) return res.status(error === 'Código inválido.' ? 400 : 404).json({ error });

  const { data: evento } = await supabase
    .from('eventos').select('id, slug, titulo, cover_url, fecha_inicio, fecha_fin, timezone')
    .eq('id', ticket.evento_id).maybeSingle();

  res.json({
    ficha: ficha || null,
    pagada: ticket.estado === 'pagado' || ticket.estado === 'usado',
    ticket: { codigo: req.params.codigo.toUpperCase().trim(), nombre: ticket.guest_nombre, email: ticket.guest_email },
    evento,
  });
});

/* PUT /eventos/publicos/expositor/:codigo — la empresa edita SU ficha.
   Nunca puede tocar evento_id, ticket_id ni activo. */
const CAMPOS_FICHA = ['nombre', 'descripcion', 'logo_url', 'stand', 'tipo_persona',
  'contacto_nombre', 'contacto_email', 'contacto_telefono', 'sitio_web', 'redes', 'categoria_negocio'];

router.put('/expositor/:codigo', async (req, res) => {
  const { error, ticket, ficha } = await resolverFichaExpositor(req.params.codigo);
  if (error) return res.status(error === 'Código inválido.' ? 400 : 404).json({ error });
  if (!ficha) return res.status(409).json({ error: 'La ficha aún no está lista. Si acabas de pagar, espera unos segundos.' });

  const updates = {};
  for (const k of CAMPOS_FICHA) if (k in req.body) updates[k] = req.body[k];
  if ('tipo_persona' in updates && !['natural', 'empresa'].includes(updates.tipo_persona)) {
    return res.status(400).json({ error: 'Tipo inválido.' });
  }
  if ('nombre' in updates && !String(updates.nombre).trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio.' });
  }
  if (req.body.marcar_completa) updates.estado_ficha = 'completa';
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios.' });

  const { data, error: eUpd } = await supabase
    .from('networking_expositores').update(updates).eq('id', ficha.id).select('*').single();
  if (eUpd) return res.status(500).json({ error: eUpd.message });
  res.json({ ficha: data });
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
    .select('id, tipo, etiqueta, opciones, requerido, orden, ticket_type_id')
    .eq('evento_id', evento.id)
    .order('orden', { ascending: true });
  evento.campos_formulario = camposForm || [];

  /* Banderas para mostrar botones opcionales en la página pública, solo
     cuando el módulo correspondiente está realmente configurado. */
  const { count: expCount } = await supabase
    .from('networking_expositores')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', evento.id);
  evento.tiene_networking = (expCount || 0) > 0;

  /* Puede haber VARIOS torneos por evento — contar, no maybeSingle (que
     lanzaría error con más de una fila). */
  const { count: torneoCount } = await supabase
    .from('torneos').select('id', { count: 'exact', head: true }).eq('evento_id', evento.id);
  evento.tiene_torneo = (torneoCount || 0) > 0;

  /* "Espacio del evento": el calendario de sub-eventos aplica a CUALQUIER
     evento (una convención de anime tiene stands, torneos y shows aunque no
     sea de categoría "educación"). Antes se limitaba a 4 categorías; ahora
     basta con que haya sub-eventos cargados. */
  const { count: sessionsCount } = await supabase
    .from('agenda_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', evento.id);
  evento.tiene_espacio = (sessionsCount || 0) > 0;
  evento.tiene_agenda  = evento.tiene_espacio; // alias retrocompatible

  /* Catálogo de recompensas para el bloque "Premios" de la landing (sin saldo:
     eso es por boleta y va en /mi-ticket). */
  try {
    const { data: owner } = await supabase
      .from('eventos').select('owner_id').eq('id', evento.id).maybeSingle();
    if (owner?.owner_id) {
      evento.recompensas = await recompensasDisponibles(owner.owner_id, evento.id);
    }
  } catch { evento.recompensas = []; }

  /* Expositores para el bloque "Directorio de expositores": solo fichas
     activas y ya publicadas (estado_ficha='completa'), con sus franjas. */
  try {
    const { data: fichas } = await supabase
      .from('networking_expositores')
      .select('id, nombre, descripcion, logo_url, stand, tipo_persona, sitio_web, redes, categoria_negocio, orden')
      .eq('evento_id', evento.id).eq('activo', true).eq('estado_ficha', 'completa')
      .order('orden', { ascending: true }).order('nombre', { ascending: true });
    const lista = fichas || [];
    if (lista.length) {
      const { data: franjas } = await supabase
        .from('agenda_sessions').select('id, titulo, inicio, fin, ubicacion, expositor_id')
        .in('expositor_id', lista.map(f => f.id))
        .neq('moderacion', 'pendiente').neq('moderacion', 'rechazado')
        .order('inicio', { ascending: true });
      const porExpo = {};
      for (const fr of (franjas || [])) (porExpo[fr.expositor_id] = porExpo[fr.expositor_id] || []).push(fr);
      for (const f of lista) f.franjas = porExpo[f.id] || [];
    }
    evento.expositores = lista;
    evento.tiene_expositores = lista.length > 0;
  } catch { evento.expositores = []; evento.tiene_expositores = false; }

  /* Sub-eventos ubicados en el mapa: se resuelven en vivo (título/hora frescos)
     a partir de los marcadores tipo 'sesion' de page_json.mapa. */
  try {
    const marc = Array.isArray(evento.page_json?.mapa?.marcadores) ? evento.page_json.mapa.marcadores : [];
    const sesionIds = [...new Set(marc.filter(m => m?.tipo === 'sesion' && m.sesion_id).map(m => m.sesion_id))];
    if (sesionIds.length) {
      const { data: ses } = await supabase
        .from('agenda_sessions').select('id, titulo, tipo, inicio, fin, ubicacion').in('id', sesionIds);
      evento.mapa_sesiones = ses || [];
    } else {
      evento.mapa_sesiones = [];
    }
  } catch { evento.mapa_sesiones = []; }

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

/* Carga pública (solo lectura) de un torneo: equipos + partidos sin datos
   sensibles. Reutilizada por la vista singular y la de un torneo concreto. */
async function cargarTorneoPublico(torneo) {
  const { data: equipos } = await supabase
    .from('torneo_equipos').select('id, nombre, foto_url').eq('torneo_id', torneo.id).order('created_at', { ascending: true });
  const { data: partidos } = await supabase
    .from('torneo_partidos')
    .select('id, ronda, orden, equipo_a_id, equipo_b_id, marcador_a, marcador_b, estado, cancha, fecha_hora, fase, grupo')
    .eq('torneo_id', torneo.id)
    .order('ronda', { ascending: true })
    .order('orden', { ascending: true });
  return { torneo, equipos: equipos || [], partidos: partidos || [] };
}

async function eventoPublicado(slug) {
  const { data: evento } = await supabase
    .from('eventos').select('id, estado').eq('slug', slug).is('deleted_at', null).maybeSingle();
  if (!evento || evento.estado !== 'publicado') return null;
  return evento;
}

/* GET /eventos/publicos/slug/:slug/torneos — lista de torneos del evento. */
router.get('/slug/:slug/torneos', async (req, res) => {
  const evento = await eventoPublicado(req.params.slug);
  if (!evento) return res.status(404).json({ error: 'Evento no disponible.' });
  const { data: torneos } = await supabase
    .from('torneos').select('id, nombre, formato, estado, disciplina, fase_actual, orden')
    .eq('evento_id', evento.id)
    .order('orden', { ascending: true }).order('created_at', { ascending: true });
  res.json({ torneos: torneos || [] });
});

/* GET /eventos/publicos/slug/:slug/torneos/:torneoId — un torneo concreto. */
router.get('/slug/:slug/torneos/:torneoId', async (req, res) => {
  const evento = await eventoPublicado(req.params.slug);
  if (!evento) return res.status(404).json({ error: 'Evento no disponible.' });
  const { data: torneo } = await supabase
    .from('torneos').select('id, nombre, formato, estado, disciplina, fase_actual, num_grupos, avanzan_por_grupo')
    .eq('id', req.params.torneoId).eq('evento_id', evento.id).maybeSingle();
  if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
  res.json(await cargarTorneoPublico(torneo));
});

/* GET /eventos/publicos/slug/:slug/torneo — RETROCOMPAT: primer torneo,
   más la lista de todos para que la página pública ofrezca el selector. */
router.get('/slug/:slug/torneo', async (req, res) => {
  const evento = await eventoPublicado(req.params.slug);
  if (!evento) return res.status(404).json({ error: 'Evento no disponible.' });

  const { data: torneos } = await supabase
    .from('torneos').select('id, nombre, formato, estado, disciplina, fase_actual, num_grupos, avanzan_por_grupo')
    .eq('evento_id', evento.id)
    .order('orden', { ascending: true }).order('created_at', { ascending: true });

  if (!torneos || !torneos.length) return res.json({ torneo: null, torneos: [] });
  const full = await cargarTorneoPublico(torneos[0]);
  res.json({ ...full, torneos });
});

/* GET /eventos/publicos/slug/:slug/agenda — agenda completa de solo
   lectura (todas las salas/tracks), sin necesidad de login ni boleta.
   Los favoritos personales se consultan aparte (requieren boleta), vía
   /eventos/:eventoId/agenda/mis-favoritos. */
router.get('/slug/:slug/agenda', async (req, res) => {
  const { slug } = req.params;

  const { data: evento } = await supabase
    .from('eventos').select('id, estado').eq('slug', slug).is('deleted_at', null).maybeSingle();
  if (!evento || evento.estado !== 'publicado') return res.status(404).json({ error: 'Evento no disponible.' });

  const { data: sessions } = await supabase
    .from('agenda_sessions')
    .select(`id, titulo, descripcion, inicio, fin, track, ubicacion, tipo, torneo_id, expositor_id,
             speaker:speakers!speaker_id(id, nombre, foto_url, empresa),
             expositor:networking_expositores!expositor_id(id, nombre, logo_url)`)
    .eq('evento_id', evento.id)
    .neq('moderacion', 'pendiente').neq('moderacion', 'rechazado')
    .order('inicio', { ascending: true });

  res.json({ evento_id: evento.id, sessions: sessions || [] });
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

  /* Solo se validan los campos aplicables a ESTE tipo de boleta: los globales
     (ticket_type_id NULL) y los específicos de `tipo`. Un campo obligatorio de
     VIP no debe bloquear una compra de General. */
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
