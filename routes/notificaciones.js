/* GESTEK — Notificaciones in-app del usuario logueado.
   GET    /me/notificaciones            — lista (paginada) + contador no leídas
   PATCH  /me/notificaciones/:id/leer   — marca una como leída
   POST   /me/notificaciones/leer-todas — marca todas como leídas
   DELETE /me/notificaciones/:id        — borra una
*/

const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');

const router = express.Router();
router.use(verifySupabaseJWT);

router.get('/me/notificaciones', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const { data, error } = await supabase
    .from('notificaciones')
    .select('id, tipo, titulo, cuerpo, link, evento_id, leida, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });

  const { count, error: e2 } = await supabase
    .from('notificaciones')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.id)
    .eq('leida', false);
  if (e2) return res.status(500).json({ error: e2.message });

  res.json({ notificaciones: data || [], no_leidas: count ?? 0 });
});

router.patch('/me/notificaciones/:id/leer', async (req, res) => {
  const { error } = await supabase
    .from('notificaciones')
    .update({ leida: true })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.post('/me/notificaciones/leer-todas', async (req, res) => {
  const { error } = await supabase
    .from('notificaciones')
    .update({ leida: true })
    .eq('user_id', req.user.id)
    .eq('leida', false);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.delete('/me/notificaciones/:id', async (req, res) => {
  const { error } = await supabase
    .from('notificaciones')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* POST /me/notificaciones/generar-recordatorios — dispara manualmente la
   función SQL de recordatorios in-app. Útil para testear sin esperar el cron.
   Cualquier usuario autenticado puede llamarlo (la función es global e idempotente). */
router.post('/me/notificaciones/generar-recordatorios', async (req, res) => {
  const { data, error } = await supabase.rpc('generar_recordatorios_inapp');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, creadas: data ?? 0 });
});

module.exports = router;
