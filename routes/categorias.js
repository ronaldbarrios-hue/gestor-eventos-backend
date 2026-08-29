const express = require('express');
const supabase = require('../lib/supabase.js');

const router = express.Router();

/* El catálogo de categorías es público a propósito: lo lee la página de un
   evento antes de que nadie entre. Declarado para que el censo de permisos no
   lo cuente como olvidado. */
router.use(require('../core/permisos').publica('Catálogo de categorías: lo lee la página pública del evento sin sesión.'));

/* GET /categorias — catálogo público */
router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('categorias')
    .select('id, slug, nombre')
    .order('nombre');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ categorias: data });
});

module.exports = router;
