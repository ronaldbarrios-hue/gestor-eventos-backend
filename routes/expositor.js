const express = require('express');
const supabase = require('../lib/supabase.js');
const { resolverTicket, codigoCanje } = require('../lib/ticketLookup.js');
const { saldoDeTicket, recompensasDeExpositor } = require('../lib/saldoTicket.js');

/* ── Panel del EXPOSITOR (empresa con boleta-Stand) ──────────────────
   La empresa se autentica con el CÓDIGO de su boleta-Stand (igual que el
   asistente en /mi-ticket). Todo va scopeado a SU ficha: nunca puede tocar
   datos de otro expositor ni del evento. El backend usa service key, así que
   la autorización es 100% en código: se FUERZA el expositor_id derivado del
   código y se ignora cualquier id que venga del cliente.

   Puntos/premios del expositor son una CARTERA APARTE (expositor_id set); no
   tocan el saldo del organizador ni se espejan a la fidelidad global. */

const router = express.Router();

/* Middleware: resuelve :codigo → ficha del expositor. */
async function cargarExpositor(req, res, next) {
  const cod = String(req.params.codigo || '').toUpperCase().trim();
  if (cod.length < 4) return res.status(400).json({ error: 'Código inválido.' });
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, evento_id, estado, guest_nombre, guest_email, ticket_type_id, tipo:ticket_types!ticket_type_id(nombre, es_expositor)')
    .eq('codigo', cod).maybeSingle();
  if (!ticket) return res.status(404).json({ error: 'Boleta no encontrada.' });
  if (!ticket.tipo?.es_expositor) return res.status(403).json({ error: 'Esta boleta no es de expositor.' });
  if (ticket.estado !== 'pagado' && ticket.estado !== 'usado') {
    return res.status(403).json({ error: 'Tu stand aún no está confirmado.' });
  }
  const { data: ficha } = await supabase
    .from('networking_expositores').select('*').eq('ticket_id', ticket.id).maybeSingle();
  if (!ficha) return res.status(409).json({ error: 'Tu ficha aún no está lista. Espera unos segundos.' });
  if (ficha.activo === false) return res.status(403).json({ error: 'Este stand está desactivado.' });

  const { data: ev } = await supabase
    .from('eventos').select('owner_id').eq('id', ticket.evento_id).maybeSingle();

  req.expositor = { fichaId: ficha.id, eventoId: ticket.evento_id, ticketId: ticket.id, ownerId: ev?.owner_id || null, ficha };
  next();
}

const err = (res, e) => res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });

/* ───────────── Panel (bootstrap) ───────────── */
router.get('/:codigo/panel', cargarExpositor, async (req, res) => {
  const { fichaId, eventoId, ficha } = req.expositor;
  const { data: motivos } = await supabase
    .from('evento_motivos').select('*').eq('expositor_id', fichaId).order('orden', { ascending: true });
  const recompensas = await recompensasDeExpositor(fichaId);
  const { data: franjas } = await supabase
    .from('agenda_sessions').select('*').eq('expositor_id', fichaId).order('inicio', { ascending: true });
  const { data: evento } = await supabase
    .from('eventos').select('id, slug, titulo, fecha_inicio, fecha_fin, timezone').eq('id', eventoId).maybeSingle();

  /* Cuánto ha repartido y cuánto le queda. Sin esto el expositor solo se entera
     de que tiene tope cuando se lo come, en mitad del evento y con alguien
     esperando delante. Si la 0057 no está aplicada, `cuota` va en null y el
     portal simplemente no muestra el contador. */
  const { data: cuota } = await supabase
    .from('v_consumo_puntos_stand')
    .select('cuota_puntos, otorgados, veces, asistentes_distintos, disponibles')
    .eq('expositor_id', fichaId).maybeSingle();

  res.json({
    ficha, evento, motivos: motivos || [], recompensas, franjas: franjas || [],
    cuota: cuota || null,
  });
});

/* ───────────── Motivos propios ───────────── */
router.put('/:codigo/motivos', cargarExpositor, async (req, res) => {
  const { fichaId, eventoId } = req.expositor;
  const lista = Array.isArray(req.body.motivos) ? req.body.motivos : [];
  if (lista.length > 40) return res.status(400).json({ error: 'Máximo 40 motivos.' });
  for (const m of lista) {
    if (!m.nombre?.trim()) return res.status(400).json({ error: 'Cada motivo necesita un nombre.' });
  }

  const { data: existentes } = await supabase
    .from('evento_motivos').select('id').eq('expositor_id', fichaId);
  const ids = new Set((existentes || []).map(m => m.id));
  const enviados = new Set(lista.filter(m => m.id && ids.has(m.id)).map(m => m.id));
  const aBorrar = [...ids].filter(id => !enviados.has(id));
  if (aBorrar.length) await supabase.from('evento_motivos').delete().in('id', aBorrar).eq('expositor_id', fichaId);

  for (let i = 0; i < lista.length; i++) {
    const m = lista[i];
    /* Los motivos del expositor SOLO suman (no puede penalizar a un visitante). */
    const puntos = Math.abs(Math.trunc(Number(m.puntos) || 0));
    const fila = { nombre: m.nombre.trim(), descripcion: m.descripcion?.trim() || null,
      tipo: 'positivo', puntos, activo: m.activo !== false, orden: i };
    if (m.id && ids.has(m.id)) {
      await supabase.from('evento_motivos').update(fila).eq('id', m.id).eq('expositor_id', fichaId);
    } else {
      await supabase.from('evento_motivos').insert({ ...fila, evento_id: eventoId, expositor_id: fichaId });
    }
  }
  const { data: final } = await supabase
    .from('evento_motivos').select('*').eq('expositor_id', fichaId).order('orden', { ascending: true });
  res.json({ motivos: final || [] });
});

/* Tope de puntos por escaneo que fija el organizador (page_json.puntos.tope_expositor). */
async function topeExpositor(eventoId) {
  const { data } = await supabase.from('eventos').select('page_json').eq('id', eventoId).maybeSingle();
  const t = Number(data?.page_json?.puntos?.tope_expositor);
  return Number.isFinite(t) && t > 0 ? Math.floor(t) : 500;
}

/* ───────────── Dar puntos (escaneo del expositor) ───────────── */
router.post('/:codigo/interacciones', cargarExpositor, async (req, res) => {
  const { fichaId, eventoId } = req.expositor;
  const { qr_token, codigo: codAsistente, motivo_id, nota } = req.body;
  if (!qr_token && !codAsistente) return res.status(400).json({ error: 'Escanea o escribe el código del asistente.' });
  if (!motivo_id) return res.status(400).json({ error: 'Elige un motivo.' });

  try {
    /* El motivo DEBE ser de este expositor (evita usar los de otro o del evento). */
    const { data: motivo } = await supabase
      .from('evento_motivos').select('*').eq('id', motivo_id).eq('expositor_id', fichaId).maybeSingle();
    if (!motivo) return res.status(404).json({ error: 'Motivo no encontrado.' });
    if (!motivo.activo) return res.status(400).json({ error: 'Ese motivo está desactivado.' });

    const ticket = await resolverTicket(eventoId, { qr_token, codigo: codAsistente });
    if (!ticket) return res.status(404).json({ error: 'Boleta no encontrada.', sound: 'error' });
    if (ticket.id === req.expositor.ticketId) return res.status(400).json({ error: 'No puedes darte puntos a ti mismo.', sound: 'error' });
    if (ticket.estado === 'invalido' || ticket.estado === 'reembolsado') {
      return res.status(400).json({ error: `Boleta ${ticket.estado}.`, sound: 'error' });
    }

    /* Anti-fraude 1: tope de puntos por escaneo que fija el organizador. */
    const tope = await topeExpositor(eventoId);
    const puntos = Math.min(Math.abs(motivo.puntos), tope);

    /* Anti-fraude 2: cooldown — el mismo motivo al mismo asistente no se repite
       en 60s (evita doble-escaneo accidental y farmeo por spam de cámara). */
    const hace60 = new Date(Date.now() - 60000).toISOString();
    const { data: reciente } = await supabase
      .from('ticket_interacciones').select('id')
      .eq('expositor_id', fichaId).eq('ticket_id', ticket.id).eq('motivo_id', motivo.id)
      .gte('created_at', hace60).maybeSingle();
    if (reciente) return res.status(409).json({ error: 'Ya registraste esto hace un momento.', sound: 'warn' });

    const { data: inter, error: eIns } = await supabase
      .from('ticket_interacciones').insert({
        evento_id: eventoId, ticket_id: ticket.id, motivo_id: motivo.id,
        motivo_texto: motivo.nombre, tipo: 'positivo', puntos,
        nota: nota?.trim() || null, lugar: req.expositor.ficha.nombre,
        expositor_id: fichaId, operador_id: null,
      }).select('*').single();

    if (eIns) {
      /* El tope de la bolsa lo aplica un trigger (migración 0057), así que el
         error llega como una excepción de Postgres. Se traduce a algo que el
         expositor pueda entender: verá "cuota agotada", no un mensaje de la
         base de datos. */
      if (String(eIns.message || '').includes('CUOTA_STAND_AGOTADA')) {
        const { data: estado } = await supabase
          .from('v_consumo_puntos_stand')
          .select('cuota_puntos, otorgados, disponibles')
          .eq('expositor_id', fichaId).maybeSingle();
        return res.status(409).json({
          error: estado
            ? `Se agotó tu cuota de puntos: repartiste ${estado.otorgados} de ${estado.cuota_puntos}. Habla con la organización para que te asigne más.`
            : 'Se agotó tu cuota de puntos. Habla con la organización.',
          cuota_agotada: true,
          cuota: estado || null,
          sound: 'warn',
        });
      }
      return res.status(500).json({ error: eIns.message });
    }

    const saldo = await saldoDeTicket(ticket, { organizadorId: req.expositor.ownerId, eventoId, expositorId: fichaId });
    res.status(201).json({
      ok: true, sound: 'ok', interaccion: inter, total_puntos: saldo.saldo,
      ticket: { id: ticket.id, codigo: ticket.codigo, nombre: ticket.guest_nombre || 'Asistente', tipo: ticket.tipo?.nombre || 'General' },
    });
  } catch (e) { err(res, e); }
});

/* Historial de lo que ESTE expositor otorgó. */
router.get('/:codigo/interacciones', cargarExpositor, async (req, res) => {
  const { data } = await supabase
    .from('ticket_interacciones')
    .select('*, ticket:tickets!ticket_id(codigo, guest_nombre)')
    .eq('expositor_id', req.expositor.fichaId)
    .order('created_at', { ascending: false }).limit(100);
  res.json({ interacciones: data || [] });
});

/* ───────────── Premios propios ───────────── */
router.get('/:codigo/recompensas', cargarExpositor, async (req, res) => {
  const { data } = await supabase
    .from('recompensas').select('*').eq('expositor_id', req.expositor.fichaId)
    .order('costo_puntos', { ascending: true });
  res.json({ recompensas: data || [] });
});

router.put('/:codigo/recompensas', cargarExpositor, async (req, res) => {
  const { fichaId, eventoId, ownerId } = req.expositor;
  const lista = Array.isArray(req.body.recompensas) ? req.body.recompensas : [];
  if (lista.length > 40) return res.status(400).json({ error: 'Máximo 40 premios.' });
  for (const r of lista) {
    if (!r.titulo?.trim()) return res.status(400).json({ error: 'Cada premio necesita un título.' });
    if (!Number.isFinite(Number(r.costo_puntos)) || Number(r.costo_puntos) < 0) {
      return res.status(400).json({ error: `Costo inválido en "${r.titulo}".` });
    }
  }

  const { data: existentes } = await supabase
    .from('recompensas').select('id').eq('expositor_id', fichaId);
  const ids = new Set((existentes || []).map(r => r.id));
  const enviados = new Set(lista.filter(r => r.id && ids.has(r.id)).map(r => r.id));
  const aBorrar = [...ids].filter(id => !enviados.has(id));
  if (aBorrar.length) await supabase.from('recompensas').delete().in('id', aBorrar).eq('expositor_id', fichaId);

  for (const r of lista) {
    const fila = {
      titulo: r.titulo.trim(), descripcion: r.descripcion?.trim() || null,
      costo_puntos: Math.trunc(Number(r.costo_puntos)),
      stock: r.stock === '' || r.stock == null ? null : Math.trunc(Number(r.stock)),
      activo: r.activo !== false,
    };
    if (r.id && ids.has(r.id)) {
      await supabase.from('recompensas').update(fila).eq('id', r.id).eq('expositor_id', fichaId);
    } else {
      await supabase.from('recompensas').insert({
        ...fila, organizador_id: ownerId, evento_id: eventoId, expositor_id: fichaId,
        audiencia: 'cliente', canjeados: 0,
      });
    }
  }
  const { data: final } = await supabase
    .from('recompensas').select('*').eq('expositor_id', fichaId).order('costo_puntos', { ascending: true });
  res.json({ recompensas: final || [] });
});

/* ───────────── Canje contra la cartera del expositor ───────────── */
router.get('/:codigo/canje/saldo', cargarExpositor, async (req, res) => {
  const { fichaId, eventoId, ownerId } = req.expositor;
  try {
    const ticket = await resolverTicket(eventoId, { qr_token: req.query.qr_token, codigo: req.query.codigo });
    if (!ticket) return res.status(404).json({ error: 'Boleta no encontrada.', sound: 'error' });
    const saldo = await saldoDeTicket(ticket, { organizadorId: ownerId, eventoId, expositorId: fichaId });
    const recompensas = await recompensasDeExpositor(fichaId);
    res.json({
      ticket: { id: ticket.id, codigo: ticket.codigo, nombre: ticket.guest_nombre || 'Asistente', tipo: ticket.tipo?.nombre || 'General' },
      ...saldo,
      recompensas: recompensas.map(r => ({ ...r, alcanzable: !r.agotada && saldo.saldo >= r.costo_puntos })),
    });
  } catch (e) { err(res, e); }
});

router.post('/:codigo/canje', cargarExpositor, async (req, res) => {
  const { fichaId, eventoId, ownerId } = req.expositor;
  const { qr_token, codigo: codAsistente, recompensa_id } = req.body;
  if (!recompensa_id) return res.status(400).json({ error: 'recompensa_id requerido.' });
  try {
    const ticket = await resolverTicket(eventoId, { qr_token, codigo: codAsistente });
    if (!ticket) return res.status(404).json({ error: 'Boleta no encontrada.', sound: 'error' });

    /* El premio DEBE ser de este expositor. */
    const { data: r } = await supabase
      .from('recompensas').select('*').eq('id', recompensa_id).eq('expositor_id', fichaId).maybeSingle();
    if (!r) return res.status(404).json({ error: 'Premio no encontrado.' });
    if (!r.activo) return res.status(400).json({ error: 'Ese premio está desactivado.' });
    if (r.stock != null && r.canjeados >= r.stock) return res.status(400).json({ error: 'Premio agotado.', sound: 'error' });

    const saldo = await saldoDeTicket(ticket, { organizadorId: ownerId, eventoId, expositorId: fichaId });
    if (saldo.saldo < r.costo_puntos) {
      return res.status(400).json({ error: `Le faltan ${r.costo_puntos - saldo.saldo} puntos.`, sound: 'error', ...saldo });
    }

    const { data: canje, error: eIns } = await supabase.from('canjes').insert({
      user_id: ticket.user_id || null, ticket_id: ticket.id, evento_id: eventoId,
      organizador_id: ownerId, recompensa_id: r.id, expositor_id: fichaId,
      audiencia: 'cliente', titulo: r.titulo, costo_puntos: r.costo_puntos,
      codigo: codigoCanje(), estado: 'entregado', entregado_at: new Date().toISOString(),
    }).select('*').single();
    if (eIns) return res.status(500).json({ error: eIns.message });

    await supabase.from('recompensas').update({ canjeados: (r.canjeados || 0) + 1 }).eq('id', r.id);
    const despues = await saldoDeTicket(ticket, { organizadorId: ownerId, eventoId, expositorId: fichaId });
    res.status(201).json({ ok: true, sound: 'ok', canje, ...despues,
      ticket: { id: ticket.id, codigo: ticket.codigo, nombre: ticket.guest_nombre || 'Asistente' } });
  } catch (e) { err(res, e); }
});

/* ───────────── Franjas del cronograma ───────────── */
router.get('/:codigo/franjas', cargarExpositor, async (req, res) => {
  const { data } = await supabase
    .from('agenda_sessions').select('*').eq('expositor_id', req.expositor.fichaId)
    .order('inicio', { ascending: true });
  res.json({ franjas: data || [] });
});

router.post('/:codigo/franjas', cargarExpositor, async (req, res) => {
  const { fichaId, eventoId } = req.expositor;
  const { titulo, descripcion, inicio, fin, ubicacion } = req.body;
  if (!titulo?.trim()) return res.status(400).json({ error: 'Título requerido.' });
  if (!inicio) return res.status(400).json({ error: 'Hora de inicio requerida.' });

  /* Tope para que un expositor no llene el cronograma. */
  const { count } = await supabase.from('agenda_sessions')
    .select('id', { count: 'exact', head: true }).eq('expositor_id', fichaId);
  if ((count || 0) >= 20) return res.status(400).json({ error: 'Máximo 20 franjas.' });

  const { data, error } = await supabase.from('agenda_sessions').insert({
    evento_id: eventoId, expositor_id: fichaId, tipo: 'stand',
    titulo: titulo.trim(), descripcion: descripcion || null,
    inicio, fin: fin || null, ubicacion: ubicacion || req.expositor.ficha.stand || null,
    track: req.expositor.ficha.nombre,
    moderacion: 'pendiente',   // el organizador la aprueba antes de que sea pública
  }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ franja: data });
});

router.patch('/:codigo/franjas/:id', cargarExpositor, async (req, res) => {
  const allowed = ['titulo', 'descripcion', 'inicio', 'fin', 'ubicacion'];
  const updates = {};
  for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios.' });
  /* Filtro por expositor_id: no puede tocar franjas de otro ni del organizador. */
  const { data, error } = await supabase.from('agenda_sessions')
    .update(updates).eq('id', req.params.id).eq('expositor_id', req.expositor.fichaId)
    .select('*').maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Franja no encontrada.' });
  res.json({ franja: data });
});

router.delete('/:codigo/franjas/:id', cargarExpositor, async (req, res) => {
  const { error } = await supabase.from('agenda_sessions')
    .delete().eq('id', req.params.id).eq('expositor_id', req.expositor.fichaId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
