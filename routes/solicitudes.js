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

const { sesion, permisosDeMiembro, SELECT_PERMISOS } = require('../core/permisos');
const router = express.Router();
router.use(verifySupabaseJWT);

const TIPOS   = ['sugerencia', 'solicitud', 'mensaje', 'reporte', 'cambio'];

/* Los campos de la ficha de equipo que alguien puede pedir que le cambien.
 *
 * ── Por qué una lista blanca y por qué vive aquí ─────────────────────────
 *
 * Sin ella, `campo` viaja desde el navegador y acaba en un `update` — o sea,
 * cualquiera del equipo podría pedir que le cambien `status` a 'active' o
 * `custom_permissions` a lo que quisiera, y bastaría con que quien organiza
 * pulsara «aplicar» sin leer.
 *
 * Vive en el código y no en la base porque la comprobación depende de QUIÉN
 * pide y sobre qué evento, y eso una restricción de columna no lo sabe.
 *
 * `rol` es la etiqueta de texto —cómo se llama el puesto— y NO `rol_id`, que
 * es el rol de verdad con sus permisos. Ese no se pide: se concede. La
 * diferencia importa porque el segundo cambia lo que la persona puede tocar.
 */
const CAMPOS_PEDIBLES = {
  nombre_invitado: 'Cómo aparece tu nombre',
  rol            : 'El nombre de tu puesto',
};
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
  /* La ficha ENTERA, no sólo el nombre del rol.
     *
     * Antes se pedía `rol` y ya: quien colabora veía una etiqueta y no sabía
     * qué podía hacer ni cómo figuraba su nombre en las listas y en la
     * escarapela. «Ver toda la información» empieza por mandarla. */
  const { data: miembros, error } = await supabase
    .from('event_members')
    .select(`id, rol, nombre_invitado, email, ${SELECT_PERMISOS},
             evento:eventos!evento_id(id, titulo, slug, estado, fecha_inicio, owner_id, deleted_at)`)
    .eq('user_id', req.user.id)
    .eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });

  const mapa = new Map();
  for (const m of miembros || []) {
    if (m.evento && !m.evento.deleted_at) {
      mapa.set(m.evento.id, {
        ...m.evento,
        mi_rol: m.rol,
        /* La ficha tal y como la ve quien organiza, para poder pedir que se
           corrija lo que esté mal. `miembro_id` va porque es lo que identifica
           la fila que se cambiaría. */
        mi_ficha: {
          miembro_id     : m.id,
          rol            : m.rol,
          nombre_invitado: m.nombre_invitado,
          email          : m.email,
          rol_nombre     : m.rol_detail?.nombre || null,
          /* Los del rol MÁS los sueltos, resueltos aquí: quien mira su ficha
             quiere saber qué puede hacer, no de dónde le viene cada permiso. */
          permisos       : [...permisosDeMiembro(m)],
        },
      });
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
  const { tipo, titulo, contenido, cambio } = req.body || {};
  if (!contenido?.trim()) return res.status(400).json({ error: 'El contenido es requerido.' });
  try {
    const { ev } = await assertAccess(req.params.eventoId, req.user.id);

    /* Una solicitud de cambio lleva el cambio dentro, y se comprueba aquí:
       el campo tiene que estar en la lista blanca y el valor tiene que ser
       texto. Si no encaja, se guarda como solicitud normal en vez de
       rechazarla — lo que la persona escribió no se pierde por un campo mal
       puesto, y quien organiza lo lee igual. */
    let filaCambio = null;
    let tipoFinal = TIPOS.includes(tipo) ? tipo : 'sugerencia';
    if (tipoFinal === 'cambio') {
      const campo = String(cambio?.campo || '');
      const propuesto = typeof cambio?.valor_propuesto === 'string' ? cambio.valor_propuesto.trim() : '';
      if (!CAMPOS_PEDIBLES[campo] || !propuesto) {
        tipoFinal = 'solicitud';
      } else {
        filaCambio = {
          campo,
          etiqueta       : CAMPOS_PEDIBLES[campo],
          valor_actual   : typeof cambio.valor_actual === 'string' ? cambio.valor_actual : null,
          valor_propuesto: propuesto.slice(0, 200),
        };
      }
    }

    const { data, error } = await supabase
      .from('event_requests')
      .insert({
        evento_id: ev.id,
        autor_id : req.user.id,
        tipo     : tipoFinal,
        titulo   : titulo?.trim() || null,
        contenido: contenido.trim(),
        cambio   : filaCambio,
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
    if (Object.keys(updates).length === 1 && !req.body.aplicar) {
      return res.status(400).json({ error: 'Sin cambios válidos.' });
    }

    /* Aplicar el cambio pedido.
     *
     * Va ANTES de tocar la solicitud: si la escritura en `event_members`
     * falla, la solicitud se queda abierta y se puede reintentar. Al revés
     * quedaría marcada como resuelta con el cambio sin hacer — y nadie
     * volvería a mirarla.
     *
     * Se vuelve a comprobar la lista blanca aquí. El `cambio` se guardó
     * validado, pero entre que se pidió y se aprueba puede haber pasado un
     * despliegue que quite un campo de la lista, y aplicar algo que ya no se
     * acepta por venir de una fila vieja es la puerta de atrás clásica. */
    if (req.body.aplicar) {
      const { data: sol } = await supabase
        .from('event_requests')
        .select('id, tipo, cambio, autor_id, estado')
        .eq('id', req.params.id).eq('evento_id', ev.id).maybeSingle();

      if (!sol) return res.status(404).json({ error: 'No encontrada.' });
      if (sol.tipo !== 'cambio' || !sol.cambio?.campo) {
        return res.status(400).json({ error: 'Esta solicitud no lleva ningún cambio que aplicar.' });
      }
      if (sol.cambio.aplicado_at) {
        return res.status(409).json({ error: 'Ese cambio ya se aplicó.' });
      }
      if (!CAMPOS_PEDIBLES[sol.cambio.campo]) {
        return res.status(400).json({ error: `«${sol.cambio.campo}» ya no es un campo que se pueda cambiar así.` });
      }

      const { error: eApl } = await supabase
        .from('event_members')
        .update({ [sol.cambio.campo]: sol.cambio.valor_propuesto })
        .eq('evento_id', ev.id).eq('user_id', sol.autor_id);
      if (eApl) return res.status(500).json({ error: `No se pudo aplicar: ${eApl.message}` });

      updates.cambio = { ...sol.cambio, aplicado_at: new Date().toISOString() };
      if (!updates.estado) updates.estado = 'resuelta';
    }

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
