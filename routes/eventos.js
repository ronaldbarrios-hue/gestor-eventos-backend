const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { slugify, uniqueEventoSlug } = require('../lib/slug.js');
const { otorgarBadge } = require('../lib/gamificacion.js');
const { auditar } = require('../lib/auditar.js');
const { esUrlImagenSegura } = require('../lib/urls.js');
const { dispatch } = require('../lib/webhooks.js');
const { assertPermiso } = require('../lib/acceso.js');
const router = express.Router();
router.use(verifySupabaseJWT);

const CAMPOS_EDITABLES = [
  'titulo', 'descripcion', 'cover_url', 'modalidad',
  'fecha_inicio', 'fecha_fin', 'timezone',
  'location_nombre', 'location_direccion', 'lat', 'lng', 'url_virtual',
  'links', 'gallery',
  'currency', 'edad_minima', 'aforo_total',
  'categoria_id', 'page_json', 'email_reminders',
  'pago_llave', 'pago_qr_url', 'pago_instrucciones',
];

const ESTADOS_VALIDOS = ['borrador', 'publicado', 'cancelado', 'finalizado'];

/* GET /eventos — lista de mis eventos + eventos donde soy miembro activo */
router.get('/', async (req, res) => {
  const { q, estado, modalidad, page = 1, limit = 20 } = req.query;
  const desde = (Number(page) - 1) * Number(limit);
  const hasta = desde + Number(limit) - 1;

  const { data: memberships } = await supabase
    .from('event_members')
    .select('evento_id')
    .eq('user_id', req.user.id)
    .eq('status', 'active');

  const memberEventIds = (memberships || []).map(m => m.evento_id);

  let query = supabase
    .from('eventos')
    .select('*, categoria:categorias(slug, nombre)', { count: 'exact' })
    .or(`owner_id.eq.${req.user.id}${memberEventIds.length ? `,id.in.(${memberEventIds.join(',')})` : ''}`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(desde, hasta);

  if (q)         query = query.ilike('titulo', `%${q}%`);
  if (estado)    query = query.eq('estado', estado);
  if (modalidad) query = query.eq('modalidad', modalidad);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const memberSet = new Set(memberEventIds);
  const eventos = (data || []).map(e => ({
    ...e,
    soyOwner: String(e.owner_id) === String(req.user.id),
    esMiembro: memberSet.has(e.id),
  }));

  res.json({ eventos, total: count ?? 0 });
});

/* GET /eventos/:id — evento del owner O de un miembro activo */
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('eventos')
    .select('*, categoria:categorias(slug, nombre)')
    .eq('id', req.params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Evento no encontrado.' });

  if (String(data.owner_id) === String(req.user.id)) {
    return res.json({ evento: data, soyOwner: true, permisos: ['*'] });
  }

  const { data: m } = await supabase
    .from('event_members')
    .select('custom_permissions, rol, rol_detail:event_roles!rol_id(permissions)')
    .eq('evento_id', data.id)
    .eq('user_id', req.user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (!m) return res.status(404).json({ error: 'Evento no encontrado.' });

  const permisos = [...new Set([
    ...(m.rol_detail?.permissions || []),
    ...(m.custom_permissions || []),
  ])];
  res.json({ evento: data, soyOwner: false, mi_rol: m.rol, permisos });
});

/* POST /eventos — crear */
router.post('/', async (req, res) => {
  const { titulo, fecha_inicio } = req.body;
  if (!titulo)       return res.status(400).json({ error: 'titulo requerido.' });
  if (!fecha_inicio) return res.status(400).json({ error: 'fecha_inicio requerida.' });

  const insert = { owner_id: req.user.id, estado: 'borrador' };
  for (const k of CAMPOS_EDITABLES) {
    if (k in req.body) insert[k] = req.body[k];
  }
  insert.slug = await uniqueEventoSlug(supabase, req.body.slug || titulo);

  const { data, error } = await supabase
    .from('eventos')
    .insert(insert)
    .select('*, categoria:categorias(slug, nombre)')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  supabase.from('eventos').select('id', { count: 'exact', head: true })
    .eq('owner_id', req.user.id).is('deleted_at', null)
    .then(({ count }) => {
      if ((count || 0) >= 1) otorgarBadge(req.user.id, 'primer_evento');
      if ((count || 0) >= 5) otorgarBadge(req.user.id, 'organizador_pro');
    });

  auditar(req, data.id, 'evento.crear', { entidad: 'evento', entidadId: data.id, detalle: { titulo: data.titulo } });
  res.status(201).json({ evento: data });
});

/* POST /eventos/:id/duplicar — clona un evento con toda su estructura.
   Copia la CONFIGURACION (landing, branding, correos, checkout, SEO, boletas,
   formulario, speakers, patrocinadores y roles propios) pero NO las personas
   ni las ventas: el clon nace en borrador, sin asistentes ni aforo vendido.
   Se usa tanto en "Duplicar" de la lista como al crear desde una plantilla. */
router.post('/:id/duplicar', async (req, res) => {
  const { data: origen, error: e1 } = await supabase
    .from('eventos').select('*')
    .eq('id', req.params.id).is('deleted_at', null).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!origen) return res.status(404).json({ error: 'Evento no encontrado.' });
  if (String(origen.owner_id) !== String(req.user.id)) {
    return res.status(403).json({ error: 'Solo el dueño del evento puede duplicarlo.' });
  }

  const titulo = String(req.body?.titulo || '').trim() || `${origen.titulo} (copia)`;

  /* page_json se copia salvo `documentos`: esos archivos pertenecen al evento
     original y arrastrar sus referencias confundiria al organizador. */
  const page_json = { ...(origen.page_json || {}) };
  delete page_json.documentos;

  const insert = { owner_id: req.user.id, estado: 'borrador', titulo, page_json, aforo_vendido: 0 };
  for (const k of CAMPOS_EDITABLES) {
    if (k === 'titulo' || k === 'page_json') continue;
    if (origen[k] !== undefined) insert[k] = origen[k];
  }
  insert.slug = await uniqueEventoSlug(supabase, titulo);

  const { data: nuevo, error: e2 } = await supabase
    .from('eventos').insert(insert)
    .select('*, categoria:categorias(slug, nombre)').single();
  if (e2) return res.status(500).json({ error: e2.message });

  /* Clona las tablas hijas. Best-effort: si una falla, el clon no se pierde. */
  const copiado = {};
  const clonar = async (tabla, transformar = (r) => r, filtro = null) => {
    try {
      let q = supabase.from(tabla).select('*').eq('evento_id', origen.id);
      if (filtro) q = filtro(q);
      const { data: filasOrigen } = await q;
      if (!filasOrigen?.length) return;
      const filas = filasOrigen.map(r => {
        const copia = { ...r, evento_id: nuevo.id };
        delete copia.id; delete copia.created_at; delete copia.updated_at;
        return transformar(copia);
      });
      const { error } = await supabase.from(tabla).insert(filas);
      if (!error) copiado[tabla] = filas.length;
    } catch { /* una tabla que falle no debe tumbar la duplicacion */ }
  };

  /* ticket_types se clona a mano para capturar el mapa old_id → new_id: los
     campos de formulario específicos de un tipo deben re-apuntar al tipo NUEVO,
     no al del evento original. */
  const mapaTipos = {};
  try {
    const { data: tiposOrigen } = await supabase
      .from('ticket_types').select('*').eq('evento_id', origen.id);
    for (const t of (tiposOrigen || [])) {
      const copia = { ...t, evento_id: nuevo.id, vendidos: 0 };
      delete copia.id; delete copia.created_at; delete copia.updated_at;
      const { data: insertado } = await supabase.from('ticket_types').insert(copia).select('id').single();
      if (insertado) mapaTipos[t.id] = insertado.id;
    }
    copiado.ticket_types = Object.keys(mapaTipos).length;
  } catch { /* best-effort */ }

  await clonar('event_form_fields', r => ({
    ...r,
    ticket_type_id: r.ticket_type_id ? (mapaTipos[r.ticket_type_id] || null) : null,
  }));
  await clonar('speakers');
  await clonar('sponsors');
  /* Los roles de sistema los crea sola la BD al insertar el evento. */
  await clonar('event_roles', r => r, q => q.eq('is_system', false));

  auditar(req, nuevo.id, 'evento.crear', {
    entidad: 'evento', entidadId: nuevo.id,
    detalle: { titulo: nuevo.titulo, duplicado_de: origen.id },
  });
  res.status(201).json({ evento: nuevo, copiado });
});

/* PATCH /eventos/:id — editar */
router.patch('/:id', async (req, res) => {
  const { data: actual, error: e1 } = await supabase
    .from('eventos')
    .select('id, owner_id, slug, titulo')
    .eq('id', req.params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!actual) return res.status(404).json({ error: 'Evento no encontrado.' });

  let camposPermitidos = null;
  if (actual.owner_id !== req.user.id) {
    const { data: m } = await supabase
      .from('event_members')
      .select('custom_permissions, rol_detail:event_roles!rol_id(permissions)')
      .eq('evento_id', actual.id).eq('user_id', req.user.id).eq('status', 'active')
      .maybeSingle();
    if (!m) return res.status(403).json({ error: 'No autorizado.' });

    const perms = new Set([
      ...(m.rol_detail?.permissions || []),
      ...(m.custom_permissions || []),
    ]);
    camposPermitidos = new Set();
    if (perms.has('editar_pagina_publica')) camposPermitidos.add('page_json');
    if (perms.has('gestionar_imagenes')) { camposPermitidos.add('cover_url'); camposPermitidos.add('gallery'); }
    if (perms.has('editar_evento')) {
      for (const c of CAMPOS_EDITABLES) {
        if (!c.startsWith('pago_') && c !== 'page_json') camposPermitidos.add(c);
      }
    }
    if (camposPermitidos.size === 0) {
      return res.status(403).json({ error: 'Tu rol no puede editar este evento.' });
    }
  }

  const puede = (k) => camposPermitidos === null || camposPermitidos.has(k);
  const updates = {};
  for (const k of CAMPOS_EDITABLES) {
    if (k in req.body && puede(k)) updates[k] = req.body[k];
  }

  if (camposPermitidos === null && req.body.slug && req.body.slug !== actual.slug) {
    updates.slug = await uniqueEventoSlug(supabase, req.body.slug);
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Sin cambios.' });
  }

  for (const campo of ['cover_url', 'pago_qr_url']) {
    if (campo in updates && !esUrlImagenSegura(updates[campo])) {
      return res.status(400).json({ error: `URL inválida en ${campo}.` });
    }
  }

  const { data, error } = await supabase
    .from('eventos')
    .update(updates)
    .eq('id', req.params.id)
    .select('*, categoria:categorias(slug, nombre)')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  auditar(req, data.id, 'evento.editar', { entidad: 'evento', entidadId: data.id, detalle: { campos: Object.keys(updates) } });
  res.json({ evento: data });
});

/* Helper: ¿puede este usuario editar el evento (owner o miembro con permiso)? */
async function puedeEditarEvento(req, eventoId) {
  const { data: ev } = await supabase
    .from('eventos').select('id, owner_id').eq('id', eventoId).is('deleted_at', null).maybeSingle();
  if (!ev) return { ok: false, status: 404, error: 'Evento no encontrado.' };
  if (ev.owner_id === req.user.id) return { ok: true };

  const { data: m } = await supabase
    .from('event_members')
    .select('custom_permissions, rol_detail:event_roles!rol_id(permissions)')
    .eq('evento_id', eventoId).eq('user_id', req.user.id).eq('status', 'active')
    .maybeSingle();
  if (!m) return { ok: false, status: 403, error: 'No autorizado.' };

  const perms = new Set([...(m.rol_detail?.permissions || []), ...(m.custom_permissions || [])]);
  if (!perms.has('editar_evento')) return { ok: false, status: 403, error: 'Tu rol no puede editar este evento.' };
  return { ok: true };
}

/* Tipos de campo soportados por el formulario de compra personalizado.
   'foto' guarda una URL de imagen (subida a Supabase Storage desde el
   frontend) en vez de texto libre. */
const TIPOS_CAMPO_VALIDOS = ['texto', 'numero', 'fecha', 'seleccion', 'checkbox', 'foto'];

/* GET /eventos/:id/formulario — campos personalizados del formulario de compra */
router.get('/:id/formulario', async (req, res) => {
  const permiso = await puedeEditarEvento(req, req.params.id);
  if (!permiso.ok) return res.status(permiso.status).json({ error: permiso.error });

  const { data, error } = await supabase
    .from('event_form_fields')
    .select('id, tipo, etiqueta, opciones, requerido, orden, ticket_type_id')
    .eq('evento_id', req.params.id)
    .order('orden', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ campos: data });
});

/* PUT /eventos/:id/formulario — guarda la lista de campos personalizados.
   Body: { campos: [{ id?, tipo, etiqueta, opciones, requerido }, ...] }
   Hace un "diff": campos con `id` existente se ACTUALIZAN in-place
   (conservan su id, así las respuestas ya guardadas en boletas no quedan
   huérfanas); campos sin `id` se INSERTAN; campos que ya no vienen en la
   lista se BORRAN. */
router.put('/:id/formulario', async (req, res) => {
  const permiso = await puedeEditarEvento(req, req.params.id);
  if (!permiso.ok) return res.status(permiso.status).json({ error: permiso.error });

  const campos = Array.isArray(req.body.campos) ? req.body.campos : [];
  if (campos.length > 20) return res.status(400).json({ error: 'Máximo 20 campos personalizados.' });

  for (const c of campos) {
    if (!c.etiqueta?.trim()) return res.status(400).json({ error: 'Cada campo necesita una etiqueta.' });
    if (!TIPOS_CAMPO_VALIDOS.includes(c.tipo)) return res.status(400).json({ error: `Tipo de campo inválido: ${c.tipo}` });
    if (c.tipo === 'seleccion' && (!Array.isArray(c.opciones) || c.opciones.length === 0)) {
      return res.status(400).json({ error: `El campo "${c.etiqueta}" necesita al menos una opción.` });
    }
  }

  const { data: existentes, error: eGet } = await supabase
    .from('event_form_fields')
    .select('id')
    .eq('evento_id', req.params.id);
  if (eGet) return res.status(500).json({ error: eGet.message });

  const idsExistentes = new Set((existentes || []).map(c => c.id));
  const idsEnviados = new Set(campos.filter(c => c.id && idsExistentes.has(c.id)).map(c => c.id));

  /* 1) Borrar los que ya no vienen en la lista */
  const idsABorrar = [...idsExistentes].filter(id => !idsEnviados.has(id));
  if (idsABorrar.length > 0) {
    const { error: eDel } = await supabase.from('event_form_fields').delete().in('id', idsABorrar);
    if (eDel) return res.status(500).json({ error: eDel.message });
  }

  /* 2) Actualizar los que conservan su id (mantiene el vínculo con respuestas ya guardadas) */
  for (let i = 0; i < campos.length; i++) {
    const c = campos[i];
    if (c.id && idsExistentes.has(c.id)) {
      const { error: eUpd } = await supabase
        .from('event_form_fields')
        .update({
          tipo: c.tipo,
          etiqueta: c.etiqueta.trim(),
          opciones: c.tipo === 'seleccion' ? c.opciones : null,
          requerido: Boolean(c.requerido),
          orden: i,
          ticket_type_id: c.ticket_type_id || null,
        })
        .eq('id', c.id);
      if (eUpd) return res.status(500).json({ error: eUpd.message });
    }
  }

  /* 3) Insertar los nuevos (sin id, o con id que ya no existe) */
  const nuevos = campos
    .map((c, i) => ({ ...c, _orden: i }))
    .filter(c => !c.id || !idsExistentes.has(c.id));
  if (nuevos.length > 0) {
    const filas = nuevos.map(c => ({
      evento_id: req.params.id,
      tipo: c.tipo,
      etiqueta: c.etiqueta.trim(),
      opciones: c.tipo === 'seleccion' ? c.opciones : null,
      requerido: Boolean(c.requerido),
      orden: c._orden,
      ticket_type_id: c.ticket_type_id || null,
    }));
    const { error: eIns } = await supabase.from('event_form_fields').insert(filas);
    if (eIns) return res.status(500).json({ error: eIns.message });
  }

  const { data: final, error: eFinal } = await supabase
    .from('event_form_fields')
    .select('id, tipo, etiqueta, opciones, requerido, orden, ticket_type_id')
    .eq('evento_id', req.params.id)
    .order('orden', { ascending: true });
  if (eFinal) return res.status(500).json({ error: eFinal.message });

  auditar(req, req.params.id, 'evento.formulario.editar', { entidad: 'evento', entidadId: req.params.id, detalle: { total_campos: final.length } });
  res.json({ campos: final });
});

/* DELETE /eventos/:id — soft delete */
router.delete('/:id', async (req, res) => {
  const { data: actual } = await supabase
    .from('eventos').select('owner_id').eq('id', req.params.id).maybeSingle();
  if (!actual) return res.status(404).json({ error: 'Evento no encontrado.' });
  if (actual.owner_id !== req.user.id) return res.status(403).json({ error: 'No autorizado.' });

  const { error } = await supabase
    .from('eventos')
    .update({ deleted_at: new Date().toISOString(), estado: 'cancelado' })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  auditar(req, req.params.id, 'evento.borrar', { entidad: 'evento', entidadId: req.params.id });
  res.json({ ok: true });
});

/* POST /eventos/:id/estado — cambiar estado */
router.post('/:id/estado', async (req, res) => {
  const { estado } = req.body;
  if (!ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ error: `estado inválido. Usa: ${ESTADOS_VALIDOS.join(', ')}.` });
  }

  /* `publicar_evento` estaba en el catálogo de permisos pero no lo verificaba
     nadie: publicar era exclusivo del dueño, así que el permiso se podía
     conceder y no servía para nada. */
  try {
    await assertPermiso(req.params.id, req.user.id, ['publicar_evento'], 'id, owner_id');
  } catch (e) {
    const code = e.message === 'Evento no encontrado.' ? 404 : 403;
    return res.status(code).json({ error: e.message });
  }

  const updates = { estado };
  if (estado === 'publicado') updates.published_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('eventos').update(updates).eq('id', req.params.id)
    .select('*, categoria:categorias(slug, nombre)').single();
  if (error) return res.status(500).json({ error: error.message });

  auditar(req, req.params.id, 'evento.estado', { entidad: 'evento', entidadId: req.params.id, detalle: { estado } });
  if (estado === 'publicado') {
    dispatch(req.user.id, 'evento.publicado', { evento_id: data.id, titulo: data.titulo, slug: data.slug });
  }
  res.json({ evento: data });
});

module.exports = router;
