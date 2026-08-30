const express = require('express');
const { exige, sesion } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* Owner o miembro con permiso 'ver_analytics'. */
const PERMS_ANALYTICS = ['ver_analytics'];

function assertOwner(eventoId, userId) {
  return assertPermiso(eventoId, userId, PERMS_ANALYTICS, 'id, owner_id');
}

/* GET /eventos/:eventoId/analytics — métricas agregadas del evento.
   Query: ?dias=30 (default). */
router.get('/:eventoId/analytics', exige(PERMS_ANALYTICS), async (req, res) => {
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
      .select('id, estado, precio_pagado, created_at, checked_in_at, ticket_type_id, tipo:ticket_types!ticket_type_id(nombre)')
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
      tipoMap[k] = tipoMap[k] || { nombre: k, vendidos: 0, ingresos: 0, ingresaron: 0 };
      tipoMap[k].vendidos++;
      tipoMap[k].ingresos += Number(t.precio_pagado) || 0;
      /* Vender y que la persona aparezca son dos cosas distintas, y la
         diferencia entre las dos es lo que de verdad se quiere saber después
         del evento. Con `vendidos` a secas, una boleta que nadie usó se ve
         igual de bien que una que llenó la sala. */
      if (t.checked_in_at) tipoMap[k].ingresaron++;
    }
    const ventasPorTipo = Object.values(tipoMap)
      .map(t => ({ ...t, asistencia: t.vendidos ? Number(((t.ingresaron / t.vendidos) * 100).toFixed(1)) : 0 }))
      .sort((a, b) => b.vendidos - a.vendidos);

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

    /* ── Participación: quién fue a qué, dentro del evento ──────────────
       El resumen dice cuánta gente entró; esto dice qué hicieron una vez
       dentro. Es lo que se pide después para reportar: cuántos pasaron por
       cada taller y cuántos compitieron en cada torneo.

       Best-effort a propósito: si falta una migración o una tabla, el reporte
       sale sin este bloque en vez de no salir. Un reporte incompleto sirve;
       uno que revienta, no. */
    let participacion = { sub_eventos: [], torneos: [] };
    try {
      const [{ data: sesiones }, { data: inscripciones }, { data: torneos }] = await Promise.all([
        supabase.from('agenda_sessions')
          .select('id, titulo, inicio, cupo, requiere_inscripcion, torneo_id')
          .eq('evento_id', eventoId).order('inicio', { ascending: true }),
        supabase.from('sesion_inscripciones')
          .select('session_id, ticket_id, asistio_at').eq('evento_id', eventoId),
        supabase.from('torneos').select('id, nombre').eq('evento_id', eventoId),
      ]);

      /* Los equipos se piden POR TORNEO, no por evento: `torneo_equipos` no
         tiene `evento_id`, sólo `torneo_id`. Filtrar por una columna que no
         existe habría devuelto error, el try lo habría tragado, y cada torneo
         saldría con cero equipos sin que nada lo dijera. */
      const idsTorneos = (torneos || []).map(t => t.id);
      const { data: equipos } = idsTorneos.length
        ? await supabase.from('torneo_equipos').select('id, torneo_id').in('torneo_id', idsTorneos)
        : { data: [] };

      const porSesion = {};
      for (const i of inscripciones || []) {
        porSesion[i.session_id] = porSesion[i.session_id] || { total: 0, con_boleta: 0, asistieron: 0 };
        porSesion[i.session_id].total++;
        if (i.ticket_id) porSesion[i.session_id].con_boleta++;
        /* Apuntarse y aparecer no es lo mismo, y en un taller con cupo la
           diferencia es lo que decide si el año que viene se abren más plazas
           o menos. */
        if (i.asistio_at) porSesion[i.session_id].asistieron++;
      }

      participacion.sub_eventos = (sesiones || [])
        .filter(s => s.requiere_inscripcion)
        .map(s => {
          const u = porSesion[s.id] || { total: 0, con_boleta: 0, asistieron: 0 };
          return {
            id: s.id, titulo: s.titulo, inicio: s.inicio, cupo: s.cupo,
            inscritos: u.total,
            /* Cuántos venían ya con entrada al evento. Los que no, entraron
               directos al taller: es el dato que dice si el sub-evento atrae
               gente nueva o sólo reparte a la que ya estaba. */
            con_boleta: u.con_boleta,
            asistieron: u.asistieron,
            ocupacion: s.cupo ? Number(((u.total / s.cupo) * 100).toFixed(1)) : null,
          };
        });

      const porTorneo = {};
      for (const e of equipos || []) porTorneo[e.torneo_id] = (porTorneo[e.torneo_id] || 0) + 1;
      participacion.torneos = (torneos || []).map(t => ({
        id: t.id, nombre: t.nombre, equipos: porTorneo[t.id] || 0,
      }));
    } catch { /* sin estas tablas, el reporte sale igual */ }

    res.json({
      rango: { dias, desde },
      participacion,
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
