/* GESTEK — Sugerencias / solicitudes / mensajes del equipo.
   Montado en '/' con paths absolutos.

   GET   /me/equipo/eventos                  — eventos donde soy miembro (vista empleado)
   GET   /eventos/:eventoId/solicitudes       — owner: todas; miembro: las suyas
   POST  /eventos/:eventoId/solicitudes       — crear (miembro activo u owner)
   PATCH /eventos/:eventoId/solicitudes/:id    — owner: estado/respuesta
*/

const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { notificar } = require('../lib/notificar.js');

const { sesion } = require('../core/permisos');
const router = express.Router();
router.use(verifySupabaseJWT);

const TIPOS   = ['sugerencia', 'solicitud', 'mensaje', 'reporte'];
const ESTADOS = ['abierta', 'en_revision', 'resuelta', 'descartada'];

/* owner OR miembro activo */
async function assertAccess(eventoId, userId) {
  const { data: ev } = await supabase
    .from('eventos').select('id, owner_id, titulo').eq('id', eventoId).maybeSingle();
  if (!ev) throw new Error('Evento no encontrado.');
  if (ev.owner_id === userId) return { ev, isOwner: true };
  const { data: m } = await supabase
    .from('event_members').select('id')
    .eq('evento_id', eventoId).eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (!m) throw new Error('No autorizado.');
  return { ev, isOwner: false };
}

/* ── GET /me/equipo/eventos ───────────────────────────────── */
router.get('/me/equipo/eventos', sesion("Los eventos donde ESTA persona es miembro del equipo."), async (req, res) => {
  /* Eventos donde soy miembro activo */
  const { data: miembros, error } = await supabase
    .from('event_members')
    .select('rol, evento:eventos!evento_id(id, titulo, slug, estado, fecha_inicio, owner_id, deleted_at)')
    .eq('user_id', req.user.id)
    .eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });

  const mapa = new Map();
  for (const m of miembros || []) {
    if (m.evento && !m.evento.deleted_at) {
      mapa.set(m.evento.id, { ...m.evento, mi_rol: m.rol });
    }
  }

  /* + eventos que YO organizo (el owner también tiene "su trabajo") */
  const { data: propios } = await supabase
    .from('eventos')
    .select('id, titulo, slug, estado, fecha_inicio, owner_id')
    .eq('owner_id', req.user.id)
    .is('deleted_at', null);
  for (const ev of propios || []) {
    if (!mapa.has(ev.id)) mapa.set(ev.id, { ...ev, mi_rol: 'Organizador' });
  }

  const lista = [...mapa.values()];

  /* Tareas pendientes asignadas a mí, por evento (best-effort) */
  const ids = lista.map(e => e.id);
  let porEvento = {};
  if (ids.length) {
    const { data: ts } = await supabase
      .from('tareas').select('evento_id')
      .in('evento_id', ids)
      .eq('asignado_user_id', req.user.id)
      .in('estado', ['pendiente', 'en_curso']);
    for (const t of ts || []) porEvento[t.evento_id] = (porEvento[t.evento_id] || 0) + 1;
  }
  res.json({
    eventos: lista.map(e => ({ ...e, tareas_pendientes: porEvento[e.id] || 0 })),
  });
});

/* ── GET /me/solicitudes — agregado de TODOS mis eventos (dashboard) ── */
/* Las solicitudes que me tocan: las que MANDÉ y las que RECIBÍ.
 *
 * ── Lo que devolvía antes, y lo que decía que devolvía ──────────────────
 *
 * Filtraba por `owner_id`: sólo las **recibidas** en mis propios eventos. Y
 * sin embargo su descripción decía «las sugerencias que ha enviado esta
 * persona», y el widget que la pinta en Mi Espacio se anuncia como
 * «Solicitudes que has enviado».
 *
 * O sea que quien colabora en el evento de otro —que es justo quien pide
 * cosas— pedía y no volvía a ver nunca en qué quedó. Y el dueño veía las
 * peticiones de los demás bajo el rótulo de las suyas.
 *
 * Ahora vienen las dos, y cada fila dice cuál es con `mia`. Devolver sólo las
 * enviadas habría sido más limpio y le habría quitado al dueño una bandeja que
 * ya estaba usando: aquí no se quita nada, se marca. */
router.get('/me/solicitudes', sesion('Las solicitudes que mandó esta persona, más las que recibió en sus propios eventos. Cada fila dice cuál es.'), async (req, res) => {
  const { data: evs } = await supabase
    .from('eventos').select('id, titulo')
    .eq('owner_id', req.user.id).is('deleted_at', null);
  const ids = (evs || []).map(e => e.id);
  const tit = Object.fromEntries((evs || []).map(e => [e.id, e.titulo]));

  /* Dos consultas y no un `or(...)`: PostgREST admite el `or` con `in`, pero
     leer «autor_id.eq.X,evento_id.in.(…)» seis meses después cuesta más que
     dos consultas evidentes, y esto no está en ningún camino caliente. */
  const mias = supabase
    .from('event_requests')
    .select('*, evento:eventos!evento_id(titulo)')
    .eq('autor_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(40);

  const recibidas = ids.length
    ? supabase
        .from('event_requests')
        .select('*, autor:profiles!autor_id(nombre, avatar_url)')
        .in('evento_id', ids)
        .neq('autor_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(40)
    : Promise.resolve({ data: [] });

  const [rM, rR] = await Promise.all([mias, recibidas]);
  if (rM.error) return res.status(500).json({ error: rM.error.message });
  if (rR.error) return res.status(500).json({ error: rR.error.message });

  const lista = [
    ...(rM.data || []).map(r => ({ ...r, mia: true,  evento_titulo: r.evento?.titulo || tit[r.evento_id] || '—' })),
    ...(rR.data || []).map(r => ({ ...r, mia: false, evento_titulo: tit[r.evento_id] || '—' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({ solicitudes: lista });
});

/* ── GET /eventos/:eventoId/solicitudes ───────────────────── */
router.get('/eventos/:eventoId/solicitudes', sesion('Es del equipo del evento: la ruta comprueba pertenencia activa, no un permiso concreto.'), async (req, res) => {
  try {
    const { isOwner } = await assertAccess(req.params.eventoId, req.user.id);
    let q = supabase
      .from('event_requests')
      .select('*, autor:profiles!autor_id(id, nombre, avatar_url)')
      .eq('evento_id', req.params.eventoId)
      .order('created_at', { ascending: false });
    if (!isOwner) q = q.eq('autor_id', req.user.id);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ solicitudes: data || [], soyOwner: isOwner });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 404).json({ error: e.message });
  }
});

/* ── POST /eventos/:eventoId/solicitudes ──────────────────── */
router.post('/eventos/:eventoId/solicitudes', sesion('Es del equipo del evento: la ruta comprueba pertenencia activa, no un permiso concreto.'), async (req, res) => {
  const { tipo, titulo, contenido } = req.body || {};
  if (!contenido?.trim()) return res.status(400).json({ error: 'El contenido es requerido.' });
  try {
    const { ev } = await assertAccess(req.params.eventoId, req.user.id);
    const { data, error } = await supabase
      .from('event_requests')
      .insert({
        evento_id: ev.id,
        autor_id : req.user.id,
        tipo     : TIPOS.includes(tipo) ? tipo : 'sugerencia',
        titulo   : titulo?.trim() || null,
        contenido: contenido.trim(),
      })
      .select('*, autor:profiles!autor_id(id, nombre, avatar_url)')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    /* Avisar al organizador (si no es él mismo) */
    if (ev.owner_id !== req.user.id) {
      notificar({
        userId: ev.owner_id, tipo: 'equipo',
        titulo: `Nueva ${data.tipo} del equipo`,
        cuerpo: `${data.titulo || data.contenido.slice(0, 60)} — en ${ev.titulo}`,
        link: `/eventos/${ev.id}`, eventoId: ev.id,
      });
    }
    res.status(201).json({ solicitud: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 404).json({ error: e.message });
  }
});

/* ── PATCH /eventos/:eventoId/solicitudes/:id (solo owner) ── */
router.patch('/eventos/:eventoId/solicitudes/:id', sesion('Es del equipo del evento: la ruta comprueba pertenencia activa, no un permiso concreto.'), async (req, res) => {
  try {
    const { ev, isOwner } = await assertAccess(req.params.eventoId, req.user.id);
    if (!isOwner) return res.status(403).json({ error: 'Solo el organizador gestiona las solicitudes.' });

    const updates = { updated_at: new Date().toISOString() };
    if (req.body.estado && ESTADOS.includes(req.body.estado)) updates.estado = req.body.estado;
    if ('respuesta' in req.body) updates.respuesta = req.body.respuesta || null;
    if (Object.keys(updates).length === 1) return res.status(400).json({ error: 'Sin cambios válidos.' });

    const { data, error } = await supabase
      .from('event_requests')
      .update(updates)
      .eq('id', req.params.id).eq('evento_id', ev.id)
      .select('*, autor:profiles!autor_id(id, nombre, avatar_url)')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'No encontrada.' });

    /* Avisar al autor del cambio */
    if (data.autor_id && data.autor_id !== req.user.id) {
      notificar({
        userId: data.autor_id, tipo: 'equipo',
        titulo: `Tu ${data.tipo} fue actualizada`,
        cuerpo: `Estado: ${data.estado}${data.respuesta ? ' · ' + data.respuesta.slice(0, 60) : ''}`,
        link: `/mi-trabajo`, eventoId: ev.id,
      });
    }
    res.json({ solicitud: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 404).json({ error: e.message });
  }
});

module.exports = router;
