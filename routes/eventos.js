const express = require('express');
const supabase = require('../lib/supabase.js');
const { avisosDePublicacion } = require('../lib/avisosDePublicacion.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { slugify, uniqueEventoSlug } = require('../lib/slug.js');
const { otorgarBadge } = require('../lib/gamificacion.js');
const { auditar } = require('../lib/auditar.js');
const { leerCampos, guardarCampos, catalogoDeFormulario } = require('../lib/guardarCampos.js');
const { tramoPedido, datosDelTramo, filtrarPorTexto } = require('../lib/tramoDeLista.js');
const { LLAVES_ESTRECHAS, llavesDePageJson, recortarPageJson } = require('../lib/quePuedeEditar.js');
const { esUrlImagenSegura, esUrlWebSegura } = require('../lib/urls.js');
const { dispatch } = require('../lib/webhooks.js');
const { assertPermiso } = require('../lib/acceso.js');
const { ofrecerCupoAlSiguiente } = require('../lib/waitlistOferta.js');
const { conSitio, listaConSitio, partirSitio } = require('../lib/eventoSitio.js');
const { hashDocumento, columnasSinPregunta, clave: clavePadron, ALIAS_DOCUMENTO, extraerDocumento,
  limpiarMapeo, mapeoSugerido, filasSinCruce } = require('../lib/padronPrevio.js');
const { exige, sesion, permisosDeMiembro, SELECT_PERMISOS } = require('../core/permisos');
const { sincronizarZonas, sincronizarPuertas, conZonas } = require('../lib/zonasTabla.js');
const { topeValido, TOPE_MAX } = require('../lib/ajustesRueda.js');
const { fallaPaginas } = require('../lib/bloquesLanding.js');

/* El padrón es parte de configurar el formulario del evento, así que pide lo
   mismo que editarlo. Se declara para el censo de la fase 7 en vez de dejarlo
   pendiente: son rutas nuevas y arreglarlo hoy es barato. */
/* El padrón se carga con su propio permiso. Seguía pidiendo `editar_evento`
   —y sólo eso—, así que para dejar que alguien subiera la lista de invitados
   había que darle el evento entero. `editar_evento` se queda para que nadie
   pierda lo que ya hacía. */
const PERMS_PADRON = ['gestionar_padron', 'editar_evento'];
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
  /* Cómo se agenda la rueda de negocios (0104): `auto` confirma al reservar,
     `solicitud` deja la cita pendiente de aprobación. Sin esta línea el
     selector del panel guardaría en el vacío — la ruta descarta en silencio
     lo que no está en esta lista, que es lo correcto y por eso hay que
     acordarse de venir aquí al añadir una columna. */
  'networking_modo',
  /* Si el evento TIENE rueda, y cuántas citas puede tener una misma empresa
     (0113). Lo primero lo decidía la categoría del evento y por eso una rueda
     de agroindustria —categoría que ni existe en el catálogo— no se podía
     montar; ahora lo decide quien organiza. */
  'networking_activo', 'networking_tope_por_empresa',
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
  const { q, estado, modalidad } = req.query;
  /* La octava lista con el mismo saneado a mano, y esta ni siquiera lo tenia:
     `(Number(page) - 1) * Number(limit)` con `page=abc` da `NaN`, y eso no
     da error: devuelve la lista VACIA. Un parametro raro en la URL le decia a
     alguien que no tenia eventos.
     Y sin tope: un `limit=100000` se traia todo. Se conserva el 20 por
     defecto para no cambiarle la respuesta a nadie; el tope de 200 esta por
     encima de lo que pide el que mas pide (100, el hub de mensajes). */
  const tramo = tramoPedido(req.query, { porDefecto: 20, tope: 200 });

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
    .range(tramo.desde, tramo.hasta);

  /* Por palabras, como las demas listas: «summit tech» encuentra «TechNova
     Summit» aunque no este escrito en ese orden. */
  query = filtrarPorTexto(query, q, ['titulo']);
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

  res.json({ eventos, ...datosDelTramo(tramo, count) });
});

/* GET /eventos/:id — evento del owner O de un miembro activo */
router.get('/:id', sesion('Lee un evento del panel: el dueño siempre, y un miembro activo del equipo. Se comprueba dentro contra owner_id y event_members.'), async (req, res) => {
  const { data, error } = await supabase
    .from('eventos')
    /* `ticket_types` tambien: el panel decide con ellos si avisar de que el
       evento no puede vender. Sin esta linea, `evento.ticket_types` llegaba
       SIEMPRE indefinido y el aviso «este evento todavia no tiene tipos de
       boleta» salia en todos los eventos, tuvieran cuatro o ninguno. Un
       consejero que siempre miente enseña a ignorar los que si aciertan. */
    .select('*, categoria:categorias(slug, nombre), ticket_types(id, nombre, precio, activo, cupo)')
    .eq('id', req.params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Evento no encontrado.' });

  /* Las zonas viajan dentro del evento aunque ya no vivan en `page_json`
     (0092): el panel las busca ahí en cuatro pantallas. */
  const conTodo = await conZonas(data);

  if (String(data.owner_id) === String(req.user.id)) {
    return res.json({ evento: conSitio(conTodo), soyOwner: true, permisos: ['*'] });
  }

  const { data: m } = await supabase
    .from('event_members')
    /* `rol_id` además del `rol` de texto: las puertas se pueden asignar a un
       rol entero —«quien esté en puerta»— y el escáner necesita el id para
       saber cuáles son las suyas. El `rol` de texto es el heredado y no sirve
       para cruzar. */
    .select(`${SELECT_PERMISOS}, rol, rol_id`)
    .eq('evento_id', data.id)
    .eq('user_id', req.user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (!m) return res.status(404).json({ error: 'Evento no encontrado.' });

  const permisos = [...permisosDeMiembro(m)];

  /* Los documentos del evento —contratos, riders— salen del payload si este
     miembro no puede verlos.
   *
     Esconder la pestaña en el panel y seguir mandando la lista sería teatro:
     está en la misma respuesta que ya se abre en cualquier pantalla del
     evento. Se quita aquí, que es donde se decide. */
  const evento = conSitio(conTodo);
  if (!permisos.includes('ver_documentos') && evento.page_json?.documentos) {
    evento.page_json = { ...evento.page_json };
    delete evento.page_json.documentos;
  }
  /* El nombre ACTUAL del rol, y el de texto sólo si no hay fila: la columna
     heredada se quedó con el nombre viejo tras el renombrado de la 0090. */
  res.json({
    evento, soyOwner: false,
    mi_rol: m.rol_detail?.nombre || m.rol,
    mi_rol_id: m.rol_id || null, permisos,
  });
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
  /* Los permisos del miembro, para el recorte de `page_json` de más abajo. El
     dueño llega aquí con `null` y eso significa «todas las claves». */
  let permisosDelMiembro = null;
  if (actual.owner_id !== req.user.id) {
    const { data: m } = await supabase
      .from('event_members')
      .select(SELECT_PERMISOS)
      .eq('evento_id', actual.id).eq('user_id', req.user.id).eq('status', 'active')
      .maybeSingle();
    if (!m) return res.status(403).json({ error: 'No autorizado.' });

    const perms = permisosDeMiembro(m);
    permisosDelMiembro = perms;
    camposPermitidos = new Set();
    const llavesEstrechas = new Set(
      Object.entries(LLAVES_ESTRECHAS)
        .filter(([permiso]) => perms.has(permiso))
        .flatMap(([, suyas]) => suyas));
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
    /* Las puertas del evento viven dentro de `page_json`, pero configurarlas no
       es editar la página pública: es logística. Con `gestionar_accesos` se
       abre `page_json` y se recorta a esa única clave más abajo — abrirlo
       entero dejaría a quien monta puertas reescribiendo la landing. */
    /* Los permisos estrechos abren la COLUMNA `page_json`; qué claves de dentro
       pueden tocar lo decide `lib/quePuedeEditar.js`, que es donde está escrito
       cuál abre cuál. Aquí sólo se decide la columna. */
    if (llavesEstrechas.size) camposPermitidos.add('page_json');
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

  /* El tope de citas de la rueda se valida aquí y no sólo con el CHECK: la
     base contestaría «violates check constraint eventos_networking_tope_chk»,
     que es lo que acabaría viendo quien escribió «cinco» en la casilla. */
  if ('networking_tope_por_empresa' in updates) {
    const n = topeValido(updates.networking_tope_por_empresa);
    if (n === undefined) {
      return res.status(400).json({ error: `El tope de citas tiene que ser un número entre 1 y ${TOPE_MAX}. Déjalo vacío para no poner tope.` });
    }
    updates.networking_tope_por_empresa = n;
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
  /* Y el recorte: quien entra por `gestionar_accesos` y NO puede editar la
     página sólo escribe `accesos`. Va justo antes de mezclar, cuando ya se sabe
     qué mandó, y no en la lista de campos: allí sólo se decide QUÉ columna, no
     qué parte de ella.

     `partirSitio` mezcla por clave, así que quitar las demás de aquí basta:
     lo que no se manda no se toca. */
  if (updates.page_json && typeof updates.page_json === 'object') {
    const llaves = llavesDePageJson(permisosDelMiembro);
    const r = recortarPageJson(updates.page_json, llaves);
    if (r.error) return res.status(403).json({ error: r.error });
    updates.page_json = r.page_json;
  }

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

  /* Las zonas se guardan en las DOS mientras dure la mudanza (0091 → 0093).
     Va DESPUES del update y sin `await` bloqueante sobre el resultado: el
     evento ya quedó guardado, y `sincronizarZonas` no lanza — si fallara, lo
     que hay en `page_json` sigue siendo correcto y la lectura cae ahí sola.
     Sólo cuando la peticion trae zonas: el PATCH mezcla por clave, así que
     guardar el SEO no debe tocar el plano. */
  if (!error && updatesFinales.page_json && 'zonas' in updatesFinales.page_json) {
    await sincronizarZonas(req.params.id, updatesFinales.page_json.zonas);
  }
  /* Y las puertas, que desde la 0096 también son zonas —de tipo ingreso—.
     Mismo trato y por la misma razón: el JSON sigue siendo el dueño de las
     reglas de la puerta (qué boletas admite, qué staff la atiende) y la fila de
     `zonas` es el espejo que la pone en el mapa del recinto. */
  if (!error && updatesFinales.page_json && 'accesos' in updatesFinales.page_json) {
    await sincronizarPuertas(req.params.id, updatesFinales.page_json.accesos);
  }
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

  /* `session_id is null` y `torneo_id is null` son lo que separa el formulario
     del evento de las preguntas de un sub-evento (0059) y de un torneo (0095).
     El filtro y sus reintentos viven en lib/guardarCampos.js, junto al borrado
     que usa exactamente el mismo — que es lo que impide que un dia se filtre la
     lectura y se olvide el borrado. */
  const { campos, completo, error } = await leerCampos(req.params.id, {});
  if (error) return res.status(500).json({ error: error.message });

  res.json({
    campos,
    /* El catalogo viaja con la respuesta: el panel no mantiene su propia copia. */
    ...catalogoDeFormulario(),
    /* Sin la 0055 no hay `grupo` ni `ayuda`: el editor abre igual, pero se le
       dice que no ofrezca lo que no se va a guardar. */
    agrupacion_lista: completo,
  });
});

/* PUT /eventos/:id/formulario — guarda la lista de campos personalizados.
   Body: { campos: [{ id?, tipo, etiqueta, opciones, requerido }, ...] }

   OJO: guardar BORRA lo que no venga en el payload, y en esta tabla viven
   tambien las preguntas de sub-eventos y torneos, que esta pantalla no conoce
   ni manda. Lo que las protege es el alcance —aqui, «las que no son de nadie
   mas»—, y por eso el borrado y la lectura salen del mismo sitio. */
router.put('/:id/formulario', sesion('Editar el evento: lo comprueba puedeEditarEvento / owner_id + event_members antes de tocar nada.'), async (req, res) => {
  const permiso = await puedeEditarEvento(req, req.params.id);
  if (!permiso.ok) return res.status(permiso.status).json({ error: permiso.error });

  const r = await guardarCampos({ eventoId: req.params.id, alcance: {}, campos: req.body.campos });
  if (r.error) return res.status(r.estado || 500).json({ error: r.error });

  auditar(req, req.params.id, 'evento.formulario.editar', { entidad: 'evento', entidadId: req.params.id, detalle: { total_campos: r.campos.length } });
  res.json({ campos: r.campos });
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

  /* Qué le falta a lo que se acaba de publicar.
   *
   * Publicar sólo comprobaba el PERMISO. Se puede publicar un evento sin una
   * sola forma de inscribirse, y entonces alguien llega a la página, la lee
   * entera y no encuentra qué pulsar. Está pasando ahora mismo con un evento
   * real, publicado y sin tipos de boleta activos.
   *
   * No se BLOQUEA la publicación: hay motivos legítimos para publicar antes de
   * abrir inscripciones —una página de aviso, un evento con registro por
   * fuera—, y decidirlo por el organizador sería pasarse. Se avisa, que es lo
   * que faltaba: el panel lo enseña al volver, y quien publique por la API o
   * por el agente se entera igual, que antes no.
   *
   * Va después de escribir el estado: un fallo contando lo que falta no puede
   * impedir una publicación que ya se autorizó. */
  /* Qué le falta a lo que se acaba de publicar.
   *
   * Publicar sólo comprobaba el PERMISO. Se puede publicar un evento sin una
   * sola forma de inscribirse, y entonces alguien llega a la página, la lee
   * entera y no encuentra qué pulsar.
   *
   * No se BLOQUEA: hay motivos legítimos para publicar antes de abrir
   * inscripciones. Se avisa, que es lo que faltaba.
   *
   * El cálculo vive en `lib/avisosDePublicacion.js` y no aquí porque hay DOS
   * caminos para publicar —éste y la herramienta del agente— y el segundo hacía
   * su propio `update`: publicaba sin un solo aviso. */
  let avisos = [];
  if (estado === 'publicado') {
    avisos = await avisosDePublicacion(req.params.id, data);
    dispatch(req.user.id, 'evento.publicado', { evento_id: data.id, titulo: data.titulo, slug: data.slug });
  }

  res.json({ evento: data, avisos });
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
