const express = require('express');
const { exige, sesion } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { resolverTicket } = require('../lib/ticketLookup.js');
const { assertPermiso } = require('../lib/acceso.js');
const { otorgarPuntos, reglasPuntosDeEvento } = require('../lib/gamificacion.js');
const { saldoDeTicket, recompensasDisponibles } = require('../lib/saldoTicket.js');
const { COLS_TARJETA } = require('../lib/expositores.js');

/* ── Stands: escanear la escarapela y registrar un MOTIVO ──────────────
   La escarapela impresa lleva el QR del ticket. En cada stand/actividad se
   escanea y se registra por qué: sumar puntos (participó, ganó, compró) o
   dejar constancia de algo negativo (queja, llamado de atención, daño).

   Los puntos cuelgan del TICKET, no de la cuenta: en una convención la
   mayoría compra como invitado (tickets.user_id es null) y points_log exige
   user_id. Si el ticket SÍ tiene cuenta, además se espeja a points_log para
   que el saldo global de fidelidad del organizador también lo vea.
   ──────────────────────────────────────────────────────────────────── */

const router = express.Router();
router.use(verifySupabaseJWT);

/* Gestionar el catálogo requiere editar el evento. */
const PERMS_GESTION = ['editar_evento'];
const PERMS_ESCANEO = ['checkin', 'gestionar_clientes', 'editar_evento'];

function assertGestion(eventoId, userId) {
  return assertPermiso(eventoId, userId, PERMS_GESTION, 'id, owner_id');
}

/* Escanear en un stand: lo hace el personal, mismo permiso que el check-in. */
function assertEscaneo(eventoId, userId) {
  return assertPermiso(eventoId, userId, PERMS_ESCANEO, 'id, owner_id');
}

const err = (res, e) => res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });

/* ───────────── Catálogo de motivos ───────────── */

/* GET /eventos/:eventoId/motivos */
router.get('/:eventoId/motivos', exige(PERMS_ESCANEO), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertEscaneo(eventoId, req.user.id);
    /* Sólo los motivos DEL EVENTO. `evento_motivos` guarda también los de cada
       stand —con `expositor_id`— y sin este filtro el escáner del panel los
       ofrecía todos: el staff podía dar puntos EN NOMBRE de un stand, con su
       motivo y contra su cuota.

       Un stand da sus puntos por su propio enlace (`/expositor/:codigo`), que
       es donde se le identifica. Que el panel pudiera hacerlo por él borra esa
       frontera, y es justo la que separa al evento de un tercero.

       Hoy no había saltado porque no existe ningún motivo de expositor — los
       cinco que hay son del evento. */
    const { data, error } = await supabase
      .from('evento_motivos').select('*')
      .eq('evento_id', eventoId)
      .is('expositor_id', null)
      .order('orden', { ascending: true }).order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ motivos: data || [] });
  } catch (e) { err(res, e); }
});

/* PUT /eventos/:eventoId/motivos — guarda el catálogo completo (diff).
   Body: { motivos: [{ id?, nombre, tipo, puntos, descripcion?, color?, activo? }] }
   Los motivos borrados NO rompen el historial: ticket_interacciones guarda
   una copia del nombre en `motivo_texto` y su FK queda en null. */
router.put('/:eventoId/motivos', exige(PERMS_GESTION), async (req, res) => {
  const { eventoId } = req.params;
  const lista = Array.isArray(req.body.motivos) ? req.body.motivos : [];
  if (lista.length > 60) return res.status(400).json({ error: 'Máximo 60 motivos.' });

  for (const m of lista) {
    if (!m.nombre?.trim()) return res.status(400).json({ error: 'Cada motivo necesita un nombre.' });
    if (!['positivo', 'negativo'].includes(m.tipo)) return res.status(400).json({ error: `Tipo inválido en "${m.nombre}".` });
    if (!Number.isFinite(Number(m.puntos))) return res.status(400).json({ error: `Puntos inválidos en "${m.nombre}".` });
  }

  try {
    await assertGestion(eventoId, req.user.id);

    /* `is('expositor_id', null)` también aquí, y es lo que impide una pérdida
       de datos: este guardado borra TODO lo que no venga en la lista, y la
       lista sale del catálogo del evento. Sin el filtro, guardar un motivo
       desde el panel habría borrado de golpe los motivos de todos los stands
       — que ni siquiera se ven en esta pantalla. */
    const { data: existentes } = await supabase
      .from('evento_motivos').select('id')
      .eq('evento_id', eventoId)
      .is('expositor_id', null);
    const idsExistentes = new Set((existentes || []).map(m => m.id));
    const idsEnviados = new Set(lista.filter(m => m.id && idsExistentes.has(m.id)).map(m => m.id));

    const aBorrar = [...idsExistentes].filter(id => !idsEnviados.has(id));
    if (aBorrar.length) await supabase.from('evento_motivos').delete().in('id', aBorrar);

    for (let i = 0; i < lista.length; i++) {
      const m = lista[i];
      /* Un motivo positivo suma y uno negativo resta, sin importar el signo
         que haya escrito el organizador. */
      const mag = Math.abs(Math.trunc(Number(m.puntos) || 0));
      const puntos = m.tipo === 'negativo' ? -mag : mag;
      const fila = {
        nombre: m.nombre.trim(),
        descripcion: m.descripcion?.trim() || null,
        tipo: m.tipo,
        puntos,
        color: m.color || null,
        icono: m.icono || null,
        activo: m.activo !== false,
        orden: i,
      };
      if (m.id && idsExistentes.has(m.id)) {
        await supabase.from('evento_motivos').update(fila).eq('id', m.id);
      } else {
        await supabase.from('evento_motivos').insert({ ...fila, evento_id: eventoId });
      }
    }

    const { data: final, error: eFinal } = await supabase
      .from('evento_motivos').select('*').eq('evento_id', eventoId)
      .order('orden', { ascending: true });
    /* Relectura después de guardar: vacío aquí dice que se borró lo que se
       acaba de escribir. */
    if (eFinal) console.error(`[motivos] releer los de ${eventoId}: ${eFinal.message}`);
    res.json({ motivos: final || [] });
  } catch (e) { err(res, e); }
});

/* ───────────── Escaneo en stand (staff = cartera del organizador) ───────────── */

/* Solo la cartera del organizador (expositor_id IS NULL). */
async function totalPuntos(ticketId) {
  const { data } = await supabase
    .from('ticket_interacciones').select('puntos').eq('ticket_id', ticketId).is('expositor_id', null);
  return (data || []).reduce((s, r) => s + (r.puntos || 0), 0);
}

/* POST /eventos/:eventoId/interacciones — registra un escaneo con motivo.
   Body: { qr_token | codigo, motivo_id?, puntos?, tipo?, nota?, lugar? }
   Sin motivo_id se puede mandar un registro suelto (puntos + nota). */
router.post('/:eventoId/interacciones', exige(PERMS_ESCANEO), async (req, res) => {
  const { eventoId } = req.params;
  const { qr_token, codigo, motivo_id, nota, lugar } = req.body;
  if (!qr_token && !codigo) return res.status(400).json({ error: 'qr_token o codigo requerido.' });

  try {
    const ev = await assertEscaneo(eventoId, req.user.id);

    const ticket = await resolverTicket(eventoId, { qr_token, codigo });
    if (!ticket) return res.status(404).json({ error: 'Boleta no encontrada.', sound: 'error' });
    if (ticket.evento_id !== eventoId) return res.status(400).json({ error: 'Boleta de otro evento.', sound: 'error' });
    if (ticket.estado === 'invalido' || ticket.estado === 'reembolsado') {
      return res.status(400).json({ error: `Boleta ${ticket.estado}.`, sound: 'error' });
    }

    let motivo = null;
    if (motivo_id) {
      const { data } = await supabase.from('evento_motivos')
        .select('*').eq('id', motivo_id).eq('evento_id', eventoId).maybeSingle();
      if (!data) return res.status(404).json({ error: 'Motivo no encontrado.' });
      if (!data.activo) return res.status(400).json({ error: 'Ese motivo está desactivado.' });
      motivo = data;
    }

    const tipo = motivo ? motivo.tipo : (req.body.tipo === 'negativo' ? 'negativo' : 'positivo');
    let puntos;
    if (motivo) puntos = motivo.puntos;
    else {
      const mag = Math.abs(Math.trunc(Number(req.body.puntos) || 0));
      puntos = tipo === 'negativo' ? -mag : mag;
    }

    const { data: inter, error: eIns } = await supabase
      .from('ticket_interacciones').insert({
        evento_id   : eventoId,
        ticket_id   : ticket.id,
        motivo_id   : motivo?.id || null,
        motivo_texto: motivo?.nombre || (nota ? null : 'Registro manual'),
        tipo,
        puntos,
        nota        : nota?.trim() || null,
        lugar       : lugar?.trim() || null,
        operador_id : req.user.id,
      })
      .select('*').single();
    if (eIns) return res.status(500).json({ error: eIns.message });

    /* Si la boleta pertenece a una cuenta, espeja los puntos POSITIVOS al
       saldo de fidelidad del organizador (points_log/puntos_balance no admiten
       valores que dejen saldo negativo de forma consistente). */
    if (ticket.user_id && puntos > 0 && ev?.owner_id) {
      const reglas = await reglasPuntosDeEvento(eventoId);
      if (reglas.activo) {
        otorgarPuntos({
          userId: ticket.user_id, organizadorId: ev.owner_id, audiencia: 'cliente',
          eventoId, accion: 'stand', puntos,
        });
      }
    }

    const total = await totalPuntos(ticket.id);
    res.status(201).json({
      ok: true,
      sound: tipo === 'negativo' ? 'warn' : 'ok',
      interaccion: inter,
      total_puntos: total,
      ticket: {
        id: ticket.id, codigo: ticket.codigo,
        nombre: ticket.guest_nombre || 'Asistente',
        tipo: ticket.tipo?.nombre || 'General',
      },
    });
  } catch (e) { err(res, e); }
});

/* GET /eventos/:eventoId/interacciones — historial del evento.
   Query: ?ticket_id= &limit= */
router.get('/:eventoId/interacciones', exige(PERMS_ESCANEO), async (req, res) => {
  const { eventoId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  try {
    await assertEscaneo(eventoId, req.user.id);
    let q = supabase.from('ticket_interacciones')
      .select('*, ticket:tickets!ticket_id(codigo, guest_nombre), expositor:networking_expositores!expositor_id(nombre)')
      .eq('evento_id', eventoId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (req.query.ticket_id) q = q.eq('ticket_id', req.query.ticket_id);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ interacciones: data || [] });
  } catch (e) { err(res, e); }
});

/* GET /eventos/:eventoId/expositores/ranking — clasificación de expositores
   por puntos otorgados e interacciones registradas (gamificación por stand). */
router.get('/:eventoId/expositores/ranking', exige(PERMS_ESCANEO), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertEscaneo(eventoId, req.user.id);
    const { data, error } = await supabase.from('ticket_interacciones')
      .select('expositor_id, puntos, tipo')
      .eq('evento_id', eventoId).not('expositor_id', 'is', null);
    if (error) return res.status(500).json({ error: error.message });
    const agg = {};
    for (const r of data || []) {
      const k = r.expositor_id;
      agg[k] = agg[k] || { expositor_id: k, puntos: 0, interacciones: 0 };
      agg[k].puntos += Number(r.puntos || 0);
      agg[k].interacciones += 1;
    }
    const ids = Object.keys(agg);
    const nombres = {};
    if (ids.length) {
      const { data: exps } = await supabase.from('networking_expositores')
        .select(COLS_TARJETA).in('id', ids);
      for (const e of exps || []) nombres[e.id] = e;
    }
    const ranking = Object.values(agg)
      .map(a => ({ ...a, nombre: nombres[a.expositor_id]?.nombre || 'Expositor', logo_url: nombres[a.expositor_id]?.logo_url || null, stand: nombres[a.expositor_id]?.stand || null, zona_id: nombres[a.expositor_id]?.zona_id || null }))
      .sort((x, y) => y.puntos - x.puntos || y.interacciones - x.interacciones);
    res.json({ ranking });
  } catch (e) { err(res, e); }
});

/* DELETE /eventos/:eventoId/interacciones/:id — deshacer un registro
   (un escaneo equivocado no debe quedar pesando en el saldo). */
router.delete('/:eventoId/interacciones/:id', exige(PERMS_GESTION), async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await assertGestion(eventoId, req.user.id);
    const { error } = await supabase.from('ticket_interacciones')
      .delete().eq('id', id).eq('evento_id', eventoId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) { err(res, e); }
});

/* ───────────── Canje contra la boleta (mismo QR) ───────────── */

function codigoCanje() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 8; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

/* POST /eventos/:eventoId/canje/saldo { qr_token | codigo }
   Escanea la escarapela y devuelve saldo + qué puede llevarse. Por POST y no
   por GET: el qr_token quedaría escrito en los logs de acceso del servidor. */
router.post('/:eventoId/canje/saldo', exige(PERMS_ESCANEO), async (req, res) => {
  const { eventoId } = req.params;
  try {
    const ev = await assertEscaneo(eventoId, req.user.id);
    const ticket = await resolverTicket(eventoId, { qr_token: req.body?.qr_token, codigo: req.body?.codigo });
    if (!ticket) return res.status(404).json({ error: 'Boleta no encontrada.', sound: 'error' });

    const saldo = await saldoDeTicket(ticket, { organizadorId: ev.owner_id, eventoId });
    const recompensas = await recompensasDisponibles(ev.owner_id, eventoId);
    res.json({
      ticket: { id: ticket.id, codigo: ticket.codigo, nombre: ticket.guest_nombre || 'Asistente', tipo: ticket.tipo?.nombre || 'General' },
      ...saldo,
      recompensas: recompensas.map(r => ({ ...r, alcanzable: !r.agotada && saldo.saldo >= r.costo_puntos })),
    });
  } catch (e) { err(res, e); }
});

/* POST /eventos/:eventoId/canje — entrega una recompensa contra la boleta.
   Body: { qr_token | codigo, recompensa_id } */
router.post('/:eventoId/canje', exige(PERMS_ESCANEO), async (req, res) => {
  const { eventoId } = req.params;
  const { qr_token, codigo, recompensa_id } = req.body;
  if (!recompensa_id) return res.status(400).json({ error: 'recompensa_id requerido.' });

  try {
    const ev = await assertEscaneo(eventoId, req.user.id);
    const ticket = await resolverTicket(eventoId, { qr_token, codigo });
    if (!ticket) return res.status(404).json({ error: 'Boleta no encontrada.', sound: 'error' });

    const { data: r } = await supabase
      .from('recompensas').select('*').eq('id', recompensa_id).eq('organizador_id', ev.owner_id).maybeSingle();
    if (!r) return res.status(404).json({ error: 'Recompensa no encontrada.' });
    if (!r.activo) return res.status(400).json({ error: 'Esa recompensa está desactivada.' });
    /* Una recompensa de otro evento no se puede entregar aquí. */
    if (r.evento_id && r.evento_id !== eventoId) {
      return res.status(400).json({ error: 'Esa recompensa es de otro evento.' });
    }
    if (r.stock != null && r.canjeados >= r.stock) {
      return res.status(400).json({ error: 'Recompensa agotada.', sound: 'error' });
    }

    const saldo = await saldoDeTicket(ticket, { organizadorId: ev.owner_id, eventoId });
    if (saldo.saldo < r.costo_puntos) {
      return res.status(400).json({
        error: `Le faltan ${r.costo_puntos - saldo.saldo} puntos.`, sound: 'error', ...saldo,
      });
    }

    const codigoNuevo = codigoCanje();
    const { data: canje, error: eIns } = await supabase.from('canjes').insert({
      user_id       : ticket.user_id || null,
      ticket_id     : ticket.id,
      evento_id     : eventoId,
      organizador_id: ev.owner_id,
      recompensa_id : r.id,
      audiencia     : 'cliente',
      titulo        : r.titulo,
      costo_puntos  : r.costo_puntos,
      codigo        : codigoNuevo,
      estado        : 'entregado',
      entregado_at  : new Date().toISOString(),
    }).select('*').single();
    if (eIns) return res.status(500).json({ error: eIns.message });

    await supabase.from('recompensas')
      .update({ canjeados: (r.canjeados || 0) + 1 }).eq('id', r.id);

    const despues = await saldoDeTicket(ticket, { organizadorId: ev.owner_id, eventoId });
    res.status(201).json({
      ok: true, sound: 'ok', canje,
      ticket: { id: ticket.id, codigo: ticket.codigo, nombre: ticket.guest_nombre || 'Asistente' },
      ...despues,
    });
  } catch (e) { err(res, e); }
});

module.exports = router;
