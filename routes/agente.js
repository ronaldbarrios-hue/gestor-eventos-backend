const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const agente = require('../lib/agente.js');
const { sesion } = require('../core/permisos');
const router = express.Router();
router.use(verifySupabaseJWT);

/* GET /me/agente/estado — disponibilidad del asistente.

   Gestbot estuvo detrás del plan Pro, con una lista de correos del
   desarrollador colada para poder probarlo. Ya no: lo único que decide si
   responde es que el servidor tenga proveedor de IA configurado. Se mantiene
   `requierePro: false` en la respuesta porque el frontend lo lee, y quitarlo de
   golpe dejaría la pantalla en un estado indefinido. */
router.get('/me/agente/estado', sesion("El asistente de IA del propio usuario: su historial y su cuota son suyos."), async (req, res) => {
  /* El aviso de capa gratuita se manda desde aquí y no se escribe en el
     frontend, porque depende de con qué proveedor está corriendo el servidor.
     Groq y Gemini tienen capa gratuita con límite de peticiones por minuto y por
     día; Anthropic es de pago y no lo tiene.

     Es lo único de GESTEK con un tope, y el tope no es del usuario: es del
     proveedor. Decirlo antes es mejor que dejar que alguien se choque con un
     "demasiadas peticiones" a mitad de una conversación y crea que se rompió. */
  const CAPA_GRATUITA = { groq: 'Groq', gemini: 'Google Gemini' };
  const nombreProveedor = CAPA_GRATUITA[agente.provider] || null;

  res.json({
    disponible: agente.disponible,
    provider: agente.provider || null,
    requierePro: false,
    /* null cuando el proveedor no tiene límite de capa gratuita. */
    aviso_uso: nombreProveedor
      ? `El asistente funciona sobre la capa gratuita de ${nombreProveedor}, así que tiene un número limitado de usos por minuto y por día. Si te dice que espere un momento, es eso: no se rompió.`
      : null,
    capa_gratuita: Boolean(nombreProveedor),
  });
});

/* POST /me/agente/chat */
router.post('/me/agente/chat', sesion("El asistente de IA del propio usuario: su historial y su cuota son suyos."), async (req, res) => {
  if (!agente.disponible) {
    return res.status(503).json({
      error: 'El asistente IA no está habilitado en este servidor.',
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
router.post('/me/agente/generar-evento', sesion("El asistente de IA del propio usuario: su historial y su cuota son suyos."), async (req, res) => {
  if (!agente.disponible) {
    return res.status(503).json({ error: 'El asistente IA no esta habilitado en este servidor.' });
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
