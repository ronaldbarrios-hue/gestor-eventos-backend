/* GESTEK — API pública v1. Auth: Authorization: Bearer gtk_live_...
   Solo lectura. Escopada al owner del token. Montada en /api/v1. */

const express = require('express');
const { sesion } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifyApiToken } = require('../lib/apitoken.js');

const router = express.Router();
router.use(verifyApiToken);

/* GET /api/v1/eventos — eventos del owner del token */
router.get('/eventos', sesion('Los tokens y webhooks de SU cuenta: cada uno cuelga de un usuario y sólo él los ve.'), async (req, res) => {
  const { data, error } = await supabase
    .from('eventos')
    .select('id, slug, titulo, descripcion, estado, modalidad, fecha_inicio, fecha_fin, location_nombre, aforo_total, aforo_vendido, currency, created_at')
    .eq('owner_id', req.apiOwner)
    .is('deleted_at', null)
    .order('fecha_inicio', { ascending: false })
    .limit(Math.min(Number(req.query.limit) || 50, 100));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data || [] });
});

/* GET /api/v1/eventos/:id */
router.get('/eventos/:id', sesion('Los tokens y webhooks de SU cuenta: cada uno cuelga de un usuario y sólo él los ve.'), async (req, res) => {
  const { data, error } = await supabase
    .from('eventos')
    .select('id, slug, titulo, descripcion, estado, modalidad, fecha_inicio, fecha_fin, location_nombre, location_direccion, aforo_total, aforo_vendido, currency, created_at')
    .eq('id', req.params.id)
    .eq('owner_id', req.apiOwner)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Evento no encontrado.' });
  res.json({ data });
});

/* GET /api/v1/eventos/:id/asistentes */
router.get('/eventos/:id/asistentes', sesion('Los tokens y webhooks de SU cuenta: cada uno cuelga de un usuario y sólo él los ve.'), async (req, res) => {
  /* Verifica pertenencia del evento al owner del token */
  const { data: ev } = await supabase
    .from('eventos').select('id').eq('id', req.params.id).eq('owner_id', req.apiOwner).maybeSingle();
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });

  const { data, error } = await supabase
    .from('tickets')
    .select('id, codigo, estado, guest_nombre, guest_email, precio_pagado, pagado_at, checked_in_at, created_at, tipo:ticket_types!ticket_type_id(nombre)')
    .eq('evento_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(req.query.limit) || 200, 500));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: (data || []).map(t => ({
    id: t.id, codigo: t.codigo, estado: t.estado,
    nombre: t.guest_nombre, email: t.guest_email,
    tipo: t.tipo?.nombre || null,
    precio_pagado: t.precio_pagado, pagado_at: t.pagado_at,
    checked_in_at: t.checked_in_at, created_at: t.created_at,
  })) });
});

/* GET /api/v1/eventos/:id/resumen — métricas básicas */
router.get('/eventos/:id/resumen', sesion('Los tokens y webhooks de SU cuenta: cada uno cuelga de un usuario y sólo él los ve.'), async (req, res) => {
  const { data: ev } = await supabase
    .from('eventos').select('id, aforo_total, aforo_vendido').eq('id', req.params.id).eq('owner_id', req.apiOwner).maybeSingle();
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });

  const { data: tks } = await supabase
    .from('tickets').select('estado, precio_pagado').eq('evento_id', req.params.id);
  const r = (tks || []).reduce((a, t) => {
    a.total++;
    a[t.estado] = (a[t.estado] || 0) + 1;
    a.ingresos += Number(t.precio_pagado) || 0;
    return a;
  }, { total: 0, ingresos: 0 });
  res.json({ data: { aforo_total: ev.aforo_total, aforo_vendido: ev.aforo_vendido, tickets: r } });
});

module.exports = router;
