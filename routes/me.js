const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { otorgarBadge } = require('../lib/gamificacion.js');
const { esUrlImagenSegura } = require('../lib/urls.js');
const router = express.Router();
router.use(verifySupabaseJWT);

/* GET /me — perfil del usuario logueado */
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (data && !data.avatar_url) {
    const md = req.user.user_metadata || {};
    const foto = md.foto || md.avatar_url || md.picture || null;
    if (foto && esUrlImagenSegura(foto)) {
      data.avatar_url = foto;
      supabase.from('profiles').update({ avatar_url: foto })
        .eq('id', req.user.id).then(() => {}, () => {});
    }
  }
  if (req.user.email) {
    supabase
      .from('event_members')
      .update({
        user_id: req.user.id,
        status: 'active',
        accepted_at: new Date().toISOString(),
      })
      .eq('email', req.user.email.toLowerCase())
      .eq('status', 'invited')
      .is('user_id', null)
      .then(() => {}, () => {});
  }
  res.json({ profile: data });
});

/* PATCH /me — actualizar campos editables del perfil */
router.patch('/', async (req, res) => {
  const allowed = ['nombre', 'handle', 'avatar_url', 'telefono', 'ciudad', 'empresa', 'ocupacion'];
  const updates = {};
  for (const k of allowed) {
    if (k in req.body) updates[k] = req.body[k];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Sin campos válidos para actualizar.' });
  }
  if ('avatar_url' in updates && !esUrlImagenSegura(updates.avatar_url)) {
    return res.status(400).json({ error: 'La URL de avatar no es válida.' });
  }
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (data.nombre && data.telefono && data.ciudad) {
    otorgarBadge(req.user.id, 'perfil_completo');
  }
  res.json({ profile: data });
});

/* GET /me/boletas — boletas compradas por el usuario logueado */
router.get('/boletas', async (req, res) => {
  const { data, error } = await supabase
    .from('tickets')
    .select(`
      id, codigo, qr_token, estado, precio_pagado, created_at, checked_in_at,
      tipo:ticket_types!ticket_type_id(nombre, descripcion, currency),
      evento:eventos!evento_id(id, slug, titulo, fecha_inicio, fecha_fin, location_nombre, cover_url, estado)
    `)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const { data: porEmail, error: e2 } = await supabase
    .from('tickets')
    .select(`
      id, codigo, qr_token, estado, precio_pagado, created_at, checked_in_at,
      tipo:ticket_types!ticket_type_id(nombre, descripcion, currency),
      evento:eventos!evento_id(id, slug, titulo, fecha_inicio, fecha_fin, location_nombre, cover_url, estado)
    `)
    .eq('guest_email', req.user.email.toLowerCase())
    .is('user_id', null)
    .order('created_at', { ascending: false });

  if (e2) return res.status(500).json({ error: e2.message });

  const todas = [...(data || []), ...(porEmail || [])];
  const unicas = Object.values(Object.fromEntries(todas.map(t => [t.id, t])));
  unicas.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({ boletas: unicas, total: unicas.length });
});

module.exports = router;
