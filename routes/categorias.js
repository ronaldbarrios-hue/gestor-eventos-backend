const express = require('express');
const supabase = require('../lib/supabase.js');

const router = express.Router();

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
