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
      .select('id, nombre, tipo, parent_id, rol_ids, dm_users, orden, created_by, created_at')
      .eq('evento_id', eventoId)
      .order('orden', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    /* Canales normales: owner ve todo; miembros ven abiertos o de su rol.
       DMs: solo los ve cada participante (ni el owner ve DMs ajenos). */
    const regulares = (data || []).filter(c => c.tipo !== 'dm');
    const dms = (data || []).filter(c => c.tipo === 'dm' && (c.dm_users || []).includes(req.user.id));
    const visiblesReg = ctx.isOwner
      ? regulares
      : regulares.filter(c => !c.rol_ids?.length || (ctx.rol_id && c.rol_ids.includes(ctx.rol_id)));

    if (dms.length) {
      const otros = [...new Set(dms.map(c => (c.dm_users || []).find(u => u !== req.user.id)).filter(Boolean))];
      const { data: profs } = await supabase.from('profiles').select('id, nombre, avatar_url')
        .in('id', otros.length ? otros : ['00000000-0000-0000-0000-000000000000']);
      const byId = Object.fromEntries((profs || []).map(p => [p.id, p]));
      for (const c of dms) {
        const otro = (c.dm_users || []).find(u => u !== req.user.id);
        c.dm_nombre = byId[otro]?.nombre || 'Mensaje directo';
        c.dm_avatar = byId[otro]?.avatar_url || null;
      }
    }

    res.json({
      channels: [...visiblesReg, ...dms],
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
      .from('chat_channels').select('id, tipo, dm_users').eq('id', channelId).eq('evento_id', eventoId).maybeSingle();
    if (!ch) return res.status(404).json({ error: 'Canal no encontrado.' });
    if (ch.tipo === 'dm' && !(ch.dm_users || []).includes(req.user.id)) return res.status(403).json({ error: 'No autorizado.' });

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
      .from('chat_channels').select('id, tipo, dm_users').eq('id', channelId).eq('evento_id', eventoId).maybeSingle();
    if (!ch) return res.status(404).json({ error: 'Canal no encontrado.' });
    if (ch.tipo === 'dm' && !(ch.dm_users || []).includes(req.user.id)) return res.status(403).json({ error: 'No autorizado.' });

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

/* POST /eventos/:eventoId/chat/dm { user_id } — abre (o crea) el chat 1:1
   entre el usuario y otro miembro del evento. Idempotente por par de usuarios. */
router.post('/:eventoId/chat/dm', async (req, res) => {
  const { eventoId } = req.params;
  const otro = req.body?.user_id;
  if (!otro || otro === req.user.id) return res.status(400).json({ error: 'Elige con quién chatear.' });
  try {
    const ctx = await assertAcceso(eventoId, req.user.id);
    let otroOk = ctx.ev.owner_id === otro;
    if (!otroOk) {
      const { data: m } = await supabase.from('event_members')
        .select('id').eq('evento_id', eventoId).eq('user_id', otro).eq('status', 'active').maybeSingle();
      otroOk = !!m;
    }
    if (!otroOk) return res.status(400).json({ error: 'Esa persona no está en el equipo del evento.' });

    const pair = [req.user.id, otro].sort();
    const dm_key = pair.join(':');
    let { data: channel } = await supabase.from('chat_channels')
      .select('id, tipo, dm_users').eq('evento_id', eventoId).eq('dm_key', dm_key).maybeSingle();
    if (!channel) {
      const { data: nuevo, error } = await supabase.from('chat_channels').insert({
        evento_id: eventoId, nombre: 'directo', tipo: 'dm', dm_users: pair, dm_key, created_by: req.user.id,
      }).select('id, tipo, dm_users').single();
      if (error) return res.status(500).json({ error: error.message });
      channel = nuevo;
    }
    const { data: prof } = await supabase.from('profiles').select('nombre, avatar_url').eq('id', otro).maybeSingle();
    res.status(201).json({ channel: { ...channel, dm_nombre: prof?.nombre || 'Mensaje directo', dm_avatar: prof?.avatar_url || null } });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

module.exports = router;
