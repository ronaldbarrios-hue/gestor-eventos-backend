/* GESTEK — Auditoría (lectura).
   GET /eventos/:eventoId/auditoria  — solo el owner del evento.
   Se monta en /eventos.

   Antes esto estaba detrás del plan Pro, y no devolvía 402: devolvía una lista
   vacía con requierePro:true, así que la auditoría se veía como un evento sin
   actividad en vez de como una función bloqueada. */
const express = require('express');
const { sesion } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const router = express.Router();
router.use(verifySupabaseJWT);

router.get('/:eventoId/auditoria', sesion("El registro de quién tocó qué lo ve sólo el dueño del evento."), async (req, res) => {
  const { eventoId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 100, 300);

  /* Owner check */
  const { data: ev, error: e1 } = await supabase
    .from('eventos').select('id, owner_id').eq('id', eventoId).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  if (ev.owner_id !== req.user.id) return res.status(403).json({ error: 'No autorizado.' });

  const { data, error } = await supabase
    .from('audit_log')
    .select(`id, accion, entidad, entidad_id, detalle, actor_email, created_at,
             actor:profiles!actor_id(id, nombre, avatar_url)`)
    .eq('evento_id', eventoId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ auditoria: data || [] });
});

module.exports = router;
