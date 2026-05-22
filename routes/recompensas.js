/* GESTEK — Recompensas que define un organizador (audiencia cliente | empleado).
   GET    /me/recompensas?audiencia=cliente   — listar las mías
   POST   /me/recompensas                     — crear
   PATCH  /me/recompensas/:id                 — editar
   DELETE /me/recompensas/:id                 — borrar
   GET    /me/canjes                           — canjes recibidos en mi comunidad
   PATCH  /me/canjes/:id                       — marcar usado/cancelado
*/

const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');

const router = express.Router();
router.use(verifySupabaseJWT);

const AUDIENCIAS = ['cliente', 'empleado'];

router.get('/me/recompensas', async (req, res) => {
  let q = supabase.from('recompensas')
    .select('*')
    .eq('organizador_id', req.user.id)
    .order('created_at', { ascending: false });
  if (AUDIENCIAS.includes(req.query.audiencia)) q = q.eq('audiencia', req.query.audiencia);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ recompensas: data || [] });
});

router.post('/me/recompensas', async (req, res) => {
  const { audiencia, titulo, descripcion, costo_puntos, stock } = req.body;
  if (!AUDIENCIAS.includes(audiencia)) return res.status(400).json({ error: 'audiencia inválida (cliente|empleado).' });
  if (!titulo?.trim()) return res.status(400).json({ error: 'Título requerido.' });
  const costo = Number(costo_puntos);
  if (!Number.isFinite(costo) || costo <= 0) return res.status(400).json({ error: 'costo_puntos debe ser > 0.' });

  const { data, error } = await supabase.from('recompensas').insert({
    organizador_id: req.user.id,
    audiencia,
    titulo: titulo.trim(),
    descripcion: descripcion || null,
    costo_puntos: costo,
    stock: (stock === '' || stock == null) ? null : Number(stock),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ recompensa: data });
});

router.patch('/me/recompensas/:id', async (req, res) => {
  const allowed = ['titulo', 'descripcion', 'costo_puntos', 'stock', 'activo'];
  const updates = {};
  for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios.' });
  if ('costo_puntos' in updates) {
    const c = Number(updates.costo_puntos);
    if (!Number.isFinite(c) || c <= 0) return res.status(400).json({ error: 'costo_puntos inválido.' });
    updates.costo_puntos = c;
  }
  if ('stock' in updates) updates.stock = (updates.stock === '' || updates.stock == null) ? null : Number(updates.stock);

  const { data, error } = await supabase.from('recompensas')
    .update(updates)
    .eq('id', req.params.id)
    .eq('organizador_id', req.user.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Recompensa no encontrada.' });
  res.json({ recompensa: data });
});

router.delete('/me/recompensas/:id', async (req, res) => {
  const { error } = await supabase.from('recompensas')
    .delete().eq('id', req.params.id).eq('organizador_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* Canjes recibidos en mi comunidad (como organizador) */
router.get('/me/canjes', async (req, res) => {
  const { data, error } = await supabase.from('canjes')
    .select(`id, titulo, costo_puntos, codigo, estado, audiencia, created_at,
             usuario:profiles!user_id(id, nombre, email, avatar_url)`)
    .eq('organizador_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ canjes: data || [] });
});

router.patch('/me/canjes/:id', async (req, res) => {
  const { estado } = req.body;
  if (!['entregado', 'usado', 'cancelado'].includes(estado))
    return res.status(400).json({ error: 'Estado inválido.' });
  const { data, error } = await supabase.from('canjes')
    .update({ estado })
    .eq('id', req.params.id)
    .eq('organizador_id', req.user.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Canje no encontrado.' });
  res.json({ canje: data });
});

module.exports = router;
