const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { slugify, uniqueEventoSlug } = require('../lib/slug.js');
const { otorgarBadge } = require('../lib/gamificacion.js');
const { auditar } = require('../lib/auditar.js');
const { esUrlImagenSegura, esUrlWebSegura } = require('../lib/urls.js');
const { dispatch } = require('../lib/webhooks.js');
const { assertPermiso } = require('../lib/acceso.js');
const {
  TIPOS_CAMPO, GRUPOS, FICHAS,
  MAX_CAMPOS_FORMULARIO, COLUMNAS_CAMPO, filaCampo, validarDefinicion,
  PLANTILLA,
} = require('../lib/formularioCampos.js');
const { ofrecerCupoAlSiguiente } = require('../lib/waitlistOferta.js');
const { conSitio, listaConSitio, partirSitio } = require('../lib/eventoSitio.js');
const { hashDocumento, columnasSinPregunta, clave: clavePadron, ALIAS_DOCUMENTO, extraerDocumento,
  limpiarMapeo, mapeoSugerido, filasSinCruce } = require('../lib/padronPrevio.js');
const { exige, sesion } = require('../core/permisos');
const { fallaPaginas } = require('../lib/bloquesLanding.js');

/* El padrón es parte de configurar el formulario del evento, así que pide lo
   mismo que editarlo. Se declara para el censo de la fase 7 en vez de dejarlo
   pendiente: son rutas nuevas y arreglarlo hoy es barato. */
const PERMS_PADRON = ['editar_evento'];
const router = express.Router();
router.use(verifySupabaseJWT);

const CAMPOS_EDITABLES = [
  'titulo', 'descripcion', 'cover_url', 'modalidad',
  'fecha_inicio', 'fecha_fin', 'timezone',
  'location_nombre', 'location_direccion', 'lat', 'lng', 'url_virtual',
  'links', 'gallery',
  'currency', 'edad_minima', 'aforo_total',
  'categoria_id', 'page_json', 'email_reminders',
  /* Migración 0064: salieron de `page_json` a columnas propias porque tres
     editores distintos las escribían a la vez desde copias distintas del
     evento y se borraban entre sí. */
  'branding', 'paginas', 'navbar',
  'modo_publico', 'url_externa',
  'pago_llave', 'pago_qr_url', 'pago_instrucciones',
];

const ESTADOS_VALIDOS = ['borrador', 'publicado', 'cancelado', 'finalizado'];

/* Lo que configura el SITIO público y no el evento en sí. Se agrupan porque
   comparten permiso (`editar_pagina_publica`) y porque tres de ellas salieron
   de `page_json` en la 0064: sin la lista, el bucle de permisos tendría que
   nombrarlas una a una y la próxima que salga se quedaría fuera sin que nadie
   lo note. */
const CAMPOS_DEL_SITIO = new Set(['page_json', 'branding', 'paginas', 'navbar']);

/* Los tres modos de publicación (migración 0060). Ver el comentario de la
   migración para qué significa cada uno. */
const MODOS_PUBLICOS = ['gestek', 'externa', 'iframe'];

/* Valida el par modo/URL sobre el estado RESULTANTE, no sobre lo que llega:
   un PATCH puede traer sólo `url_externa` estando ya en modo 'externa', o sólo
   el modo confiando en la URL que ya estaba guardada. Comprobar únicamente el
   payload dejaría pasar la mitad de los casos malos. */
function validarPublicacion(modo, url) {
  if (modo && !MODOS_PUBLICOS.includes(modo)) {
    return 'modo_publico debe ser gestek, externa o iframe.';
  }
  if (modo && modo !== 'gestek' && !esUrlWebSegura(url)) {
    return 'Falta la dirección de tu web (http:// o https://) para publicar fuera de GESTEK.';
  }
  if (url != null && String(url).trim() !== '' && !esUrlWebSegura(url)) {
    return 'La dirección de tu web no es válida. Debe empezar por http:// o https://.';
  }
  return null;
}

/* GET /eventos — lista de mis eventos + eventos donde soy miembro activo */
router.get('/', sesion('Los eventos propios y aquellos donde la persona es miembro del equipo. Es «lo mío», no un permiso sobre un evento ajeno: la consulta ya filtra por owner_id o por pertenencia.'), async (req, res) => {
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
  /* `conSitio` mete la marca, las páginas y el navbar dentro de `page_json`
     aunque ya vivan en columnas propias (0064): así ningún lector existente
     tiene que enterarse del cambio. */
  const eventos = listaConSitio(data).map(e => ({
    ...e,
    soyOwner: String(e.owner_id) === String(req.user.id),
    esMiembro: memberSet.has(e.id),
  }));

  res.json({ eventos, total: count ?? 0 });
});

/* GET /eventos/:id — evento del owner O de un miembro activo */
router.get('/:id', sesion('Lee un evento del panel: el dueño siempre, y un miembro activo del equipo. Se comprueba dentro contra owner_id y event_members.'), async (req, res) => {
  const { data, error } = await supabase
    .from('eventos')
    .select('*, categoria:categorias(slug, nombre)')
    .eq('id', req.params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Evento no encontrado.' });

  if (String(data.owner_id) === String(req.user.id)) {
    return res.json({ evento: conSitio(data), soyOwner: true, permisos: ['*'] });
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
  res.json({ evento: conSitio(data), soyOwner: false, mi_rol: m.rol, permisos });
});

/* POST /eventos — crear */
router.post('/', sesion('Crear un evento no necesita permiso sobre ninguno: el que nace queda a nombre de quien lo crea (owner_id = req.user.id).'), async (req, res) => {
  const { titulo, fecha_inicio } = req.body;
  if (!titulo)       return res.status(400).json({ error: 'titulo requerido.' });
  if (!fecha_inicio) return res.status(400).json({ error: 'fecha_inicio requerida.' });

  const insert = { owner_id: req.user.id, estado: 'borrador' };
  for (const k of CAMPOS_EDITABLES) {
    if (k in req.body) insert[k] = req.body[k];
  }
  const falloPub = validarPublicacion(insert.modo_publico, insert.url_externa);
  if (falloPub) return res.status(400).json({ error: falloPub });
  insert.slug = await uniqueEventoSlug(supabase, req.body.slug || titulo);

  /* Un cliente sin actualizar crea el evento mandando la marca dentro de
     `page_json`. Se reparte igual que en el PATCH para que nazca ya con las
     columnas puestas y no haya que migrarlo después. */
  const insertFinal = partirSitio(insert, {});

  const { data, error } = await supabase
    .from('eventos')
    .insert(insertFinal)
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
  res.status(201).json({ evento: conSitio(data) });
});

/* POST /eventos/:id/duplicar — clona un evento con toda su estructura.
   Copia la CONFIGURACION (landing, branding, correos, checkout, SEO, boletas,
   formulario, speakers, patrocinadores y roles propios) pero NO las personas
   ni las ventas: el clon nace en borrador, sin asistentes ni aforo vendido.
   Se usa tanto en "Duplicar" de la lista como al crear desde una plantilla. */
router.post('/:id/duplicar', sesion('Duplicar es leer un evento entero y crear otro: se reserva al dueño del original.'), async (req, res) => {
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
  /* La marca, las páginas y el navbar viajan por el bucle de arriba, que ya
     los recorre como columnas (0064). Se copian a propósito: duplicar un
     evento sin su marca obligaría a rehacerla, que es justo lo que "duplicar"
     viene a evitar. */
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
  res.status(201).json({ evento: conSitio(nuevo), copiado });
});

/* PATCH /eventos/:id — editar */
router.patch('/:id', sesion('Editar el evento: lo comprueba puedeEditarEvento / owner_id + event_members antes de tocar nada.'), async (req, res) => {
  const { data: actual, error: e1 } = await supabase
    .from('eventos')
    /* `page_json` entra en la lectura porque el guardado lo MEZCLA en vez de
        reemplazarlo (0064): hace falta saber qué había para no borrarlo. */
    .select('id, owner_id, slug, titulo, modo_publico, url_externa, page_json')
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
    /* Las tres columnas de la 0064 son la misma cosa que antes iba dentro de
       `page_json`, así que van con el mismo permiso: quien podía editar la
       página pública sigue pudiendo, ni más ni menos. */
    if (perms.has('editar_pagina_publica')) {
      camposPermitidos.add('page_json');
      camposPermitidos.add('branding');
      camposPermitidos.add('paginas');
      camposPermitidos.add('navbar');
    }
    if (perms.has('gestionar_imagenes')) { camposPermitidos.add('cover_url'); camposPermitidos.add('gallery'); }
    if (perms.has('editar_evento')) {
      for (const c of CAMPOS_EDITABLES) {
        if (!c.startsWith('pago_') && !CAMPOS_DEL_SITIO.has(c)) camposPermitidos.add(c);
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

  if ('modo_publico' in updates || 'url_externa' in updates) {
    const fallo = validarPublicacion(
      'modo_publico' in updates ? updates.modo_publico : actual.modo_publico,
      'url_externa'  in updates ? updates.url_externa  : actual.url_externa,
    );
    if (fallo) return res.status(400).json({ error: fallo });
  }

  /* AQUÍ está el arreglo del campo compartido (0064):

     `partirSitio` saca de `page_json` la marca, las páginas y el navbar hacia
     sus columnas —para que un cliente sin actualizar siga guardando bien— y
     MEZCLA el resto sobre lo que ya había en vez de reemplazarlo.

     Antes, una pantalla que mandaba `{...suCopiaVieja, seo}` escribía su copia
     entera encima: si otra pantalla había guardado la marca entretanto, la
     borraba sin avisar. Ahora sólo puede tocar las claves que manda. */
  const updatesFinales = partirSitio(updates, actual.page_json);

  /* La landing se valida contra el catálogo de bloques ANTES de guardarla.

     Hasta ahora `paginas` se guardaba tal cual, y se sostenía porque el único
     que escribía era el editor, que conoce el catálogo. Con Claude escribiendo
     por MCP y con un modo desarrollador eso deja de ser cierto: una página con
     bloques inventados se guardaría bien y reventaría al pintarla, delante del
     público. Ver lib/bloquesLanding.js. */
  if (updatesFinales.paginas !== undefined) {
    const falloBloques = fallaPaginas(updatesFinales.paginas);
    if (falloBloques) return res.status(400).json({ error: falloBloques });
  }

  const { data, error } = await supabase
    .from('eventos')
    .update(updatesFinales)
    .eq('id', req.params.id)
    .select('*, categoria:categorias(slug, nombre)')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  auditar(req, data.id, 'evento.editar', { entidad: 'evento', entidadId: data.id, detalle: { campos: Object.keys(updatesFinales) } });

  /* Subir el aforo libera sitio en TODOS los tipos de boleta a la vez, así que
     hay que recorrerlos: la lista de espera es por tipo. En segundo plano —el
     panel no espera a que salgan los correos. */
  if ('aforo_total' in updates) {
    supabase.from('ticket_types').select('id').eq('evento_id', data.id).eq('activo', true)
      .then(({ data: tipos }) => Promise.all(
        (tipos || []).map(t => ofrecerCupoAlSiguiente({ eventoId: data.id, ticketTypeId: t.id }))
      ))
      .catch(() => {});
  }

  res.json({ evento: conSitio(data) });
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

/* Los tipos de campo y las fichas prearmadas viven en lib/formularioCampos.js,
   que es también quien valida las respuestas. Antes esta lista se mantenía aquí
   y otra igual en el frontend: la misma trampa que tenían los correos, dos
   catálogos que se separan sin que nadie lo note. */

/* El tope, las columnas y el armado de cada fila viven en
   lib/formularioCampos.js: los comparte con el editor de preguntas de
   sub-evento, y dos copias de esto acabarían separándose. */

/* GET /eventos/:id/formulario — campos personalizados del formulario de compra */
router.get('/:id/formulario', sesion('Editar el evento: lo comprueba puedeEditarEvento / owner_id + event_members antes de tocar nada.'), async (req, res) => {
  const permiso = await puedeEditarEvento(req, req.params.id);
  if (!permiso.ok) return res.status(permiso.status).json({ error: permiso.error });

  /* `session_id is null` es lo que separa el formulario del evento de las
     preguntas propias de un sub-evento (migración 0059). Sin este filtro se
     mezclarían las dos cosas en el mismo editor. */
  const { data, error } = await supabase
    .from('event_form_fields')
    .select(COLUMNAS_CAMPO)
    .eq('evento_id', req.params.id)
    .is('session_id', null)
    .order('orden', { ascending: true });
  if (error) {
    /* Sin la 0055 no existen `grupo` ni `ayuda`: se reintenta sin ellas para
       que el formulario siga editándose mientras la migración no esté. */
    const { data: viejo, error: e2 } = await supabase
      .from('event_form_fields')
      .select('id, tipo, etiqueta, opciones, requerido, orden, ticket_type_id')
      .eq('evento_id', req.params.id)
      .order('orden', { ascending: true });
    if (e2) return res.status(500).json({ error: e2.message });
    return res.json({
      campos: viejo || [], tipos: TIPOS_CAMPO, grupos: GRUPOS, fichas: FICHAS, plantilla: PLANTILLA,
      max_campos: MAX_CAMPOS_FORMULARIO, agrupacion_lista: false,
    });
  }
  res.json({
    campos: data || [],
    /* El catálogo viaja con la respuesta: el panel no mantiene su propia copia. */
    tipos: TIPOS_CAMPO,
    /* La plantilla de importacion viaja con el catalogo por el mismo motivo
       que los tipos: si el frontend mantiene su propia copia de las columnas,
       acaban divergiendo y el archivo que se descarga deja de ser el que se
       acepta al subir. */
    plantilla: PLANTILLA,
    grupos: GRUPOS,
    fichas: FICHAS,
    max_campos: MAX_CAMPOS_FORMULARIO,
    agrupacion_lista: true,
  });
});

/* PUT /eventos/:id/formulario — guarda la lista de campos personalizados.
   Body: { campos: [{ id?, tipo, etiqueta, opciones, requerido }, ...] }
   Hace un "diff": campos con `id` existente se ACTUALIZAN in-place
   (conservan su id, así las respuestas ya guardadas en boletas no quedan
   huérfanas); campos sin `id` se INSERTAN; campos que ya no vienen en la
   lista se BORRAN. */
router.put('/:id/formulario', sesion('Editar el evento: lo comprueba puedeEditarEvento / owner_id + event_members antes de tocar nada.'), async (req, res) => {
  const permiso = await puedeEditarEvento(req, req.params.id);
  if (!permiso.ok) return res.status(permiso.status).json({ error: permiso.error });

  const campos = Array.isArray(req.body.campos) ? req.body.campos : [];
  const falloDef = validarDefinicion(campos);
  if (falloDef) return res.status(400).json({ error: falloDef });

  /* OJO: este diff BORRA lo que no venga en el payload. Las preguntas de un
     sub-evento comparten evento_id, así que sin `session_id is null` guardar el
     formulario del evento se las llevaría por delante — el editor del evento no
     las manda porque no las conoce. */
  const { data: existentes, error: eGet } = await supabase
    .from('event_form_fields')
    .select('id')
    .eq('evento_id', req.params.id)
    .is('session_id', null);
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
        .update(filaCampo(c, i))
        .eq('id', c.id);
      if (eUpd) return res.status(500).json({ error: eUpd.message });
    }
  }

  /* 3) Insertar los nuevos (sin id, o con id que ya no existe) */
  const nuevos = campos
    .map((c, i) => ({ ...c, _orden: i }))
    .filter(c => !c.id || !idsExistentes.has(c.id));
  if (nuevos.length > 0) {
    const filas = nuevos.map(c => ({ evento_id: req.params.id, ...filaCampo(c, c._orden) }));
    const { error: eIns } = await supabase.from('event_form_fields').insert(filas);
    if (eIns) return res.status(500).json({ error: eIns.message });
  }

  const { data: final, error: eFinal } = await supabase
    .from('event_form_fields')
    .select(COLUMNAS_CAMPO)
    .eq('evento_id', req.params.id)
    .is('session_id', null)
    .order('orden', { ascending: true });
  if (eFinal) return res.status(500).json({ error: eFinal.message });

  auditar(req, req.params.id, 'evento.formulario.editar', { entidad: 'evento', entidadId: req.params.id, detalle: { total_campos: final.length } });
  res.json({ campos: final });
});

/* DELETE /eventos/:id — soft delete */
router.delete('/:id', sesion('Borrar el evento se reserva al dueño; un miembro del equipo, por mucho permiso que tenga, no lo hace.'), async (req, res) => {
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
router.post('/:id/estado', sesion('Publicar o despublicar exige el permiso `publicar_evento` sobre el rol del miembro, no el de editar.'), async (req, res) => {
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

/* ══════════════════ Padrón de eventos anteriores ══════════════════

   Subir la base de asistentes de ediciones pasadas para que el formulario se
   rellene solo al escribir la cédula. Ver la migración 0085 para por qué es
   una tabla aparte y por qué se guarda el hash y no el documento.

   Esta ruta es PRIVADA (pide permiso de edición). La que consulta es pública y
   vive en eventos.publicos.js, con limitador. */

/* POST /eventos/:id/padron
   Body: { filas: [ { documento, ...datos } ], origen? }
   Devuelve cuántas entraron y qué columnas del archivo no pregunta nadie. */
router.post('/:id/padron', exige(PERMS_PADRON), async (req, res) => {
  const permiso = await puedeEditarEvento(req, req.params.id);
  if (!permiso.ok) return res.status(permiso.status).json({ error: permiso.error });

  const filas = Array.isArray(req.body?.filas) ? req.body.filas : [];
  if (!filas.length) return res.status(400).json({ error: 'No llegó ninguna fila.' });
  if (filas.length > 20000) return res.status(400).json({ error: 'Máximo 20.000 filas por carga.' });

  const eventoId = req.params.id;
  const columnas = new Set();
  const preparadas = [];
  let sinDocumento = 0;

  for (const f of filas) {
    if (!f || typeof f !== 'object') continue;
    /* La columna del documento se acepta con varios nombres porque el archivo
       viene de fuera y cada organizador la llama distinto. */
    const doc = extraerDocumento(f);
    const hash = hashDocumento(eventoId, doc);
    if (!hash) { sinDocumento++; continue; }

    /* El documento NO se guarda, ni siquiera dentro de `datos`: si quedara ahí
       se habría hecho el hash para nada. */
    const datos = {};
    for (const [k, v] of Object.entries(f)) {
      const ck = clavePadron(k);
      if (ALIAS_DOCUMENTO.includes(ck)) continue;
      if (v === undefined || v === null || v === '') continue;
      datos[k] = typeof v === 'string' ? v.trim() : v;
      columnas.add(k);
    }
    preparadas.push({ evento_id: eventoId, documento_hash: hash, datos, origen: req.body?.origen || null });
  }

  if (!preparadas.length) {
    return res.status(400).json({ error: 'Ninguna fila traía un documento reconocible. La columna puede llamarse documento, cédula, identificación, NIT o DNI.' });
  }

  /* En tandas: 20.000 filas en un solo upsert revienta el límite del cliente.
     `onConflict` para que volver a subir el padrón actualice en vez de
     duplicar — subirlo dos veces es lo normal, no la excepción. */
  const TANDA = 500;
  let guardadas = 0;
  for (let i = 0; i < preparadas.length; i += TANDA) {
    const { error } = await supabase
      .from('padron_previo')
      .upsert(preparadas.slice(i, i + TANDA), { onConflict: 'evento_id,documento_hash' });
    if (error) {
      if (/relation .*padron_previo.* does not exist/i.test(error.message || '')) {
        return res.status(503).json({ error: 'Falta aplicar la migración 0085 para poder guardar el padrón.' });
      }
      return res.status(500).json({ error: error.message });
    }
    guardadas += Math.min(TANDA, preparadas.length - i);
  }

  /* Qué trae el archivo que ninguna pregunta recoge. Es la mitad útil del
     aviso: «para aprovechar esta columna, te falta esta pregunta». */
  const { data: campos } = await supabase
    .from('event_form_fields').select('id, etiqueta')
    .eq('evento_id', eventoId).is('session_id', null);
  const listaCampos = campos || [];
  const listaColumnas = [...columnas];

  /* Las columnas del archivo se guardan en el evento para que la pantalla de
     mapeo pueda ofrecerlas sin obligar a subir el archivo otra vez, y para
     poder validar el mapeo contra ellas. Van en `page_json.padron`: el PATCH
     mezcla `page_json` por clave de primer nivel (0064), así que esto no toca
     nada más de la landing. */
  const { data: evActual } = await supabase
    .from('eventos').select('page_json').eq('id', eventoId).maybeSingle();
  const pjActual = evActual?.page_json && typeof evActual.page_json === 'object' ? evActual.page_json : {};
  const padronAntes = pjActual.padron && typeof pjActual.padron === 'object' ? pjActual.padron : {};

  /* El mapeo que hubiera: se conserva el del organizador para las preguntas
     que siga habiendo, y se rellena el resto con lo que el cruce por nombre
     ya daría. Así reemplazar el archivo no borra el trabajo hecho. */
  const mapeoPrevio = limpiarMapeo(padronAntes.mapeo, listaCampos, listaColumnas);
  const mapeo = { ...mapeoSugerido(listaCampos, listaColumnas), ...mapeoPrevio };

  await supabase.from('eventos').update({
    page_json: {
      ...pjActual,
      padron: {
        ...padronAntes,
        columnas: listaColumnas,
        mapeo,
        origen: req.body?.origen || null,
        filas: guardadas,
        subido_at: new Date().toISOString(),
      },
    },
  }).eq('id', eventoId);

  /* Cuántas filas no llenarían NI UNA pregunta. Es el número que faltaba: sin
     él, un padrón que no sirve se ve igual que uno bueno. En el caso que lo
     destapó, 3.624 de 4.124 filas traían sólo nombre y apellidos. */
  const sinCruce = filasSinCruce(preparadas.map(r => r.datos), listaCampos, mapeo);

  res.json({
    guardadas,
    sin_documento: sinDocumento,
    sin_cruce: sinCruce,
    columnas: listaColumnas,
    mapeo,
    columnas_sin_pregunta: columnasSinPregunta(listaColumnas, listaCampos),
  });
});

/* PUT /eventos/:id/padron/mapeo — qué columna del archivo llena cada pregunta.
 *
 * Existe para no obligar a nadie a una plantilla. El cruce por defecto va por
 * el TEXTO del encabezado contra el enunciado de la pregunta, y eso falla en
 * cuanto el archivo viene de otro sistema: «ciudad» no es «Ciudad de
 * residencia». Con esto el organizador conecta sus columnas una vez y sube el
 * archivo como lo tenga.
 *
 * Se guarda por **id** de pregunta, no por etiqueta: así renombrar una
 * pregunta no rompe el padrón. Antes sí lo rompía, y en silencio. */
router.put('/:id/padron/mapeo', exige(PERMS_PADRON), async (req, res) => {
  const permiso = await puedeEditarEvento(req, req.params.id);
  if (!permiso.ok) return res.status(permiso.status).json({ error: permiso.error });

  const eventoId = req.params.id;
  const entrante = req.body?.mapeo;
  if (!entrante || typeof entrante !== 'object' || Array.isArray(entrante)) {
    return res.status(400).json({ error: 'Falta el mapeo.' });
  }

  const { data: ev } = await supabase
    .from('eventos').select('page_json').eq('id', eventoId).maybeSingle();
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  const pj = ev.page_json && typeof ev.page_json === 'object' ? ev.page_json : {};
  const padronAntes = pj.padron && typeof pj.padron === 'object' ? pj.padron : {};

  const { data: campos } = await supabase
    .from('event_form_fields').select('id, etiqueta')
    .eq('evento_id', eventoId).is('session_id', null);

  const mapeo = limpiarMapeo(entrante, campos || [], padronAntes.columnas || []);

  const { error } = await supabase.from('eventos')
    .update({ page_json: { ...pj, padron: { ...padronAntes, mapeo } } })
    .eq('id', eventoId);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ mapeo });
});

/* DELETE /eventos/:id/padron — borra el padrón de este evento. */
router.delete('/:id/padron', exige(PERMS_PADRON), async (req, res) => {
  const permiso = await puedeEditarEvento(req, req.params.id);
  if (!permiso.ok) return res.status(permiso.status).json({ error: permiso.error });
  const { error } = await supabase.from('padron_previo').delete().eq('evento_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* GET /eventos/:id/padron/estado — cuántas filas hay, para la pantalla. */
router.get('/:id/padron/estado', exige(PERMS_PADRON), async (req, res) => {
  const permiso = await puedeEditarEvento(req, req.params.id);
  if (!permiso.ok) return res.status(permiso.status).json({ error: permiso.error });
  const { count, error } = await supabase
    .from('padron_previo').select('id', { count: 'exact', head: true })
    .eq('evento_id', req.params.id);
  if (error) return res.json({ filas: 0, disponible: false });

  /* Las columnas del último archivo y el mapeo actual, para que la pantalla de
     mapeo se pueda abrir sin volver a subir nada. Sin esto, corregir una sola
     columna obligaría a re-subir el archivo entero. */
  const { data: ev } = await supabase
    .from('eventos').select('page_json->padron').eq('id', req.params.id).maybeSingle();
  const cfg = ev?.padron ?? ev?.page_json?.padron ?? {};
  const { data: campos } = await supabase
    .from('event_form_fields').select('id, etiqueta')
    .eq('evento_id', req.params.id).is('session_id', null).order('orden', { ascending: true });
  const listaCampos = campos || [];
  const columnas = Array.isArray(cfg.columnas) ? cfg.columnas : [];

  res.json({
    filas: count || 0,
    disponible: true,
    columnas,
    /* Se devuelve el mapeo COMPLETO —lo guardado más lo que el cruce por
       nombre daría para lo que nadie tocó—, así la pantalla enseña de una lo
       que va a pasar de verdad y no una tabla a medio llenar. */
    mapeo: { ...mapeoSugerido(listaCampos, columnas), ...limpiarMapeo(cfg.mapeo, listaCampos, columnas) },
    preguntas: listaCampos,
    origen: cfg.origen || null,
    subido_at: cfg.subido_at || null,
  });
});

module.exports = router;
