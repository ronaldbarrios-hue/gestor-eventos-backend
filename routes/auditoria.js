/* GESTEK — Auditoría (lectura). Feature plan Pro.
   GET /eventos/:eventoId/auditoria  — solo owner del evento + plan Pro vigente.
   Se monta en /eventos. */
const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const router = express.Router();
router.use(verifySupabaseJWT);

router.get('/:eventoId/auditoria', async (req, res) => {
  const { eventoId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 100, 300);

  /* Owner check */
  const { data: ev, error: e1 } = await supabase
    .from('eventos').select('id, owner_id').eq('id', eventoId).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  if (ev.owner_id !== req.user.id) return res.status(403).json({ error: 'No autorizado.' });

  /* Pro gate: el owner debe tener plan pro vigente */
  const { data: prof } = await supabase
    .from('profiles').select('plan, plan_expires_at').eq('id', ev.owner_id).single();
  const esPro = prof?.plan === 'pro' && (!prof.plan_expires_at || new Date(prof.plan_expires_at) > new Date());

  if (!esPro) {
    return res.json({ auditoria: [], requierePro: true });
  }

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
