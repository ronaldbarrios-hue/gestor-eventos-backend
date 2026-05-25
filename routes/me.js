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

  // Activar invitaciones pendientes por email
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

module.exports = router;
