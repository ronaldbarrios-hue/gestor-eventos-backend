const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const agente = require('../lib/agente.js');
const router = express.Router();
router.use(verifySupabaseJWT);

/* Cuentas con acceso a Gestbot sin necesidad de plan Pro — uso personal
   del desarrollador para pruebas, mientras el resto de usuarios sigue
   necesitando Pro normalmente. Debe coincidir con EMAILS_DESBLOQUEADOS
   en src/pages/agente/GestbotPage.jsx del frontend. */
const EMAILS_DESBLOQUEADOS = ['ronaldbarrios890@gmail.com'];

/* Gestbot es una función del plan Pro. */
async function esPro(userId, userEmail) {
  if (EMAILS_DESBLOQUEADOS.includes((userEmail || '').toLowerCase())) return true;
  const { data } = await supabase
    .from('profiles').select('plan, plan_expires_at').eq('id', userId).maybeSingle();
  return data?.plan === 'pro' &&
    (!data.plan_expires_at || new Date(data.plan_expires_at) > new Date());
}

/* GET /me/agente/estado — disponibilidad + si el usuario es Pro */
router.get('/me/agente/estado', async (req, res) => {
  const pro = await esPro(req.user.id, req.user.email);
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
  if (!(await esPro(req.user.id, req.user.email))) {
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

/* POST /me/agente/generar-evento — borrador de evento a partir de una
   descripcion en lenguaje natural. Devuelve { borrador } y NO crea nada:
   el frontend pre-llena el asistente de creacion y el usuario revisa. */
router.post('/me/agente/generar-evento', async (req, res) => {
  if (!agente.disponible) {
    return res.status(503).json({ error: 'El asistente IA no esta habilitado en este servidor.' });
  }
  if (!(await esPro(req.user.id, req.user.email))) {
    return res.status(402).json({
      error: 'Crear eventos con IA es una funcion del plan Pro.',
      requierePro: true,
    });
  }
  const descripcion = String(req.body?.descripcion || '').trim();
  if (descripcion.length < 10) {
    return res.status(400).json({ error: 'Describe tu evento con al menos una frase.' });
  }

  /* Le pasamos las categorias reales para que elija un slug que exista. */
  const { data: cats } = await supabase.from('categorias').select('slug, nombre');
  const slugs = (cats || []).map(c => c.slug);

  const prompt = [
    'Eres el asistente de GESTEK, una plataforma de gestion de eventos.',
    'A partir de la descripcion del organizador, propon un BORRADOR de evento.',
    'Responde UNICAMENTE con un objeto JSON valido, sin texto alrededor ni bloques de codigo.',
    '',
    'Estructura exacta:',
    '{',
    '  "titulo": string (max 80 caracteres, atractivo),',
    '  "descripcion": string (2-4 frases para la pagina publica),',
    '  "modalidad": "fisico" | "virtual" | "hibrido",',
    `  "categoria_slug": uno de: ${slugs.join(', ') || 'general'},`,
    '  "aforo_total": number (estimado razonable),',
    '  "location_nombre": string (lugar o ciudad; vacio si es virtual),',
    '  "duracion_horas": number,',
    '  "boletas_sugeridas": [{ "nombre": string, "precio": number }] (1 a 4, precio en la moneda local, 0 si es gratis)',
    '}',
    '',
    `Descripcion del organizador: ${descripcion}`,
  ].join('\n');

  try {
    const b = await agente.generarJSON(prompt);
    /* Saneamos todo: el modelo puede devolver cualquier cosa. */
    const num = (v, min, max, def) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
    };
    const borrador = {
      titulo         : String(b.titulo || '').slice(0, 120),
      descripcion    : String(b.descripcion || '').slice(0, 2000),
      modalidad      : ['fisico', 'virtual', 'hibrido'].includes(b.modalidad) ? b.modalidad : 'fisico',
      categoria_slug : slugs.includes(b.categoria_slug) ? b.categoria_slug : (slugs[0] || null),
      aforo_total    : b.aforo_total == null ? null : num(b.aforo_total, 1, 200000, null),
      location_nombre: String(b.location_nombre || '').slice(0, 160),
      duracion_horas : num(b.duracion_horas, 1, 240, 4),
      boletas_sugeridas: Array.isArray(b.boletas_sugeridas)
        ? b.boletas_sugeridas.slice(0, 4).map(t => ({
            nombre: String(t?.nombre || '').slice(0, 60),
            precio: Math.max(0, Number(t?.precio) || 0),
          })).filter(t => t.nombre)
        : [],
    };
    if (!borrador.titulo) return res.status(502).json({ error: 'La IA no devolvio un titulo valido. Intenta describir el evento con mas detalle.' });
    res.json({ borrador });
  } catch (e) {
    console.warn('[agente] generar-evento error:', e.message);
    res.status(502).json({ error: 'No se pudo generar el borrador: ' + e.message });
  }
});

module.exports = router;
