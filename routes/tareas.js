const express = require('express');
const { exige, sesion } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { notificar, notificarVarios } = require('../lib/notificar.js');
const { otorgarPuntos, otorgarBadge } = require('../lib/gamificacion.js');
const { enviarEmailEvento } = require('../lib/emailPlantillas.js');
const { baseFrontend } = require('../lib/frontend.js');

const FRONT = baseFrontend();

/* Manda email de tarea a una lista de user_ids (resuelve nombre+email de profiles). */
/* El título del evento ya no se pasa: lo pone la plantilla con {{evento}}. */
async function emailTarea(userIds, tarea, eventoId) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return;
  try {
    const { data: perfiles } = await supabase
      .from('profiles').select('nombre, email').in('id', ids);
    for (const p of perfiles || []) {
      if (!p.email) continue;
      /* La fecha de la tarea es la de su vencimiento, no la del evento: es lo
         que le importa a quien la recibe. */
      let vence = '';
      if (tarea.vence_at) {
        const d = new Date(tarea.vence_at);
        /* Ojo: una fecha inválida no lanza, devuelve "Invalid Date". */
        if (!Number.isNaN(d.getTime())) {
          vence = d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
        }
      }
      enviarEmailEvento({
        evento: eventoId,
        tipo: 'tarea',
        to: p.email,
        ctx: {
          nombre: p.nombre,
          tarea: tarea.titulo,
          fecha: vence,
          enlace: `${FRONT}/eventos/${eventoId}`,
        },
      });
    }
  } catch (e) {
    console.warn('[emailTarea] error:', e.message);
  }
}

/* Notifica al asignado de una tarea (in-app + email): usuario directo o rol. */
async function notificarAsignacion(tarea, eventoId) {
  try {
    const { data: ev } = await supabase
      .from('eventos').select('titulo').eq('id', eventoId).maybeSingle();
    const eventoTitulo = ev?.titulo || 'un evento';
    const base = {
      tipo: 'tarea',
      titulo: 'Nueva tarea asignada',
      cuerpo: `"${tarea.titulo}" en ${eventoTitulo}.`,
      link: `/eventos/${eventoId}`,
      eventoId,
    };
    if (tarea.asignado_user_id) {
      await notificar({ ...base, userId: tarea.asignado_user_id });
      emailTarea([tarea.asignado_user_id], tarea, eventoId);
    } else if (tarea.asignado_rol_id) {
      const { data: miembros } = await supabase
        .from('event_members')
        .select('user_id')
        .eq('evento_id', eventoId)
        .eq('rol_id', tarea.asignado_rol_id)
        .eq('status', 'active');
      const ids = (miembros || []).map(m => m.user_id);
      await notificarVarios(ids, base);
      emailTarea(ids, tarea, eventoId);
    }
  } catch (e) {
    console.warn('[notificarAsignacion] error:', e.message);
  }
}

const router = express.Router();
router.use(verifySupabaseJWT);

async function assertAccess(eventoId, userId) {
  const { data: ev } = await supabase
    .from('eventos').select('id, owner_id').eq('id', eventoId).maybeSingle();
  if (!ev) throw new Error('Evento no encontrado.');
  if (ev.owner_id === userId) return { ev, isOwner: true };

  const { data: m } = await supabase
    .from('event_members')
    .select('id, rol_id').eq('evento_id', eventoId).eq('user_id', userId).eq('status', 'active')
    .maybeSingle();
  if (!m) throw new Error('No autorizado.');
  return { ev, isOwner: false, member: m };
}

const ESTADOS    = ['pendiente', 'en_curso', 'hecho', 'cancelada'];
const PRIORIDADES = ['baja', 'normal', 'alta', 'urgente'];

async function logTarea(tareaId, userId, tipo, contenido = {}) {
  await supabase.from('tarea_log').insert({
    tarea_id: tareaId, user_id: userId, tipo, contenido,
  });
}

/* GET /eventos/:eventoId/tareas — owner ve todas; miembros ven las suyas/su rol */
router.get('/:eventoId/tareas', sesion('Es del equipo del evento: la ruta comprueba pertenencia activa, no un permiso concreto. Cualquier miembro entra, y lo que puede hacer dentro lo decide el handler.'), async (req, res) => {
  const { eventoId } = req.params;
  try {
    const ctx = await assertAccess(eventoId, req.user.id);
    let query = supabase
      .from('tareas')
      .select(`
        *,
        asignado_user:profiles!asignado_user_id(id, nombre, avatar_url, email),
        asignado_rol:event_roles!asignado_rol_id(id, nombre),
        autor:profiles!created_by(id, nombre, avatar_url)
      `)
      .eq('evento_id', eventoId)
      .order('orden', { ascending: true })
      .order('created_at', { ascending: false });

    if (!ctx.isOwner) {
      /* Filtra: asignadas a mí o a mi rol o sin asignar a nadie en mi rol */
      query = query.or(`asignado_user_id.eq.${req.user.id},asignado_rol_id.eq.${ctx.member.rol_id}`);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ tareas: data || [] });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/tareas */
router.post('/:eventoId/tareas', sesion('Es del equipo del evento: la ruta comprueba pertenencia activa, no un permiso concreto. Cualquier miembro entra, y lo que puede hacer dentro lo decide el handler.'), async (req, res) => {
  const { eventoId } = req.params;
  const { titulo, descripcion, prioridad, asignado_user_id, asignado_rol_id, vence_at } = req.body;
  if (!titulo?.trim()) return res.status(400).json({ error: 'Título requerido.' });

  try {
    const ctx = await assertAccess(eventoId, req.user.id);
    if (!ctx.isOwner) return res.status(403).json({ error: 'Solo el organizador puede crear tareas.' });

    const { data, error } = await supabase
      .from('tareas').insert({
        evento_id       : eventoId,
        titulo          : titulo.trim(),
        descripcion     : descripcion || null,
        prioridad       : PRIORIDADES.includes(prioridad) ? prioridad : 'normal',
        asignado_user_id: asignado_user_id || null,
        asignado_rol_id : asignado_rol_id || null,
        vence_at        : vence_at || null,
        created_by      : req.user.id,
      })
      .select(`*, asignado_user:profiles!asignado_user_id(id, nombre, avatar_url, email),
        asignado_rol:event_roles!asignado_rol_id(id, nombre)`)
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await logTarea(data.id, req.user.id, 'created', { titulo: data.titulo });
    if (data.asignado_user_id || data.asignado_rol_id) {
      notificarAsignacion(data, eventoId);
    }
    res.status(201).json({ tarea: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* PATCH /eventos/:eventoId/tareas/:tareaId — owner edita todo, asignado puede cambiar estado */
router.patch('/:eventoId/tareas/:tareaId', sesion('Es del equipo del evento: la ruta comprueba pertenencia activa, no un permiso concreto. Cualquier miembro entra, y lo que puede hacer dentro lo decide el handler.'), async (req, res) => {
  const { eventoId, tareaId } = req.params;
  try {
    const ctx = await assertAccess(eventoId, req.user.id);
    const { data: actual } = await supabase
      .from('tareas').select('*').eq('id', tareaId).eq('evento_id', eventoId).maybeSingle();
    if (!actual) return res.status(404).json({ error: 'Tarea no encontrada.' });

    /* Permisos diferenciados */
    const allOwner = ['titulo','descripcion','prioridad','asignado_user_id','asignado_rol_id','vence_at','orden'];
    const ownByAsignado = actual.asignado_user_id === req.user.id;
    const fields = ctx.isOwner ? [...allOwner, 'estado'] : (ownByAsignado ? ['estado'] : []);

    if (fields.length === 0) return res.status(403).json({ error: 'No puedes editar esta tarea.' });

    const updates = {};
    for (const k of fields) if (k in req.body) updates[k] = req.body[k];
    if (updates.estado === 'hecho' && actual.estado !== 'hecho') updates.completed_at = new Date().toISOString();
    if (updates.estado && updates.estado !== 'hecho') updates.completed_at = null;

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios.' });

    const { data, error } = await supabase
      .from('tareas').update(updates)
      .eq('id', tareaId).eq('evento_id', eventoId)
      .select(`*, asignado_user:profiles!asignado_user_id(id, nombre, avatar_url, email),
        asignado_rol:event_roles!asignado_rol_id(id, nombre)`)
      .single();
    if (error) return res.status(500).json({ error: error.message });

    /* Log de cambios */
    if (updates.estado && updates.estado !== actual.estado) {
      await logTarea(tareaId, req.user.id, 'estado', { de: actual.estado, a: updates.estado });

      /* Gamificación: tarea pasada a 'hecho' → puntos de empleado a quien la
         tenía asignada (o quien la marcó si era por rol). */
      if (updates.estado === 'hecho' && actual.estado !== 'hecho') {
        const empleadoId = data.asignado_user_id || req.user.id;
        const { data: ev } = await supabase
          .from('eventos').select('owner_id').eq('id', eventoId).maybeSingle();
        if (ev?.owner_id && empleadoId !== ev.owner_id) {
          otorgarPuntos({
            userId: empleadoId, organizadorId: ev.owner_id, audiencia: 'empleado',
            eventoId, accion: 'tarea_completada',
            /* El título se guarda como texto: una tarea cerrada se borra a
               menudo cuando se limpia el tablero, y los puntos que dio tienen
               que seguir explicándose. */
            origen: { tipo: 'tarea', id: data.id, detalle: data.titulo || null },
          }).then(async () => {
            const { count } = await supabase
              .from('points_log').select('id', { count: 'exact', head: true })
              .eq('user_id', empleadoId).eq('audiencia', 'empleado').eq('accion', 'tarea_completada');
            if ((count || 0) >= 20) otorgarBadge(empleadoId, 'trabajador');
          });
        }
      }
    }
    if ('asignado_user_id' in updates && updates.asignado_user_id !== actual.asignado_user_id) {
      await logTarea(tareaId, req.user.id, 'asignacion', { tipo: 'usuario', user_id: updates.asignado_user_id });
      if (updates.asignado_user_id) notificarAsignacion(data, eventoId);
    }
    if ('asignado_rol_id' in updates && updates.asignado_rol_id !== actual.asignado_rol_id) {
      await logTarea(tareaId, req.user.id, 'asignacion', { tipo: 'rol', rol_id: updates.asignado_rol_id });
      if (updates.asignado_rol_id && !updates.asignado_user_id) notificarAsignacion(data, eventoId);
    }

    res.json({ tarea: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE — solo owner */
router.delete('/:eventoId/tareas/:tareaId', sesion('Es del equipo del evento: la ruta comprueba pertenencia activa, no un permiso concreto. Cualquier miembro entra, y lo que puede hacer dentro lo decide el handler.'), async (req, res) => {
  const { eventoId, tareaId } = req.params;
  try {
    const ctx = await assertAccess(eventoId, req.user.id);
    if (!ctx.isOwner) return res.status(403).json({ error: 'No autorizado.' });
    const { error } = await supabase
      .from('tareas').delete().eq('id', tareaId).eq('evento_id', eventoId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* GET /eventos/:eventoId/tareas/:tareaId/log — trazabilidad */
router.get('/:eventoId/tareas/:tareaId/log', sesion('Es del equipo del evento: la ruta comprueba pertenencia activa, no un permiso concreto. Cualquier miembro entra, y lo que puede hacer dentro lo decide el handler.'), async (req, res) => {
  const { eventoId, tareaId } = req.params;
  try {
    await assertAccess(eventoId, req.user.id);
    const { data, error } = await supabase
      .from('tarea_log')
      .select(`*, user:profiles!user_id(id, nombre, avatar_url)`)
      .eq('tarea_id', tareaId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ log: data || [] });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/tareas/:tareaId/comentar */
router.post('/:eventoId/tareas/:tareaId/comentar', sesion('Es del equipo del evento: la ruta comprueba pertenencia activa, no un permiso concreto. Cualquier miembro entra, y lo que puede hacer dentro lo decide el handler.'), async (req, res) => {
  const { eventoId, tareaId } = req.params;
  const { texto } = req.body;
  if (!texto?.trim()) return res.status(400).json({ error: 'Comentario vacío.' });
  try {
    await assertAccess(eventoId, req.user.id);
    await logTarea(tareaId, req.user.id, 'comentario', { texto: texto.trim() });
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

module.exports = router;
