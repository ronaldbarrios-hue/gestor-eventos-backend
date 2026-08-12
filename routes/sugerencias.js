/* GESTEK — #49 · Buzón de sugerencias para los catálogos.

   Los tipos de evento y los roles de vacante son listas que decidimos
   nosotros. Cuando alguien monta algo que no está, elige "Otro" y ahí muere:
   nadie se entera de qué falta y la lista se amplía adivinando.

   Esto recoge lo que la persona buscaba, en el momento exacto en que no lo
   encuentra, con el contexto de lo que estaba haciendo. No es un sistema de
   tickets: no hay respuesta ni hilo. Es una libreta que se lee de vez en
   cuando y de la que salen altas de catálogo.

   Rutas (montadas en /me):
     POST /me/sugerencias  — dejar una
     GET  /me/sugerencias  — las mías, para poder ver que sí se mandó
*/

'use strict';

const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');

const router = express.Router();
router.use(verifySupabaseJWT);

const CATALOGOS = ['evento', 'vacante'];
const MAX_TEXTO = 400;
/* Tope diario por persona. No es para castigar a nadie: es para que un bucle
   accidental del front no llene la tabla en una tarde. */
const MAX_POR_DIA = 20;

router.post('/sugerencias', async (req, res) => {
  const catalogo = String(req.body?.catalogo || '').trim();
  const texto = String(req.body?.texto || '').trim();

  if (!CATALOGOS.includes(catalogo)) {
    return res.status(400).json({ error: 'catalogo debe ser "evento" o "vacante".' });
  }
  if (!texto) return res.status(400).json({ error: 'Escribe qué te faltó encontrar.' });
  if (texto.length > MAX_TEXTO) {
    return res.status(400).json({ error: `Máximo ${MAX_TEXTO} caracteres.` });
  }

  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await supabase.from('sugerencias_catalogo')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.id).gte('created_at', desde);
  if ((count || 0) >= MAX_POR_DIA) {
    return res.status(429).json({ error: 'Has mandado muchas sugerencias hoy. Mañana seguimos leyéndote.' });
  }

  /* El contexto se guarda tal cual pero acotado: viene del navegador y no hay
     razón para aceptar un objeto de cualquier tamaño en una tabla que sólo se
     lee a ojo. */
  let contexto = {};
  if (req.body?.contexto && typeof req.body.contexto === 'object') {
    for (const [k, v] of Object.entries(req.body.contexto).slice(0, 10)) {
      contexto[String(k).slice(0, 40)] = String(v ?? '').slice(0, 200);
    }
  }

  const { data, error } = await supabase.from('sugerencias_catalogo')
    .insert({ catalogo, texto, contexto, user_id: req.user.id })
    .select('id, catalogo, texto, estado, created_at').single();

  if (error) {
    /* Sin la 0063 aplicada la tabla no existe. Se dice qué pasa en vez de
       devolver un error de Postgres crudo. */
    if (/relation .* does not exist/i.test(error.message)) {
      return res.status(503).json({ error: 'El buzón todavía no está disponible. Falta aplicar la migración 0063.' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ sugerencia: data });
});

router.get('/sugerencias', async (req, res) => {
  const { data, error } = await supabase.from('sugerencias_catalogo')
    .select('id, catalogo, texto, estado, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.json({ sugerencias: [] });
  res.json({ sugerencias: data || [] });
});

module.exports = router;
