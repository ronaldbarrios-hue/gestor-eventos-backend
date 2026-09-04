/* ══════════════════════════════════════════════════════════════════
   GESTEK — "Explorar vacantes disponibles" (bolsa de empleo de eventos)

   Mercado de dos lados:
   · CANDIDATO  → /me/talento (perfil CV), /vacantes (explorar), /me/postulaciones
   · ORGANIZADOR→ /eventos/:id/vacantes (publicar), pipeline, contratar→equipo

   GESTEK conecta; NO procesa el sueldo. La única plata que toca la
   plataforma es su comisión (COMISION_PCT del contrato) y los destacados.

   Montado en '/' con verifySupabaseJWT global. Backend usa service_role
   (las tablas tienen RLS activo sin políticas).
   ════════════════════════════════════════════════════════════════════ */
const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT, verifySupabaseJWTOptional } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');
const { notificar } = require('../lib/notificar.js');

const { exige, sesion, publica } = require('../core/permisos');
const { baseFrontend } = require('../lib/frontend.js');
const router = express.Router();

/* ══════════════════════════════════════════════════════════════════
   LECTURAS PÚBLICAS — van ANTES del verifySupabaseJWT global.

   Una bolsa de empleo que exige registrarse para MIRAR no la encuentra
   nadie, y el sentido de este módulo es que el organizador consiga
   personal y la persona consiga trabajo. Así que el listado, el
   catálogo de roles y el detalle de una vacante se leen sin sesión.

   Qué se expone: solo vacantes en estado 'abierta' de eventos ya
   'publicado'. Es lo mismo que muestra cualquier portal de empleo.
   Qué NO cambia: postularse, ver el pipeline, contratar y todo lo del
   organizador siguen exigiendo sesión, más abajo en este archivo.

   Se usa verifySupabaseJWTOptional (no bloquea sin token) para que un
   usuario con sesión siga viendo sus roles propios y si ya se postuló.
   ══════════════════════════════════════════════════════════════════ */

const SEL_VACANTE = `id, evento_id, titulo, descripcion, rol_id, rol_texto, requisitos, preguntas,
  pago_monto, pago_moneda, pago_periodo, comision_pct, ciudad, modalidad, fecha_inicio, fecha_fin,
  cupos, estado, destacada_hasta, created_at,
  evento:eventos!evento_id(id, titulo, slug, cover_url, estado, location_nombre),
  rol:catalogo_roles!rol_id(id, nombre, slug)`;

const MODALIDADES_PUB = ['presencial', 'remoto', 'hibrido'];

/* Catálogo de roles. Sin sesión devuelve solo los globales; con sesión
   añade los que el organizador creó para sí mismo.
   OJO: debe declararse ANTES que /vacantes/:id o ':id' se traga "roles". */
router.get('/vacantes/roles', verifySupabaseJWTOptional, publica('Bolsa de empleo abierta: una que exige registrarse para MIRAR no la encuentra nadie. Sólo se exponen vacantes abiertas de eventos publicados.'), async (req, res) => {
  let query = supabase
    .from('catalogo_roles').select('id, nombre, slug, global, owner_id');
  query = req.user
    ? query.or(`global.eq.true,owner_id.eq.${req.user.id}`)
    : query.eq('global', true);
  const { data, error } = await query
    .order('orden', { ascending: true }).order('nombre', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ roles: data || [] });
});

/* Listado abierto. */
router.get('/vacantes', verifySupabaseJWTOptional, publica('Bolsa de empleo abierta: una que exige registrarse para MIRAR no la encuentra nadie. Sólo se exponen vacantes abiertas de eventos publicados.'), async (req, res) => {
  const { ciudad, rol_id, modalidad, pago_min, q } = req.query;
  let query = supabase.from('vacantes').select(SEL_VACANTE).eq('estado', 'abierta');
  if (ciudad)    query = query.ilike('ciudad', `%${ciudad}%`);
  if (rol_id)    query = query.eq('rol_id', rol_id);
  if (modalidad && MODALIDADES_PUB.includes(modalidad)) query = query.eq('modalidad', modalidad);
  if (pago_min)  query = query.gte('pago_monto', Number(pago_min) || 0);
  if (q)         query = query.or(`titulo.ilike.%${q}%,descripcion.ilike.%${q}%`);
  query = query.order('destacada_hasta', { ascending: false, nullsFirst: false })
               .order('created_at', { ascending: false }).limit(100);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const ahora = Date.now();
  const vacantes = (data || [])
    .filter(v => v.evento?.estado === 'publicado')   // solo eventos publicados
    .map(v => ({ ...v, destacada: v.destacada_hasta && new Date(v.destacada_hasta).getTime() > ahora }));
  res.json({ vacantes });
});

/* Detalle. `mi_postulacion` solo tiene sentido con sesión. */
router.get('/vacantes/:id', verifySupabaseJWTOptional, publica('Bolsa de empleo abierta: una que exige registrarse para MIRAR no la encuentra nadie. Sólo se exponen vacantes abiertas de eventos publicados.'), async (req, res) => {
  const { data, error } = await supabase.from('vacantes').select(SEL_VACANTE).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Vacante no encontrada.' });
  if (data.estado !== 'abierta' || data.evento?.estado !== 'publicado') {
    /* Sin sesión no se muestran vacantes cerradas ni de eventos en borrador:
       el organizador sí las ve desde su panel, que va autenticado. */
    if (!req.user) return res.status(404).json({ error: 'Vacante no encontrada.' });
  }
  let miPostulacion = null;
  if (req.user) {
    const { data: yaPostule } = await supabase
      .from('postulaciones').select('id, etapa')
      .eq('vacante_id', req.params.id).eq('user_id', req.user.id).maybeSingle();
    miPostulacion = yaPostule || null;
  }
  res.json({ vacante: data, mi_postulacion: miPostulacion });
});

/* ══ A partir de aquí TODO exige sesión ══ */
router.use(verifySupabaseJWT);

/* La misma lista que ya comprueban los assertPermiso de abajo. */
const PERMS_VACANTES = ['editar_evento'];

const ETAPAS = ['postulado', 'revisado', 'entrevista', 'oferta', 'aceptado', 'rechazado'];
const MODALIDADES = ['presencial', 'remoto', 'hibrido'];

/* Notificar sin romper la petición si el helper falla. */
function avisar(payload) {
  try { const p = notificar(payload); if (p?.catch) p.catch(() => {}); }
  catch { /* noop */ }
}

const slugify = (s) => {
  const base = (s || '').toString().toLowerCase().trim().normalize('NFD');
  let out = '';
  for (const c of base) { const n = c.charCodeAt(0); if (n < 0x300 || n > 0x36f) out += c; }  // quita diacríticos
  return out.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48) || 'rol';
};

/* ═══════════════════════ PERFIL DE TALENTO (candidato) ═══════════════════════ */

router.get('/me/talento', sesion("Su perfil de talento: lo edita sólo su dueño."), async (req, res) => {
  const { data, error } = await supabase
    .from('perfil_talento').select('*').eq('user_id', req.user.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ perfil: data || null });
});

/* Sin ciudad/telefono/foto_url a propósito: son de la PERSONA, no de esta
   faceta, y viven en `profiles` (0081_perfil_talento_sin_datos_de_persona).
   Se editan en Ajustes → Mi Perfil; aquí sólo se leen, heredados. */
const CAMPOS_PERFIL = ['titular', 'bio', 'habilidades', 'experiencia', 'disponibilidad',
  'pais', 'portfolio_url', 'redes', 'cv_url', 'cv_nombre'];

router.put('/me/talento', sesion("Su perfil de talento: lo edita sólo su dueño."), async (req, res) => {
  const fila = { user_id: req.user.id, updated_at: new Date().toISOString() };
  for (const k of CAMPOS_PERFIL) if (req.body?.[k] !== undefined) fila[k] = req.body[k];
  const { data, error } = await supabase
    .from('perfil_talento').upsert(fila, { onConflict: 'user_id' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ perfil: data });
});

router.post('/me/talento/publicar', sesion("Su perfil de talento: lo edita sólo su dueño."), async (req, res) => {
  const publicado = req.body?.publicado !== false;
  const { data, error } = await supabase
    .from('perfil_talento').update({ publicado, updated_at: new Date().toISOString() })
    .eq('user_id', req.user.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(400).json({ error: 'Primero crea tu perfil de talento.' });
  res.json({ perfil: data });
});

/* Verificación de identidad (identidad + rostro). STUB v1: marca 'pendiente'.
   La integración con el proveedor KYC (p.ej. Truora) llega en un paso posterior;
   el webhook /webhooks/kyc confirmará 'verificado'. */
router.post('/me/talento/verificacion', sesion("Su perfil de talento: lo edita sólo su dueño."), async (req, res) => {
  const { data: existe } = await supabase.from('perfil_talento').select('user_id').eq('user_id', req.user.id).maybeSingle();
  if (!existe) return res.status(400).json({ error: 'Primero crea tu perfil de talento.' });

  const apiKey = process.env.TRUORA_API_KEY;
  if (!apiKey) {
    /* Sin proveedor configurado todavía: queda en 'pendiente' (stub). */
    const { data } = await supabase.from('perfil_talento')
      .update({ verificacion_estado: 'pendiente', updated_at: new Date().toISOString() })
      .eq('user_id', req.user.id).select().maybeSingle();
    return res.json({ perfil: data, pendiente: true, mensaje: 'Verificación en configuración — el proveedor KYC se activará pronto.' });
  }
  try {
    const { crearValidacion } = require('../lib/truora.js');
    const front = baseFrontend();
    const v = await crearValidacion({ apiKey, type: 'face-recognition', accountId: req.user.id, redirectUrl: `${front}/vacantes` });
    const { data } = await supabase.from('perfil_talento')
      .update({ verificacion_estado: 'pendiente', verificacion_ref: v.validationId, updated_at: new Date().toISOString() })
      .eq('user_id', req.user.id).select().maybeSingle();
    return res.json({ perfil: data, pendiente: true, url: v.url, mensaje: 'Completa la verificación en la ventana que se abre.' });
  } catch (e) {
    return res.status(502).json({ error: `No se pudo iniciar la verificación: ${e.message}` });
  }
});

/* ═══════════════════════ CATÁLOGO DE ROLES ═══════════════════════ */

router.post('/vacantes/roles', sesion("Crea un rol de catálogo propio, anotado con su owner_id."), async (req, res) => {
  const nombre = (req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre del rol es requerido.' });
  const { data, error } = await supabase
    .from('catalogo_roles').insert({ nombre, slug: slugify(nombre), global: false, owner_id: req.user.id })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ rol: data });
});

/* ═══════════════════════ EXPLORAR (candidato) ═══════════════════════ */

router.post('/vacantes/:id/postular', sesion("Se postula uno mismo: la postulación se firma con req.user.id y no se puede postular a otro."), async (req, res) => {
  const { id } = req.params;
  try {
    const { data: perfil } = await supabase.from('perfil_talento').select('*').eq('user_id', req.user.id).maybeSingle();
    if (!perfil) return res.status(400).json({ error: 'Primero crea tu perfil de talento en Mi Espacio.' });

    const { data: vac } = await supabase.from('vacantes')
      .select('id, titulo, estado, owner_id, evento_id').eq('id', id).maybeSingle();
    if (!vac) return res.status(404).json({ error: 'Vacante no encontrada.' });
    if (vac.estado !== 'abierta') return res.status(400).json({ error: 'Esta vacante ya no recibe postulaciones.' });

    /* ciudad y foto_url ya no viven en perfil_talento (son de la persona,
       no de esta faceta): se congelan desde profiles, que es donde se editan. */
    const { data: prof } = await supabase.from('profiles').select('ciudad, avatar_url').eq('id', req.user.id).maybeSingle();
    const snapshot = {
      titular: perfil.titular, bio: perfil.bio, habilidades: perfil.habilidades,
      experiencia: perfil.experiencia, disponibilidad: perfil.disponibilidad,
      ciudad: prof?.ciudad || null, foto_url: prof?.avatar_url || null, portfolio_url: perfil.portfolio_url,
      cv_url: perfil.cv_url, cv_nombre: perfil.cv_nombre,
      verificacion_estado: perfil.verificacion_estado,
    };
    const { data, error } = await supabase.from('postulaciones').insert({
      vacante_id: id, user_id: req.user.id, perfil_snapshot: snapshot,
      respuestas: req.body?.respuestas || {}, mensaje: req.body?.mensaje || null,
    }).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ya te postulaste a esta vacante.' });
      return res.status(500).json({ error: error.message });
    }
    if (vac.owner_id) avisar({ userId: vac.owner_id, tipo: 'vacante', titulo: 'Nueva postulación',
      cuerpo: `Alguien se postuló a "${vac.titulo}".`, /* Sección Y pestaña. Antes el enlace nombraba sólo «vacantes», que
           nunca fue una sección —siempre fue una pestaña—, así que el aviso de
           que alguien se postuló **no ha llevado nunca a las vacantes**: dejaba
           al organizador en el Resumen sin decirle por qué.
           El ejemplo malo no se escribe aquí literal a propósito: la prueba que
           vigila esto lee el archivo entero y lo tomaría por un enlace de
           verdad. */
        link: `/eventos/${vac.evento_id}?s=equipo&t=vacantes`, eventoId: vac.evento_id });
    res.status(201).json({ postulacion: data });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/me/postulaciones', sesion("A qué vacantes se presentó esta persona."), async (req, res) => {
  const { data, error } = await supabase.from('postulaciones')
    .select(`id, etapa, mensaje, entrevista, monto_contrato, created_at,
      vacante:vacantes!vacante_id(id, titulo, pago_monto, pago_moneda, estado,
        evento:eventos!evento_id(id, titulo, slug, cover_url))`)
    .eq('user_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ postulaciones: data || [] });
});

router.delete('/me/postulaciones/:id', sesion("A qué vacantes se presentó esta persona."), async (req, res) => {
  const { data: p } = await supabase.from('postulaciones').select('id, etapa, user_id').eq('id', req.params.id).maybeSingle();
  if (!p || p.user_id !== req.user.id) return res.status(404).json({ error: 'Postulación no encontrada.' });
  if (p.etapa === 'aceptado') return res.status(400).json({ error: 'No puedes retirar una postulación ya aceptada.' });
  const { error } = await supabase.from('postulaciones').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* Reseña del candidato hacia el organizador (pública en la cuenta organizadora). */
router.post('/me/postulaciones/:id/resena', sesion("A qué vacantes se presentó esta persona."), async (req, res) => {
  const estrellas = Number(req.body?.estrellas);
  if (!(estrellas >= 1 && estrellas <= 5)) return res.status(400).json({ error: 'Estrellas entre 1 y 5.' });
  const { data: p } = await supabase.from('postulaciones')
    .select('id, user_id, etapa, vacante:vacantes!vacante_id(id, evento_id, owner_id)').eq('id', req.params.id).maybeSingle();
  if (!p || p.user_id !== req.user.id) return res.status(404).json({ error: 'Postulación no encontrada.' });
  if (p.etapa !== 'aceptado') return res.status(400).json({ error: 'Solo puedes reseñar tras ser contratado.' });
  const { data, error } = await supabase.from('talento_resenas').insert({
    evento_id: p.vacante?.evento_id, vacante_id: p.vacante?.id, postulacion_id: p.id,
    de_user_id: req.user.id, para_user_id: p.vacante?.owner_id, rol_de: 'trabajador',
    estrellas, comentario: req.body?.comentario || null,
  }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya dejaste tu reseña.' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ resena: data });
});

/* Perfil público de talento + reputación (para organizadores buscando). */
router.get('/perfil-talento/:userId', sesion("Perfil de talento ya publicado. El borrador sin publicar sólo lo ve su dueño."), async (req, res) => {
  const { userId } = req.params;
  const { data: perfil } = await supabase.from('perfil_talento')
    .select('user_id, titular, bio, habilidades, experiencia, disponibilidad, pais, portfolio_url, cv_url, cv_nombre, publicado, verificacion_estado')
    .eq('user_id', userId).maybeSingle();
  /* Un perfil sin publicar es un borrador: lo ve su dueño y nadie más. Antes
     bastaba con tener sesión y saber el userId para leer bio, CV y
     disponibilidad de alguien que aún no se había publicado. */
  if (!perfil || (!perfil.publicado && perfil.user_id !== req.user.id)) {
    return res.status(404).json({ error: 'Perfil no encontrado.' });
  }
  /* ciudad y foto (avatar_url) son de la persona, no de esta faceta: se leen
     de profiles, no de perfil_talento. */
  const { data: prof } = await supabase.from('profiles').select('nombre, avatar_url, ciudad').eq('id', userId).maybeSingle();
  const { data: resenas } = await supabase.from('talento_resenas')
    .select('estrellas, comentario, rol_de, created_at').eq('para_user_id', userId).eq('rol_de', 'organizador')
    .order('created_at', { ascending: false }).limit(50);
  const lista = resenas || [];
  const prom = lista.length ? lista.reduce((a, r) => a + r.estrellas, 0) / lista.length : null;
  res.json({
    perfil: { ...perfil, nombre: prof?.nombre, avatar_url: prof?.avatar_url, foto_url: prof?.avatar_url, ciudad: prof?.ciudad },
    resenas: lista, promedio: prom, total_resenas: lista.length,
  });
});

/* Reputación pública del organizador (reseñas que le dejaron los trabajadores). */
router.get('/me/organizador/reputacion', sesion("La reputación del propio organizador, hecha de reseñas que le dejaron."), async (req, res) => {
  const { data: resenas } = await supabase.from('talento_resenas')
    .select('estrellas, comentario, created_at, evento:eventos!evento_id(titulo), de:profiles!de_user_id(nombre, avatar_url)')
    .eq('para_user_id', req.user.id).eq('rol_de', 'trabajador')
    .order('created_at', { ascending: false }).limit(50);
  const lista = resenas || [];
  const promedio = lista.length ? lista.reduce((a, r) => a + r.estrellas, 0) / lista.length : null;
  const { count: eventos } = await supabase.from('eventos')
    .select('id', { count: 'exact', head: true }).eq('owner_id', req.user.id);
  res.json({ resenas: lista, promedio, total_resenas: lista.length, eventos: eventos || 0 });
});

/* ═══════════════════════ ORGANIZADOR (dentro del evento) ═══════════════════════ */

const CAMPOS_VACANTE = ['titulo', 'descripcion', 'rol_id', 'rol_texto', 'event_rol_id', 'requisitos',
  'preguntas', 'pago_monto', 'pago_moneda', 'pago_periodo', 'ciudad', 'modalidad',
  'fecha_inicio', 'fecha_fin', 'cupos', 'estado'];

router.get('/eventos/:eventoId/vacantes', exige(PERMS_VACANTES), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertPermiso(eventoId, req.user.id, ['editar_evento']);
    const { data, error } = await supabase.from('vacantes').select(SEL_VACANTE)
      .eq('evento_id', eventoId).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const ids = (data || []).map(v => v.id);
    let conteos = {};
    if (ids.length) {
      const { data: posts } = await supabase.from('postulaciones').select('vacante_id, etapa').in('vacante_id', ids);
      for (const p of posts || []) {
        conteos[p.vacante_id] = conteos[p.vacante_id] || { total: 0 };
        conteos[p.vacante_id].total++;
        conteos[p.vacante_id][p.etapa] = (conteos[p.vacante_id][p.etapa] || 0) + 1;
      }
    }
    res.json({ vacantes: (data || []).map(v => ({ ...v, postulaciones: conteos[v.id] || { total: 0 } })) });
  } catch (e) { res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message }); }
});

router.post('/eventos/:eventoId/vacantes', exige(PERMS_VACANTES), async (req, res) => {
  const { eventoId } = req.params;
  const titulo = (req.body?.titulo || '').trim();
  if (!titulo) return res.status(400).json({ error: 'El título de la vacante es requerido.' });
  if (req.body?.pago_monto == null || Number(req.body.pago_monto) < 0)
    return res.status(400).json({ error: 'El pago del contrato es obligatorio y visible.' });
  try {
    const ev = await assertPermiso(eventoId, req.user.id, ['editar_evento']);
    // TODO KYC: "solo cuentas verificadas publican" — gate cuando el proveedor esté integrado.
    const fila = { evento_id: eventoId, owner_id: ev.owner_id, titulo };
    for (const k of CAMPOS_VACANTE) {
      if (k === 'titulo') continue;
      if (req.body?.[k] !== undefined) fila[k] = req.body[k] === '' ? null : req.body[k];
    }
    if (fila.modalidad && !MODALIDADES.includes(fila.modalidad)) delete fila.modalidad;
    const { data, error } = await supabase.from('vacantes').insert(fila).select(SEL_VACANTE).single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ vacante: data });
  } catch (e) { res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message }); }
});

router.patch('/eventos/:eventoId/vacantes/:id', exige(PERMS_VACANTES), async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await assertPermiso(eventoId, req.user.id, ['editar_evento']);
    const patch = { updated_at: new Date().toISOString() };
    for (const k of CAMPOS_VACANTE) if (req.body?.[k] !== undefined) patch[k] = req.body[k] === '' ? null : req.body[k];
    if (patch.titulo !== undefined && !String(patch.titulo).trim()) return res.status(400).json({ error: 'El título no puede quedar vacío.' });
    const { data, error } = await supabase.from('vacantes').update(patch)
      .eq('id', id).eq('evento_id', eventoId).select(SEL_VACANTE).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Vacante no encontrada.' });
    res.json({ vacante: data });
  } catch (e) { res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message }); }
});

router.delete('/eventos/:eventoId/vacantes/:id', exige(PERMS_VACANTES), async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await assertPermiso(eventoId, req.user.id, ['editar_evento']);
    const { error } = await supabase.from('vacantes').delete().eq('id', id).eq('evento_id', eventoId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) { res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message }); }
});

/* Pipeline: postulaciones de una vacante, con snapshot y datos básicos del candidato. */
router.get('/eventos/:eventoId/vacantes/:vid/postulaciones', exige(PERMS_VACANTES), async (req, res) => {
  const { eventoId, vid } = req.params;
  try {
    await assertPermiso(eventoId, req.user.id, ['editar_evento']);
    const { data, error } = await supabase.from('postulaciones')
      .select(`id, etapa, respuestas, mensaje, entrevista, monto_contrato, perfil_snapshot, created_at,
        candidato:profiles!user_id(id, nombre, avatar_url, email)`)
      .eq('vacante_id', vid).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ postulaciones: data || [] });
  } catch (e) { res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message }); }
});

/* Mover de etapa. Al ACEPTAR: fija monto_contrato, mete al candidato al equipo
   con su rol, y registra la comisión (pendiente de cobro). */
router.patch('/eventos/:eventoId/vacantes/:vid/postulaciones/:pid', exige(PERMS_VACANTES), async (req, res) => {
  const { eventoId, vid, pid } = req.params;
  const etapa = req.body?.etapa;
  if (!ETAPAS.includes(etapa)) return res.status(400).json({ error: 'Etapa inválida.' });
  try {
    const ev = await assertPermiso(eventoId, req.user.id, ['editar_evento']);
    const { data: vac } = await supabase.from('vacantes')
      .select('id, titulo, pago_monto, pago_moneda, comision_pct, rol_id, rol_texto, event_rol_id, evento_id')
      .eq('id', vid).eq('evento_id', eventoId).maybeSingle();
    if (!vac) return res.status(404).json({ error: 'Vacante no encontrada.' });
    const { data: post } = await supabase.from('postulaciones')
      .select('id, user_id, etapa').eq('id', pid).eq('vacante_id', vid).maybeSingle();
    if (!post) return res.status(404).json({ error: 'Postulación no encontrada.' });

    const patch = { etapa, updated_at: new Date().toISOString() };
    if (etapa === 'aceptado') {
      const monto = req.body?.monto_contrato != null ? Number(req.body.monto_contrato) : Number(vac.pago_monto || 0);
      patch.monto_contrato = monto;
    }
    const { data: actualizada, error } = await supabase.from('postulaciones').update(patch).eq('id', pid).select().single();
    if (error) return res.status(500).json({ error: error.message });

    if (etapa === 'aceptado') {
      // Nombre del rol/categoría para mostrar en el equipo
      let rolNombre = vac.rol_texto;
      if (!rolNombre && vac.rol_id) {
        const { data: r } = await supabase.from('catalogo_roles').select('nombre').eq('id', vac.rol_id).maybeSingle();
        rolNombre = r?.nombre;
      }
      // Datos del candidato para event_members
      const { data: prof } = await supabase.from('profiles').select('email').eq('id', post.user_id).maybeSingle();
      // ¿Ya es miembro? Evitar duplicados.
      const { data: yaMiembro } = await supabase.from('event_members')
        .select('id, status').eq('evento_id', eventoId).eq('user_id', post.user_id).maybeSingle();
      const miembro = {
        evento_id: eventoId, user_id: post.user_id, email: prof?.email || `${post.user_id}@sin-email.local`,
        rol: rolNombre || 'Staff', rol_id: vac.event_rol_id || null, status: 'active',
        invited_by: req.user.id, accepted_at: new Date().toISOString(),
      };
      if (yaMiembro) {
        if (yaMiembro.status === 'removed') await supabase.from('event_members').update(miembro).eq('id', yaMiembro.id);
      } else {
        await supabase.from('event_members').insert(miembro);
      }
      // Comisión de la plataforma (5% del contrato), pendiente de cobro al organizador.
      const pct = Number(vac.comision_pct || 0.05);
      await supabase.from('cobros_vacantes').insert({
        tipo: 'comision', evento_id: eventoId, vacante_id: vid, postulacion_id: pid,
        owner_id: ev.owner_id || null,
        monto: Math.round((patch.monto_contrato || 0) * pct), moneda: vac.pago_moneda || 'COP', estado: 'pendiente',
      });
      avisar({ userId: post.user_id, tipo: 'vacante', titulo: '¡Te contrataron!',
        cuerpo: `Fuiste aceptado para "${vac.titulo}". Ya eres parte del equipo.`, link: `/eventos/${eventoId}`, eventoId });
    } else if (etapa === 'rechazado') {
      avisar({ userId: post.user_id, tipo: 'vacante', titulo: 'Actualización de tu postulación',
        cuerpo: `Tu postulación a "${vac.titulo}" no avanzó esta vez.`, link: `/mi-espacio`, eventoId });
    }
    res.json({ postulacion: actualizada });
  } catch (e) { res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message }); }
});

/* Agendar entrevista. STUB v1: guarda los datos (+ enlace manual) y pasa a 'entrevista'.
   La sincronización con Google Calendar se conecta en un paso posterior. */
router.post('/eventos/:eventoId/vacantes/:vid/postulaciones/:pid/entrevista', sesion("Panel del evento: la ruta llama a assertPermiso con su lista concreta antes de tocar nada."), async (req, res) => {
  const { eventoId, vid, pid } = req.params;
  try {
    await assertPermiso(eventoId, req.user.id, ['editar_evento']);

    /* Si el organizador conectó Google Calendar, crea el evento con invitación
       al candidato (best-effort: si falla, se guarda la entrevista igual). */
    let calendarId = null, enlaceCal = req.body?.enlace || null;
    const gc = require('../lib/googleCalendar.js');
    if (gc.configurado() && req.body?.inicio) {
      try {
        const { data: org } = await supabase.from('profiles').select('google_refresh_token').eq('id', req.user.id).maybeSingle();
        if (org?.google_refresh_token) {
          const { data: post } = await supabase.from('postulaciones').select('user_id, vacante:vacantes!vacante_id(titulo)').eq('id', pid).eq('vacante_id', vid).maybeSingle();
          const { data: cand } = post?.user_id ? await supabase.from('profiles').select('email').eq('id', post.user_id).maybeSingle() : { data: null };
          const evc = await gc.crearEvento({
            refreshToken: org.google_refresh_token,
            summary: `Entrevista · ${post?.vacante?.titulo || 'vacante'}`,
            description: 'Entrevista agendada desde GESTEK.',
            inicio: req.body.inicio, fin: req.body.fin,
            invitados: [cand?.email].filter(Boolean),
          });
          calendarId = evc.id; if (!enlaceCal) enlaceCal = evc.htmlLink;
        }
      } catch (e) { console.error('[entrevista google]', e.message); }
    }

    const entrevista = { inicio: req.body?.inicio || null, fin: req.body?.fin || null, enlace: enlaceCal, calendar_event_id: calendarId };
    const { data, error } = await supabase.from('postulaciones')
      .update({ entrevista, etapa: 'entrevista', updated_at: new Date().toISOString() })
      .eq('id', pid).eq('vacante_id', vid).select('id, user_id, etapa, entrevista').single();
    if (error) return res.status(500).json({ error: error.message });
    avisar({ userId: data.user_id, tipo: 'vacante', titulo: 'Te agendaron una entrevista',
      cuerpo: `Revisa los detalles de tu entrevista.`, link: `/mi-espacio`, eventoId });
    res.json({ postulacion: data });
  } catch (e) { res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message }); }
});

/* Reseña del organizador hacia el trabajador (pública en el perfil del trabajador). */
router.post('/eventos/:eventoId/vacantes/:vid/postulaciones/:pid/resena', sesion("Panel del evento: la ruta llama a assertPermiso con su lista concreta antes de tocar nada."), async (req, res) => {
  const { eventoId, vid, pid } = req.params;
  const estrellas = Number(req.body?.estrellas);
  if (!(estrellas >= 1 && estrellas <= 5)) return res.status(400).json({ error: 'Estrellas entre 1 y 5.' });
  try {
    await assertPermiso(eventoId, req.user.id, ['editar_evento']);
    const { data: post } = await supabase.from('postulaciones').select('id, user_id, etapa').eq('id', pid).eq('vacante_id', vid).maybeSingle();
    if (!post) return res.status(404).json({ error: 'Postulación no encontrada.' });
    if (post.etapa !== 'aceptado') return res.status(400).json({ error: 'Solo puedes reseñar a alguien contratado.' });
    const { data, error } = await supabase.from('talento_resenas').insert({
      evento_id: eventoId, vacante_id: vid, postulacion_id: pid,
      de_user_id: req.user.id, para_user_id: post.user_id, rol_de: 'organizador',
      estrellas, comentario: req.body?.comentario || null,
    }).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ya dejaste tu reseña.' });
      return res.status(500).json({ error: error.message });
    }
    res.status(201).json({ resena: data });
  } catch (e) { res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message }); }
});

/* Buscar talento publicado (para el gancho "consíguelo con nosotros"). */
router.get('/eventos/:eventoId/talento', sesion("Panel del evento: la ruta llama a assertPermiso con su lista concreta antes de tocar nada."), async (req, res) => {
  const { eventoId } = req.params;
  const { q, ciudad } = req.query;
  try {
    await assertPermiso(eventoId, req.user.id, ['editar_evento']);
    /* ciudad y foto ya no viven en perfil_talento: se leen del profile
       incrustado. `!inner` para que filtrar por ciudad filtre estas filas y
       no sólo el contenido del join (si no, el filtro de PostgREST se
       aplicaría al embed y devolvería igual todas las filas de talento). */
    let query = supabase.from('perfil_talento')
      .select('user_id, titular, habilidades, verificacion_estado, profile:profiles!user_id!inner(nombre, avatar_url, ciudad)')
      .eq('publicado', true).limit(60);
    if (ciudad) query = query.ilike('profile.ciudad', `%${ciudad}%`);
    if (q)      query = query.or(`titular.ilike.%${q}%,bio.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    const talento = (data || []).map(({ profile, ...t }) => ({
      ...t, ciudad: profile?.ciudad || null, foto_url: profile?.avatar_url || null,
    }));
    res.json({ talento });
  } catch (e) { res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message }); }
});

/* Destacar una vacante (micropago). STUB v1: registra el cobro 'pendiente';
   el destacado se activa cuando el pago se confirme (webhook de pagos). */
router.post('/eventos/:eventoId/vacantes/:id/destacar', sesion("Panel del evento: la ruta llama a assertPermiso con su lista concreta antes de tocar nada."), async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    const ev = await assertPermiso(eventoId, req.user.id, ['editar_evento']);
    const { data, error } = await supabase.from('cobros_vacantes').insert({
      tipo: 'destacado', evento_id: eventoId, vacante_id: id, owner_id: ev.owner_id,
      monto: Number(req.body?.monto || 0), moneda: req.body?.moneda || 'COP', estado: 'pendiente',
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ cobro: data, pendiente: true, mensaje: 'Cobro registrado — el pago de destacados se conectará con la pasarela.' });
  } catch (e) { res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message }); }
});

module.exports = router;
