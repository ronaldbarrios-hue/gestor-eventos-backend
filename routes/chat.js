const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* Helper: el usuario tiene acceso al chat del evento si es owner O es miembro activo.
   Devuelve permisos del rol + rol_id del miembro (para filtrar canales). */
async function assertAcceso(eventoId, userId) {
  const { data: ev } = await supabase
    .from('eventos').select('id, owner_id').eq('id', eventoId).maybeSingle();
  if (!ev) throw new Error('Evento no encontrado.');
  if (ev.owner_id === userId) return { ev, isOwner: true, permisos: ['*'], rol_id: null };

  const { data: m } = await supabase
    .from('event_members')
    .select('id, rol_id, rol_detail:event_roles!rol_id(permissions)')
    .eq('evento_id', eventoId).eq('user_id', userId).eq('status', 'active')
    .maybeSingle();
  if (!m) throw new Error('No autorizado.');
  return { ev, isOwner: false, permisos: m.rol_detail?.permissions || [], rol_id: m.rol_id };
}

function tienePermiso(ctx, permiso) {
  return ctx.isOwner || (Array.isArray(ctx.permisos) && ctx.permisos.includes(permiso));
}

/* GET /eventos/:eventoId/chat/channels — filtrado por rol del usuario */
router.get('/:eventoId/chat/channels', async (req, res) => {
  const { eventoId } = req.params;
  try {
    const ctx = await assertAcceso(eventoId, req.user.id);
    const { data, error } = await supabase
      .from('chat_channels')
      .select('id, nombre, tipo, parent_id, rol_ids, orden, created_by, created_at')
      .eq('evento_id', eventoId)
      .order('orden', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    /* Filtra: owner ve todo; miembros ven canales sin rol_ids (abiertos)
       o canales cuyos rol_ids incluyan su rol */
    const visibles = ctx.isOwner
      ? (data || [])
      : (data || []).filter(c => !c.rol_ids?.length || (ctx.rol_id && c.rol_ids.includes(ctx.rol_id)));

    res.json({
      channels: visibles,
      puedeCrear: tienePermiso(ctx, 'crear_canales'),
    });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/chat/channels — owner o quien tenga 'crear_canales'.
   Acepta parent_id para crear subgrupo + rol_ids[] para restringir visibilidad. */
router.post('/:eventoId/chat/channels', async (req, res) => {
  const { eventoId } = req.params;
  const { nombre, tipo = 'general', parent_id = null, rol_ids = [] } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre del canal requerido.' });

  try {
    const ctx = await assertAcceso(eventoId, req.user.id);
    if (!tienePermiso(ctx, 'crear_canales')) {
      return res.status(403).json({ error: 'No tienes permiso para crear canales.' });
    }

    if (parent_id) {
      const { data: parent } = await supabase
        .from('chat_channels').select('id, parent_id').eq('id', parent_id).eq('evento_id', eventoId).maybeSingle();
      if (!parent) return res.status(400).json({ error: 'Canal padre inválido.' });
      if (parent.parent_id) return res.status(400).json({ error: 'No se permite anidar más de un nivel.' });
    }

    /* Valida rol_ids: deben pertenecer al evento */
    const cleanRoles = Array.isArray(rol_ids) ? rol_ids.filter(Boolean) : [];
    if (cleanRoles.length > 0) {
      const { data: rolesValidos } = await supabase
        .from('event_roles').select('id').eq('evento_id', eventoId).in('id', cleanRoles);
      const validIds = new Set((rolesValidos || []).map(r => r.id));
      const allValid = cleanRoles.every(r => validIds.has(r));
      if (!allValid) return res.status(400).json({ error: 'Uno o más roles no pertenecen a este evento.' });
    }

    const { data, error } = await supabase
      .from('chat_channels')
      .insert({
        evento_id: eventoId,
        nombre   : nombre.trim(),
        tipo,
        parent_id: parent_id || null,
        rol_ids  : cleanRoles,
        created_by: req.user.id,
      })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ channel: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* PATCH /eventos/:eventoId/chat/channels/:channelId — actualizar rol_ids o nombre */
router.patch('/:eventoId/chat/channels/:channelId', async (req, res) => {
  const { eventoId, channelId } = req.params;
  const { rol_ids, nombre } = req.body;
  try {
    const ctx = await assertAcceso(eventoId, req.user.id);
    if (!tienePermiso(ctx, 'crear_canales')) {
      return res.status(403).json({ error: 'No tienes permiso para editar canales.' });
    }
    const updates = {};
    if (nombre?.trim()) updates.nombre = nombre.trim();
    if (Array.isArray(rol_ids)) updates.rol_ids = rol_ids.filter(Boolean);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios.' });

    const { data, error } = await supabase
      .from('chat_channels').update(updates)
      .eq('id', channelId).eq('evento_id', eventoId)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ channel: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE /eventos/:eventoId/chat/channels/:channelId */
router.delete('/:eventoId/chat/channels/:channelId', async (req, res) => {
  const { eventoId, channelId } = req.params;
  try {
    const ctx = await assertAcceso(eventoId, req.user.id);
    if (!tienePermiso(ctx, 'crear_canales')) {
      return res.status(403).json({ error: 'No tienes permiso para borrar canales.' });
    }
    const { error } = await supabase
      .from('chat_channels').delete()
      .eq('id', channelId).eq('evento_id', eventoId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* GET /eventos/:eventoId/chat/channels/:channelId/messages */
router.get('/:eventoId/chat/channels/:channelId/messages', async (req, res) => {
  const { eventoId, channelId } = req.params;
  const { before, limit = 50 } = req.query;
  try {
    await assertAcceso(eventoId, req.user.id);

    /* Verifica que el canal pertenezca al evento */
    const { data: ch } = await supabase
      .from('chat_channels').select('id').eq('id', channelId).eq('evento_id', eventoId).maybeSingle();
    if (!ch) return res.status(404).json({ error: 'Canal no encontrado.' });

    let q = supabase
      .from('chat_messages')
      .select(`id, contenido, file_url, created_at, user_id, autor:profiles!user_id(id, nombre, avatar_url, email)`)
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (before) q = q.lt('created_at', before);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    /* Lo devolvemos en orden ascendente para que el frontend solo haga push() */
    res.json({ messages: (data || []).reverse() });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/chat/channels/:channelId/messages */
router.post('/:eventoId/chat/channels/:channelId/messages', async (req, res) => {
  const { eventoId, channelId } = req.params;
  const { contenido, file_url } = req.body;
  if (!contenido?.trim() && !file_url) return res.status(400).json({ error: 'Mensaje vacío.' });

  try {
    await assertAcceso(eventoId, req.user.id);
    const { data: ch } = await supabase
      .from('chat_channels').select('id').eq('id', channelId).eq('evento_id', eventoId).maybeSingle();
    if (!ch) return res.status(404).json({ error: 'Canal no encontrado.' });

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        channel_id: channelId,
        user_id   : req.user.id,
        contenido : (contenido || '').trim(),
        file_url  : file_url || null,
      })
      .select(`id, contenido, file_url, created_at, user_id, autor:profiles!user_id(id, nombre, avatar_url, email)`)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ message: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

module.exports = router;
