const express = require('express');
const crypto = require('crypto');
const supabase = require('../lib/supabase.js');
const { saldoDeTicket, recompensasDisponibles } = require('../lib/saldoTicket.js');
const { verifySupabaseJWTOptional } = require('../middleware/auth.js');
const { signTicketQR } = require('../lib/qr.js');
const { anotarConstancia } = require('../lib/constanciaLegal.js');
const { notificar } = require('../lib/notificar.js');
const { verifyTurnstile } = require('../lib/turnstile.js');
const { enviarEmailEvento } = require('../lib/emailPlantillas.js');
/* `COLUMNAS_CAMPO` y no una lista escrita a mano: las dos consultas de abajo
   tenían su propia copia recortada, y por eso `grupo`, `ayuda` y `buscable` se
   guardaban, se editaban en el panel… y no llegaban nunca a la página pública.
   El servidor es la autoridad, pero sólo si sirve lo que guarda. */
const { validarFormulario, normalizarRespuestas, COLUMNAS_CAMPO } = require('../lib/formularioCampos.js');
const { avisarExpositorSiAplica } = require('../lib/avisoExpositor.js');
const { validarOferta, consumirOferta, hayCupoLibre } = require('../lib/waitlistOferta.js');
const { conSitio } = require('../lib/eventoSitio.js');

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
       currency, modo_publico, url_externa,
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
   `evento.campos_formulario` (para saber qué preguntas hacen falta).

   `fecha_fin` y `page_json` se añadieron después, porque su ausencia rompía
   dos cosas en la página de la boleta sin dar ningún error:

   - Sin `fecha_fin`, el enlace «Añadir a Google Calendar» caía a su respaldo
     de dos horas. En un evento de dos días el asistente se guardaba una cita
     de 9 a 11 de la mañana del primer día. Importa más de lo que parece: al
     dejar los recordatorios en manos del calendario, esa cita es el único
     aviso que recibe.
   - Sin `page_json`, la escarapela digital se pintaba siempre con el diseño
     por defecto. El organizador la configura en Asistentes → Tarjeta, la
     previsualiza, la guarda… y el asistente nunca veía su marca ni su logo,
     ni en pantalla ni en la versión impresa. */
router.get('/ticket/:codigo', async (req, res) => {
  const codigo = req.params.codigo.toUpperCase().trim();
  if (!codigo || codigo.length < 4) return res.status(400).json({ error: 'Código inválido.' });

  const { data, error } = await supabase
    .from('tickets')
    .select(`
      id, codigo, qr_token, estado, precio_pagado, created_at, checked_in_at, respuestas,
      guest_nombre, guest_email,
      tipo:ticket_types!ticket_type_id(nombre, descripcion, currency, es_expositor),
      evento:eventos!evento_id(id, slug, titulo, fecha_inicio, fecha_fin, location_nombre, cover_url, page_json)
    `)
    .eq('codigo', codigo)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Boleta no encontrada.' });

  if (data.evento?.id) {
    const { data: campos } = await supabase
      .from('event_form_fields')
      .select(COLUMNAS_CAMPO)
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
      .from('eventos').select('owner_id, page_json').eq('id', data.evento.id).maybeSingle();
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

    /* Pasaporte gamificado: cada expositor distinto que le marcó la escarapela
       es un sello. Al reunir la meta, se desbloquea el premio. */
    const pasa = ev?.page_json?.pasaporte;
    if (pasa?.activo) {
      const { data: visitas } = await supabase.from('ticket_interacciones')
        .select('expositor_id').eq('ticket_id', data.id).not('expositor_id', 'is', null);
      const ids = [...new Set((visitas || []).map(v => v.expositor_id))];
      let expos = [];
      if (ids.length) {
        const { data: e } = await supabase.from('networking_expositores')
          .select('id, nombre, logo_url, stand').in('id', ids);
        expos = e || [];
      }
      const meta = Number(pasa.meta) > 0 ? Number(pasa.meta) : ids.length;
      data.pasaporte = {
        activo: true,
        titulo: pasa.titulo || 'Pasaporte del evento',
        descripcion: pasa.descripcion || '',
        premio_texto: pasa.premio_texto || '',
        meta,
        visitados: ids.length,
        expositores_visitados: expos,
        completo: meta > 0 && ids.length >= meta,
      };
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
    .select('id, evento_id, respuestas, ticket_type_id')
    .eq('codigo', codigo)
    .maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!ticket) return res.status(404).json({ error: 'Boleta no encontrada.' });
  if (ticket.respuestas) return res.status(400).json({ error: 'Esta boleta ya tiene el formulario completado.' });

  const { data: campos } = await supabase
    .from('event_form_fields')
    .select('id, etiqueta, requerido, tipo, opciones, ticket_type_id')
    .eq('evento_id', ticket.evento_id);

  /* Antes aquí solo se comprobaba que un obligatorio no llegara vacío: un campo
     de correo aceptaba "hola", uno de número aceptaba letras y una selección
     aceptaba cualquier texto aunque no estuviera entre sus opciones. Con una
     ficha de caracterización eso ensucia el dato justo donde luego hay que
     reportar. */
  const fallo = validarFormulario(campos, respuestas, ticket.ticket_type_id);
  if (fallo) return res.status(400).json({ error: fallo });

  const limpias = normalizarRespuestas(campos, respuestas);
  const { error: e2 } = await supabase
    .from('tickets')
    .update({ respuestas: Object.keys(limpias).length ? limpias : {} })
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
  'contacto_nombre', 'contacto_email', 'contacto_telefono', 'sitio_web', 'redes',
  'categoria_negocio', 'galeria'];

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
      branding, paginas, navbar,
      modo_publico, url_externa,
      pago_llave, pago_qr_url, pago_instrucciones,
      owner_id,
      categoria:categorias(slug, nombre),
      organizador:profiles!owner_id(nombre, handle, avatar_url, empresa, branding, empresa_logo_url),
      ticket_types(id, nombre, descripcion, precio, currency, cupo, vendidos,
                   early_bird_precio, early_bird_hasta, venta_hasta, zonas_acceso, orden, activo)
    `)
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  /* El organizador dueño del evento SÍ puede verlo aunque esté en borrador —
     es justo lo que necesita el botón "Ver sitio público"/preview del editor
     de la landing. Cualquier otra persona (o nadie logueado) sigue viendo
     404 mientras no esté publicado: el borrador no se filtra al público. */
  const esDueño = Boolean(req.user?.id) && req.user.id === evento?.owner_id;
  if (!evento || (evento.estado !== 'publicado' && !esDueño)) {
    return res.status(404).json({ error: 'Este evento no existe o no está publicado.' });
  }

  evento.ticket_types = (evento.ticket_types || [])
    .filter(t => t.activo)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));

  const { data: camposForm } = await supabase
    .from('event_form_fields')
    .select(COLUMNAS_CAMPO)
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
      /* Qué pasarelas tiene conectadas el organizador (sin exponer llaves). */
      const { data: pay } = await supabase.from('profiles')
        .select('mp_access_token, wompi_public_key').eq('id', owner.owner_id).maybeSingle();
      evento.pago_mp = Boolean(pay?.mp_access_token);
      evento.pago_wompi = Boolean(pay?.wompi_public_key);
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

  supabase.from('event_views').insert({
    evento_id    : evento.id,
    visitor_hash : visitorHash(req),
    source       : classifySource(req.headers['referer'] || req.headers['referrer']),
    referrer     : req.headers['referer'] || null,
  }).then(() => {}, () => {});

  /* owner_id solo hacía falta para decidir si el dueño puede previsualizar
     su borrador (arriba) — no es dato del público, no viaja en la respuesta. */
  delete evento.owner_id;

  /* `conSitio` devuelve el evento con la marca, las páginas y el navbar
     también dentro de `page_json` (0064). La página pública lleva años
     leyendo `page_json.branding` y no tiene por qué enterarse de que ahora
     viven en columnas propias. */
  res.json({ evento: conSitio(evento) });
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

async function eventoPublicado(slug, requesterId) {
  /* Se traen también el título y el organizador: las páginas públicas que
     cuelgan del evento (torneo, agenda) necesitan pintar su cabecera y el
     enlace de vuelta, y antes solo recibían el id — por eso flotaban sin
     contexto. */
  const { data: evento } = await supabase
    .from('eventos')
    .select(`id, estado, titulo, slug, owner_id,
             organizador:profiles!owner_id(nombre, empresa, branding, empresa_logo_url)`)
    .eq('slug', slug).is('deleted_at', null).maybeSingle();
  if (!evento) return null;
  /* Igual que en /slug/:slug: el dueño puede previsualizar su borrador,
     nadie más. */
  const esDueño = Boolean(requesterId) && requesterId === evento.owner_id;
  if (evento.estado !== 'publicado' && !esDueño) return null;
  delete evento.owner_id;
  return evento;
}

/* GET /eventos/publicos/slug/:slug/torneos — lista de torneos del evento. */
router.get('/slug/:slug/torneos', async (req, res) => {
  const evento = await eventoPublicado(req.params.slug, req.user?.id);
  if (!evento) return res.status(404).json({ error: 'Evento no disponible.' });
  const { data: torneos } = await supabase
    .from('torneos').select('id, nombre, formato, estado, disciplina, fase_actual, orden')
    .eq('evento_id', evento.id)
    .order('orden', { ascending: true }).order('created_at', { ascending: true });
  res.json({ torneos: torneos || [] });
});

/* GET /eventos/publicos/slug/:slug/torneos/:torneoId — un torneo concreto. */
router.get('/slug/:slug/torneos/:torneoId', async (req, res) => {
  const evento = await eventoPublicado(req.params.slug, req.user?.id);
  if (!evento) return res.status(404).json({ error: 'Evento no disponible.' });
  const { data: torneo } = await supabase
    .from('torneos').select('id, nombre, formato, estado, disciplina, fase_actual, num_grupos, avanzan_por_grupo')
    .eq('id', req.params.torneoId).eq('evento_id', evento.id).maybeSingle();
  if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
  res.json({ ...(await cargarTorneoPublico(torneo)), evento });
});

/* GET /eventos/publicos/slug/:slug/torneo — RETROCOMPAT: primer torneo,
   más la lista de todos para que la página pública ofrezca el selector. */
router.get('/slug/:slug/torneo', async (req, res) => {
  const evento = await eventoPublicado(req.params.slug, req.user?.id);
  if (!evento) return res.status(404).json({ error: 'Evento no disponible.' });

  const { data: torneos } = await supabase
    .from('torneos').select('id, nombre, formato, estado, disciplina, fase_actual, num_grupos, avanzan_por_grupo')
    .eq('evento_id', evento.id)
    .order('orden', { ascending: true }).order('created_at', { ascending: true });

  if (!torneos || !torneos.length) return res.json({ torneo: null, torneos: [] });
  const full = await cargarTorneoPublico(torneos[0]);
  res.json({ ...full, torneos, evento });
});

/* Campeón de un torneo ya terminado.

   Se calcula, no se guarda: no hay columna `ganador` y añadirla obligaría a
   mantenerla al día en cada edición de marcador. Dos formas según el formato:
     - eliminación (y grupos+eliminación): gana el que ganó el último partido
       jugado de la ronda más alta;
     - liga: el primero de la tabla por puntos y luego diferencia de goles,
       con el mismo criterio que ya usa la página pública del torneo.
   Devuelve null mientras quede algo por jugar: un campeón provisional es
   peor que ninguno. */
function campeonDe(torneo, equipos, partidos) {
  const jugados = partidos.filter(p => p.estado === 'jugado');
  if (!jugados.length || jugados.length !== partidos.length) return null;
  const porId = new Map(equipos.map(e => [e.id, e]));

  if (torneo.formato === 'liga') {
    const tabla = new Map(equipos.map(e => [e.id, { id: e.id, puntos: 0, gf: 0, gc: 0 }]));
    for (const p of jugados) {
      const a = tabla.get(p.equipo_a_id), b = tabla.get(p.equipo_b_id);
      if (!a || !b) continue;
      a.gf += p.marcador_a; a.gc += p.marcador_b;
      b.gf += p.marcador_b; b.gc += p.marcador_a;
      if (p.marcador_a > p.marcador_b) a.puntos += 3;
      else if (p.marcador_a < p.marcador_b) b.puntos += 3;
      else { a.puntos += 1; b.puntos += 1; }
    }
    const [primero] = [...tabla.values()]
      .sort((x, y) => y.puntos - x.puntos || (y.gf - y.gc) - (x.gf - x.gc));
    return primero ? porId.get(primero.id) || null : null;
  }

  const ultimaRonda = Math.max(...jugados.map(p => Number(p.ronda) || 0));
  const finales = jugados.filter(p => Number(p.ronda) === ultimaRonda);
  if (finales.length !== 1) return null;          // aún no hay una sola final
  const f = finales[0];
  if (f.marcador_a === f.marcador_b) return null; // empate sin desempatar
  return porId.get(f.marcador_a > f.marcador_b ? f.equipo_a_id : f.equipo_b_id) || null;
}

/* GET /eventos/publicos/slug/:slug/torneos-resumen
   Todos los torneos del evento con su campeón y sus participantes, sin el
   fixture entero. Es lo que se incrusta en la web del organizador: quien la
   visita quiere saber quién ganó y quién jugó, no navegar el bracket. */
router.get('/slug/:slug/torneos-resumen', async (req, res) => {
  const evento = await eventoPublicado(req.params.slug, req.user?.id);
  if (!evento) return res.status(404).json({ error: 'Evento no disponible.' });

  const { data: torneos } = await supabase
    .from('torneos').select('id, nombre, formato, estado, disciplina, fase_actual, orden, categoria_id')
    .eq('evento_id', evento.id)
    .order('orden', { ascending: true }).order('created_at', { ascending: true });

  const lista = [];
  for (const t of torneos || []) {
    const { equipos, partidos } = await cargarTorneoPublico(t);
    lista.push({
      ...t,
      equipos,
      campeon: campeonDe(t, equipos, partidos),
      partidos_jugados: partidos.filter(p => p.estado === 'jugado').length,
      partidos_total: partidos.length,
    });
  }

  /* El árbol de categorías (#48) viaja plano con la respuesta: la página lo
     arma sola y así navegar de "deportes" a "contacto" no cuesta una petición
     por nivel. Si la 0062 no está aplicada, se devuelve vacío y la vista cae
     a la lista de siempre. */
  let categorias = [];
  try {
    const { data } = await supabase
      .from('torneo_categorias').select('id, padre_id, nombre, orden')
      .eq('evento_id', evento.id)
      .order('orden', { ascending: true }).order('nombre', { ascending: true });
    categorias = data || [];
  } catch { categorias = []; }

  res.json({ evento, torneos: lista, categorias });
});

/* GET /eventos/publicos/slug/:slug/ranking
   Clasificación de expositores por puntos otorgados en sus stands.

   Sólo expositores, nunca asistentes: el ranking de personas se calcula sobre
   `ticket_interacciones` y publicarlo expondría quién fue al evento y cuánto
   se movió, que es dato de asistente y no información del evento. La versión
   interna de esa tabla vive en el panel y ahí se queda. */
router.get('/slug/:slug/ranking', async (req, res) => {
  const evento = await eventoPublicado(req.params.slug, req.user?.id);
  if (!evento) return res.status(404).json({ error: 'Evento no disponible.' });

  const { data, error } = await supabase.from('ticket_interacciones')
    .select('expositor_id, puntos')
    .eq('evento_id', evento.id).not('expositor_id', 'is', null);
  if (error) return res.status(500).json({ error: error.message });

  const agg = {};
  for (const r of data || []) {
    const k = r.expositor_id;
    agg[k] = agg[k] || { expositor_id: k, puntos: 0, interacciones: 0 };
    agg[k].puntos += Number(r.puntos || 0);
    agg[k].interacciones += 1;
  }

  const ids = Object.keys(agg);
  let fichas = [];
  if (ids.length) {
    /* Sólo fichas publicadas: un expositor que aún no completó la suya no
       tiene por qué aparecer con su nombre interno en la web de nadie. */
    const { data: exps } = await supabase.from('networking_expositores')
      .select('id, nombre, logo_url, stand')
      .in('id', ids).eq('activo', true).eq('estado_ficha', 'completa');
    fichas = exps || [];
  }
  const porId = new Map(fichas.map(f => [f.id, f]));

  const ranking = ids
    .filter(id => porId.has(id))
    .map(id => ({ ...agg[id], ...porId.get(id) }))
    .sort((x, y) => y.puntos - x.puntos || y.interacciones - x.interacciones);

  res.json({ evento, ranking });
});

/* GET /eventos/publicos/cupo/:token
   ¿Sigue en pie la oferta de cupo que le llegó por correo?

   La página pública lo consulta antes de pintar nada, para poder decir "este
   cupo es tuyo hasta las 19:40" en vez de dejar que la persona rellene el
   formulario entero y se entere al final de que llegó tarde. No devuelve el
   correo ni el nombre de nadie: sólo si vale, para qué boleta y hasta cuándo. */
router.get('/cupo/:token', async (req, res) => {
  const oferta = await validarOferta(req.params.token);
  if (!oferta) return res.json({ valida: false });

  const { data: tipo } = await supabase
    .from('ticket_types').select('id, nombre').eq('id', oferta.ticket_type_id).maybeSingle();
  const { data: ev } = await supabase
    .from('eventos').select('slug, titulo').eq('id', oferta.evento_id).maybeSingle();

  res.json({
    valida: true,
    expira: oferta.oferta_expira,
    ticket_type_id: oferta.ticket_type_id,
    ticket_type_nombre: tipo?.nombre || null,
    evento_slug: ev?.slug || null,
    evento_titulo: ev?.titulo || null,
  });
});

/* GET /eventos/publicos/slug/:slug/agenda — agenda completa de solo
   lectura (todas las salas/tracks), sin necesidad de login ni boleta.
   Los favoritos personales se consultan aparte (requieren boleta), vía
   /eventos/:eventoId/agenda/mis-favoritos. */
router.get('/slug/:slug/agenda', async (req, res) => {
  const { slug } = req.params;

  const { data: evento } = await supabase
    .from('eventos').select('id, estado, owner_id').eq('slug', slug).is('deleted_at', null).maybeSingle();
  const esDueño = Boolean(req.user?.id) && req.user.id === evento?.owner_id;
  if (!evento || (evento.estado !== 'publicado' && !esDueño)) return res.status(404).json({ error: 'Evento no disponible.' });

  /* Los campos de inscripción viajan con la agenda desde la 0055/0059: la
     página pública necesita saber cuáles piden apuntarse, cuánto queda libre y
     qué se pregunta. Antes había que pedirlos aparte a /sesiones, y la agenda
     pública —que es donde la gente los ve— no los tenía. */
  const { data: sessions, error: eSes } = await supabase
    .from('agenda_sessions')
    .select(`id, titulo, descripcion, inicio, fin, track, ubicacion, tipo, torneo_id, expositor_id,
             requiere_inscripcion, cupo, inscritos, formulario_modo,
             speaker:speakers!speaker_id(id, nombre, foto_url, empresa),
             expositor:networking_expositores!expositor_id(id, nombre, logo_url)`)
    .eq('evento_id', evento.id)
    .neq('moderacion', 'pendiente').neq('moderacion', 'rechazado')
    .order('inicio', { ascending: true });

  /* Sin la 0055 esas columnas no existen y el select falla entero. Se
     reintenta sin ellas: la agenda se sigue viendo, sólo que sin inscripción. */
  if (eSes) {
    const { data: basico } = await supabase
      .from('agenda_sessions')
      .select(`id, titulo, descripcion, inicio, fin, track, ubicacion, tipo, torneo_id, expositor_id,
               speaker:speakers!speaker_id(id, nombre, foto_url, empresa),
               expositor:networking_expositores!expositor_id(id, nombre, logo_url)`)
      .eq('evento_id', evento.id)
      .neq('moderacion', 'pendiente').neq('moderacion', 'rechazado')
      .order('inicio', { ascending: true });
    return res.json({ evento_id: evento.id, evento, sessions: basico || [], preguntas: {}, inscripcion_lista: false });
  }

  const lista = (sessions || []).map(s => ({
    ...s,
    libres: s.cupo == null ? null : Math.max(0, s.cupo - (s.inscritos || 0)),
    lleno : s.cupo != null && (s.inscritos || 0) >= s.cupo,
    pide_datos: (s.formulario_modo || 'ninguno') !== 'ninguno',
  }));

  /* Las preguntas de los sub-eventos con formulario propio, todas de una vez:
     una petición por sub-evento al abrir el formulario sería una cascada. Las
     del modo 'evento' no se mandan aquí — son el formulario de compra entero y
     ya viaja en la carga del evento. */
  const conPropio = lista.filter(s => s.formulario_modo === 'propio').map(s => s.id);
  const preguntas = {};
  if (conPropio.length) {
    const { data: campos } = await supabase
      .from('event_form_fields')
      .select('id, session_id, etiqueta, requerido, tipo, opciones, ayuda, orden')
      .in('session_id', conPropio)
      .order('orden', { ascending: true });
    for (const c of (campos || [])) {
      (preguntas[c.session_id] = preguntas[c.session_id] || []).push(c);
    }
  }

  res.json({ evento_id: evento.id, evento, sessions: lista, preguntas, inscripcion_lista: true });
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

  /* Lista de espera: quien llega con el token del correo `cupo_liberado` viene
     a por un sitio que se le guardó a él. Los demás ven ese sitio como
     ocupado —`hayCupoLibre` descuenta las ofertas vivas—, que es lo que hace
     que estar el primero de la fila signifique algo. */
  const oferta = await validarOferta(req.body.waitlist_token);
  const ofertaMia = oferta
    && String(oferta.evento_id) === String(evento.id)
    && String(oferta.ticket_type_id) === String(tipo.id)
    ? oferta : null;
  if (req.body.waitlist_token && !ofertaMia) {
    return res.status(400).json({
      error: 'Ese enlace de cupo ya no vale: o se usó, o se pasó el plazo y le tocó al siguiente.',
    });
  }

  if (!(await hayCupoLibre({ evento, tipo, exceptoId: ofertaMia?.id }))) {
    const agotadoPorTipo = tipo.cupo != null && (tipo.vendidos || 0) >= tipo.cupo;
    return res.status(400).json({
      error: agotadoPorTipo ? 'Este tipo de boleta está agotado.' : 'El evento está al aforo máximo.',
      waitlistAvailable: true,
    });
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
    .from('event_form_fields')
    .select('id, etiqueta, requerido, tipo, opciones, ticket_type_id').eq('evento_id', evento.id);
  const respuestas = req.body.respuestas && typeof req.body.respuestas === 'object' ? req.body.respuestas : {};

  /* validarFormulario ya salta los campos de otro tipo de boleta: un
     obligatorio de la ficha de stand no debe frenar una entrada general. */
  const falloForm = validarFormulario(camposReq, respuestas, tipo.id);
  if (falloForm) return res.status(400).json({ error: falloForm });
  const respuestasLimpias = normalizarRespuestas(camposReq, respuestas);

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
      respuestas    : Object.keys(respuestasLimpias).length ? respuestasLimpias : null,
    })
    .select()
    .single();

  if (e3) return res.status(500).json({ error: e3.message });

  const qr_token = signTicketQR({ ticket_id: ticket.id, evento_id: evento.id, codigo: ticket.codigo });
  await supabase.from('tickets').update({ qr_token }).eq('id', ticket.id);
  ticket.qr_token = qr_token;

  /* Constancia de que aceptó los términos del evento (0069). Va después de
     emitir y sin bloquear: perder la anotación se rehace, perder la venta no. */
  anotarConstancia('tickets', ticket.id, evento.id, req.body.legal_aceptado);

  await supabase.from('ticket_types').update({ vendidos: (tipo.vendidos || 0) + 1 }).eq('id', tipo.id);

  /* La boleta ya existe: se cierra la entrada en la lista y se quema el token
     para que el enlace del correo no sirva dos veces. */
  if (ofertaMia) await consumirOferta(ofertaMia.id);

  if (esGratis) {
    await supabase.from('eventos').update({ aforo_vendido: (evento.aforo_vendido || 0) + 1 }).eq('id', evento.id);

    enviarEmailEvento({
      evento,
      tipo: 'ticket',
      to: ticket.guest_email,
      ctx: {
        nombre     : ticket.guest_nombre,
        tipo_boleta: tipo.nombre,
        codigo     : ticket.codigo,
        qr_token   : ticket.qr_token,
        enlace     : `${process.env.FRONTEND_URL?.split(',')[0] || 'https://gestor-eventos-frontend.vercel.app'}/mi-ticket/${ticket.codigo}`,
      },
    }).then(r => console.log('[reservar] email confirmación resultado:', r));

    /* Un stand puede ser una boleta gratuita (patrocinador, aliado): este camino
       también tiene que avisarle de su portal. */
    avisarExpositorSiAplica(ticket.id).catch(() => {});
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
