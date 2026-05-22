const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* Owner o miembro con permiso 'ver_analytics'. */
function assertOwner(eventoId, userId) {
  return assertPermiso(eventoId, userId, ['ver_analytics'], 'id, owner_id');
}

/* GET /eventos/:eventoId/analytics — métricas agregadas del evento.
   Query: ?dias=30 (default). */
router.get('/:eventoId/analytics', async (req, res) => {
  const { eventoId } = req.params;
  const dias = Math.min(Number(req.query.dias || 30), 365);

  try {
    await assertOwner(eventoId, req.user.id);
    const desde = new Date(Date.now() - dias * 24 * 3600 * 1000).toISOString();

    /* Visitas en el rango */
    const { data: views, error: ev } = await supabase
      .from('event_views')
      .select('visitor_hash, source, referrer, created_at')
      .eq('evento_id', eventoId)
      .gte('created_at', desde)
      .order('created_at', { ascending: true });
    if (ev) return res.status(500).json({ error: ev.message });

    /* Tickets en el rango */
    const { data: tickets, error: et } = await supabase
      .from('tickets')
      .select('id, estado, precio_pagado, created_at, ticket_type_id, tipo:ticket_types!ticket_type_id(nombre)')
      .eq('evento_id', eventoId)
      .gte('created_at', desde);
    if (et) return res.status(500).json({ error: et.message });

    /* Agregados */
    const totalViews = views?.length || 0;
    const uniqueVisitors = new Set((views || []).map(v => v.visitor_hash)).size;
    const totalTickets = tickets?.length || 0;
    const ticketsPagados = (tickets || []).filter(t => t.estado === 'pagado').length;
    const asistencias = (tickets || []).filter(t => t.estado === 'usado').length;
    const ingresos = (tickets || []).reduce((sum, t) => sum + (Number(t.precio_pagado) || 0), 0);
    const conversion = uniqueVisitors > 0 ? (totalTickets / uniqueVisitors) * 100 : 0;
    const tasaAsistencia = ticketsPagados > 0 ? (asistencias / ticketsPagados) * 100 : 0;

    /* Source breakdown */
    const sourcesMap = {};
    for (const v of views || []) {
      const s = v.source || 'direct';
      sourcesMap[s] = (sourcesMap[s] || 0) + 1;
    }
    const sources = Object.entries(sourcesMap).map(([k, v]) => ({ source: k, count: v }))
      .sort((a, b) => b.count - a.count);

    /* Top referrers (excluyendo direct) */
    const refMap = {};
    for (const v of views || []) {
      if (!v.referrer) continue;
      try {
        const host = new URL(v.referrer).hostname.replace(/^www\./, '');
        refMap[host] = (refMap[host] || 0) + 1;
      } catch { /* skip */ }
    }
    const topReferrers = Object.entries(refMap)
      .map(([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    /* Ventas por tipo de ticket */
    const tipoMap = {};
    for (const t of tickets || []) {
      const k = t.tipo?.nombre || 'Sin tipo';
      tipoMap[k] = tipoMap[k] || { nombre: k, vendidos: 0, ingresos: 0 };
      tipoMap[k].vendidos++;
      tipoMap[k].ingresos += Number(t.precio_pagado) || 0;
    }
    const ventasPorTipo = Object.values(tipoMap).sort((a, b) => b.vendidos - a.vendidos);

    /* Serie diaria: visitas vs ventas por día */
    const dailyMap = {};
    const dayKey = (iso) => iso.slice(0, 10);
    for (let i = 0; i < dias; i++) {
      const d = new Date(Date.now() - (dias - 1 - i) * 24 * 3600 * 1000);
      dailyMap[d.toISOString().slice(0, 10)] = { fecha: d.toISOString().slice(0, 10), visitas: 0, tickets: 0 };
    }
    for (const v of views || []) {
      const k = dayKey(v.created_at);
      if (dailyMap[k]) dailyMap[k].visitas++;
    }
    for (const t of tickets || []) {
      const k = dayKey(t.created_at);
      if (dailyMap[k]) dailyMap[k].tickets++;
    }
    const daily = Object.values(dailyMap);

    res.json({
      rango: { dias, desde },
      resumen: {
        visitas: totalViews,
        visitantes_unicos: uniqueVisitors,
        tickets_total: totalTickets,
        tickets_pagados: ticketsPagados,
        asistencias,
        ingresos,
        conversion: Number(conversion.toFixed(2)),
        tasa_asistencia: Number(tasaAsistencia.toFixed(2)),
      },
      sources,
      top_referrers: topReferrers,
      ventas_por_tipo: ventasPorTipo,
      daily,
    });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

module.exports = router;
