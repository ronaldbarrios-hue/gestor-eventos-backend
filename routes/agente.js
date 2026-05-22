const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const agente = require('../lib/agente.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* Gestbot es una función del plan Pro. */
async function esPro(userId) {
  const { data } = await supabase
    .from('profiles').select('plan, plan_expires_at').eq('id', userId).maybeSingle();
  return data?.plan === 'pro' &&
    (!data.plan_expires_at || new Date(data.plan_expires_at) > new Date());
}

/* GET /me/agente/estado — disponibilidad + si el usuario es Pro */
router.get('/me/agente/estado', async (req, res) => {
  const pro = await esPro(req.user.id);
  res.json({
    disponible: agente.disponible,
    provider: agente.provider || null,
    requierePro: !pro,
  });
});

/* POST /me/agente/chat — solo Pro */
router.post('/me/agente/chat', async (req, res) => {
  if (!agente.disponible) {
    return res.status(503).json({
      error: 'El asistente IA no está habilitado en este servidor.',
      mood: 'error',
    });
  }
  if (!(await esPro(req.user.id))) {
    return res.status(402).json({
      error: 'Gestbot es una función del plan Pro. Activa Pro para usar el asistente.',
      requierePro: true,
      mood: 'error',
    });
  }

  const { mensajes, archivos } = req.body || {};
  if (!Array.isArray(mensajes) || mensajes.length === 0) {
    return res.status(400).json({ error: 'mensajes requerido.' });
  }

  try {
    const out = await agente.chat(req.user.id, mensajes, archivos);
    res.json(out);
  } catch (e) {
    console.warn('[agente] chat error:', e.message);
    res.status(500).json({
      reply: 'Algo se me cruzó. Intenta de nuevo.',
      mood: 'error',
      acciones: [],
    });
  }
});

module.exports = router;
