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

  /* Backfill avatar: si el perfil no tiene avatar_url pero el usuario
     sí tiene foto en la metadata de Auth (ej. Google), lo sincronizamos
     una vez. Así equipo/chat/ranking muestran la foto. */
  if (data && !data.avatar_url) {
    const md = req.user.user_metadata || {};
    const foto = md.foto || md.avatar_url || md.picture || null;
    if (foto && esUrlImagenSegura(foto)) {
      data.avatar_url = foto;
      supabase.from('profiles').update({ avatar_url: foto })
        .eq('id', req.user.id).then(() => {}, () => {});
    }
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

  /* Seguridad: avatar_url debe ser una URL de imagen segura (no javascript:/data ejecutable) */
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

  /* Badge plataforma: perfil completo (idempotente) */
  if (data.nombre && data.telefono && data.ciudad) {
    otorgarBadge(req.user.id, 'perfil_completo');
  }

  res.json({ profile: data });
});

module.exports = router;
