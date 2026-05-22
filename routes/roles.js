const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { auditar } = require('../lib/auditar.js');
const { assertPermiso } = require('../lib/acceso.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* Owner o miembro con permiso 'gestionar_roles'. */
function assertOwner(eventoId, userId) {
  return assertPermiso(eventoId, userId, ['gestionar_roles'], 'id, owner_id');
}

const CAMPOS_EDITABLES = ['nombre', 'descripcion', 'permissions', 'orden'];

/* GET /eventos/:eventoId/roles */
router.get('/:eventoId/roles', async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const { data, error } = await supabase
      .from('event_roles')
      .select('*')
      .eq('evento_id', eventoId)
      .order('orden', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ roles: data || [] });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/roles */
router.post('/:eventoId/roles', async (req, res) => {
  const { eventoId } = req.params;
  const { nombre, descripcion, permissions = [] } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre del rol requerido.' });

  try {
    await assertOwner(eventoId, req.user.id);

    /* orden = max(orden) + 1 */
    const { data: max } = await supabase
      .from('event_roles').select('orden').eq('evento_id', eventoId)
      .order('orden', { ascending: false }).limit(1).maybeSingle();
    const nextOrden = (max?.orden || 0) + 1;

    const { data, error } = await supabase
      .from('event_roles')
      .insert({
        evento_id  : eventoId,
        nombre     : nombre.trim(),
        descripcion: descripcion?.trim() || null,
        permissions: Array.isArray(permissions) ? permissions : [],
        is_system  : false,
        orden      : nextOrden,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un rol con ese nombre.' });
      return res.status(500).json({ error: error.message });
    }
    auditar(req, eventoId, 'rol.crear', { entidad: 'rol', entidadId: data.id, detalle: { nombre: data.nombre } });
    res.status(201).json({ rol: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* PATCH /eventos/:eventoId/roles/:rolId */
router.patch('/:eventoId/roles/:rolId', async (req, res) => {
  const { eventoId, rolId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const updates = {};
    for (const k of CAMPOS_EDITABLES) {
      if (k in req.body) updates[k] = req.body[k];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios.' });

    const { data, error } = await supabase
      .from('event_roles')
      .update(updates)
      .eq('id', rolId)
      .eq('evento_id', eventoId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    auditar(req, eventoId, 'rol.editar', { entidad: 'rol', entidadId: rolId, detalle: { campos: Object.keys(updates) } });
    res.json({ rol: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE /eventos/:eventoId/roles/:rolId */
router.delete('/:eventoId/roles/:rolId', async (req, res) => {
  const { eventoId, rolId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);

    /* No permitir borrar si hay miembros asignados */
    const { count } = await supabase
      .from('event_members')
      .select('id', { count: 'exact', head: true })
      .eq('rol_id', rolId)
      .neq('status', 'removed');

    if (count > 0) return res.status(409).json({ error: `Hay ${count} miembro(s) con este rol. Cámbiales el rol antes de borrarlo.` });

    const { error } = await supabase
      .from('event_roles')
      .delete()
      .eq('id', rolId)
      .eq('evento_id', eventoId);
    if (error) return res.status(500).json({ error: error.message });
    auditar(req, eventoId, 'rol.borrar', { entidad: 'rol', entidadId: rolId });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

module.exports = router;
