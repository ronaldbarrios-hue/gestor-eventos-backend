const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { verifyTicketQR, signTicketQR } = require('../lib/qr.js');
const { otorgarPuntos, otorgarBadge } = require('../lib/gamificacion.js');
const { dispatch } = require('../lib/webhooks.js');
const { assertPermiso } = require('../lib/acceso.js');

function generarCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const router = express.Router();
router.use(verifySupabaseJWT);

/* Owner o miembro con permiso. Por defecto 'gestionar_clientes'
   (editar/importar); el listado acepta también 'ver_clientes'. */
function assertOwner(eventoId, userId, perms = ['gestionar_clientes']) {
  return assertPermiso(eventoId, userId, perms, 'id, owner_id');
}

/* Verifica que el usuario es owner O miembro con permiso 'checkin'. */
async function assertCheckinAccess(eventoId, userId) {
  const { data: ev } = await supabase
    .from('eventos').select('id, owner_id').eq('id', eventoId).maybeSingle();
  if (!ev) throw new Error('Evento no encontrado.');
  if (ev.owner_id === userId) return ev;

  const { data: m } = await supabase
    .from('event_members')
    .select('id, rol_detail:event_roles!rol_id(permissions)')
    .eq('evento_id', eventoId).eq('user_id', userId).eq('status', 'active')
    .maybeSingle();
  const permisos = m?.rol_detail?.permissions || [];
  if (!permisos.includes('checkin')) throw new Error('No autorizado.');
  return ev;
}

/* GET /eventos/:eventoId/clientes — listar tickets emitidos del evento */
router.get('/:eventoId/clientes', async (req, res) => {
  const { eventoId } = req.params;
  const { q, estado, ticket_type_id, limit = 100, page = 1 } = req.query;
  const desde = (Number(page) - 1) * Number(limit);
  const hasta = desde + Number(limit) - 1;

  try {
    await assertOwner(eventoId, req.user.id, ['ver_clientes', 'gestionar_clientes']);

    let query = supabase
      .from('tickets')
      .select(`
        id, codigo, estado, precio_pagado, pagado_at, checked_in_at, zona_usada, created_at,
        guest_email, guest_nombre,
        usuario:profiles!user_id(id, nombre, email, avatar_url),
        tipo:ticket_types!ticket_type_id(id, nombre, precio, currency)
      `, { count: 'exact' })
      .eq('evento_id', eventoId)
      .order('created_at', { ascending: false })
      .range(desde, hasta);

    if (estado)         query = query.eq('estado', estado);
    if (ticket_type_id) query = query.eq('ticket_type_id', ticket_type_id);
    if (q) {
      /* Búsqueda en email o nombre del invitado */
      query = query.or(`guest_email.ilike.%${q}%,guest_nombre.ilike.%${q}%,codigo.ilike.%${q}%`);
    }

    const { data, count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    /* Stats agregados */
    const { data: all } = await supabase
      .from('tickets').select('estado, precio_pagado').eq('evento_id', eventoId);

    const stats = (all || []).reduce((acc, t) => {
      acc.total++;
      acc[t.estado] = (acc[t.estado] || 0) + 1;
      acc.ingresos += Number(t.precio_pagado) || 0;
      return acc;
    }, { total: 0, ingresos: 0 });

    res.json({
      clientes: data || [],
      total: count ?? 0,
      stats,
    });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* PATCH /eventos/:eventoId/clientes/:ticketId — cambiar estado (anular, marcar pagado, etc) */
router.patch('/:eventoId/clientes/:ticketId', async (req, res) => {
  const { eventoId, ticketId } = req.params;
  const ESTADOS = ['emitido', 'pagado', 'usado', 'reembolsado', 'invalido'];
  const { estado } = req.body;
  if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido.' });

  try {
    await assertOwner(eventoId, req.user.id);
    const { data, error } = await supabase
      .from('tickets').update({ estado })
      .eq('id', ticketId).eq('evento_id', eventoId)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ticket: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/clientes/importar — import masivo desde CSV.
   Body: { ticket_type_id, marcar_pagado, rows: [{ nombre, email, telefono? }] }
   Crea N tickets en estado 'pagado' (si marcar_pagado=true) o 'emitido'.
   Genera codigo + qr_token para cada uno. Reporta éxitos y errores fila por fila. */
router.post('/:eventoId/clientes/importar', async (req, res) => {
  const { eventoId } = req.params;
  const { ticket_type_id, marcar_pagado, rows } = req.body;

  if (!ticket_type_id) return res.status(400).json({ error: 'Selecciona el tipo de boleta para los importados.' });
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'No hay filas para importar.' });
  if (rows.length > 1000) return res.status(400).json({ error: 'Máximo 1000 filas por import. Divide el archivo.' });

  try {
    await assertOwner(eventoId, req.user.id);

    const { data: tipo, error: et } = await supabase
      .from('ticket_types').select('*').eq('id', ticket_type_id).eq('evento_id', eventoId).maybeSingle();
    if (et) return res.status(500).json({ error: et.message });
    if (!tipo) return res.status(404).json({ error: 'Tipo de boleta no encontrado.' });

    /* Emails ya existentes para no duplicar */
    const emails = rows.map(r => (r.email || '').toLowerCase().trim()).filter(Boolean);
    const { data: existentes } = await supabase
      .from('tickets').select('guest_email')
      .eq('evento_id', eventoId)
      .in('guest_email', emails);
    const dup = new Set((existentes || []).map(r => r.guest_email));

    const ok = [];
    const errores = [];
    const estado = marcar_pagado ? 'pagado' : 'emitido';
    const precio_efectivo = marcar_pagado ? Number(tipo.precio) : null;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const email = (r.email || '').toLowerCase().trim();
      const nombre = (r.nombre || '').trim();
      if (!email || !email.includes('@')) { errores.push({ fila: i + 1, motivo: 'Email inválido.', row: r }); continue; }
      if (!nombre)                         { errores.push({ fila: i + 1, motivo: 'Nombre vacío.',    row: r }); continue; }
      if (dup.has(email))                  { errores.push({ fila: i + 1, motivo: 'Ya existe ticket con ese email.', row: r }); continue; }

      const codigo = generarCodigo();
      const { data: ticket, error: ei } = await supabase
        .from('tickets').insert({
          evento_id: eventoId,
          ticket_type_id: tipo.id,
          guest_email: email,
          guest_nombre: nombre,
          codigo,
          estado,
          precio_pagado: precio_efectivo,
          pagado_at: marcar_pagado ? new Date().toISOString() : null,
        }).select('id, codigo').single();
      if (ei) { errores.push({ fila: i + 1, motivo: ei.message, row: r }); continue; }

      const qr_token = signTicketQR({ ticket_id: ticket.id, evento_id: eventoId, codigo: ticket.codigo });
      await supabase.from('tickets').update({ qr_token }).eq('id', ticket.id);
      dup.add(email);
      ok.push({ fila: i + 1, codigo, email });
    }

    /* Bumpear contadores best-effort */
    if (ok.length > 0) {
      await supabase.from('ticket_types').update({ vendidos: (tipo.vendidos || 0) + ok.length }).eq('id', tipo.id);
      if (marcar_pagado) {
        const { data: ev } = await supabase.from('eventos').select('aforo_vendido').eq('id', eventoId).single();
        if (ev) await supabase.from('eventos').update({ aforo_vendido: (ev.aforo_vendido || 0) + ok.length }).eq('id', eventoId);
      }
    }

    res.json({ creados: ok.length, errores, ok });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/checkin — validar QR o código y marcar 'usado'.
   Body: { qr_token } o { codigo }
   Owner siempre puede. Miembros del equipo necesitan permiso 'checkin'. */
router.post('/:eventoId/checkin', async (req, res) => {
  const { eventoId } = req.params;
  const { qr_token, codigo } = req.body;
  if (!qr_token && !codigo) return res.status(400).json({ error: 'qr_token o codigo requerido.' });

  try {
    const evCtx = await assertCheckinAccess(eventoId, req.user.id);

    /* Resolver el ticket: por qr_token (verificar firma) o por código corto */
    let ticketQuery;
    if (qr_token) {
      const r = verifyTicketQR(qr_token);
      if (!r.ok) return res.status(400).json({ error: 'QR inválido.', detalle: r.error });
      if (r.evento_id !== eventoId) return res.status(400).json({ error: 'Este QR es de otro evento.' });
      ticketQuery = supabase.from('tickets').select(`*, tipo:ticket_types!ticket_type_id(nombre)`).eq('id', r.ticket_id).maybeSingle();
    } else {
      ticketQuery = supabase.from('tickets').select(`*, tipo:ticket_types!ticket_type_id(nombre)`).eq('codigo', codigo.toUpperCase().trim()).eq('evento_id', eventoId).maybeSingle();
    }

    const { data: ticket, error: e1 } = await ticketQuery;
    if (e1) return res.status(500).json({ error: e1.message });
    if (!ticket) return res.status(404).json({ error: 'Boleta no encontrada.', sound: 'error' });
    if (ticket.evento_id !== eventoId) return res.status(400).json({ error: 'Boleta de otro evento.', sound: 'error' });

    /* Reglas */
    if (ticket.estado === 'invalido' || ticket.estado === 'reembolsado') {
      return res.status(400).json({ error: `Boleta ${ticket.estado}.`, ticket, sound: 'error' });
    }
    if (ticket.estado === 'usado') {
      return res.status(409).json({
        error: 'Esta boleta ya fue usada.',
        ticket,
        sound: 'error',
        ya_usada: true,
        checked_in_at: ticket.checked_in_at,
      });
    }
    /* estado 'emitido' (pago pendiente) — depende. Aceptamos pero advertimos. */
    const advertencia = ticket.estado === 'emitido' ? 'Boleta emitida sin pago confirmado.' : null;

    const { data: updated, error: e2 } = await supabase
      .from('tickets')
      .update({ estado: 'usado', checked_in_at: new Date().toISOString() })
      .eq('id', ticket.id)
      .select(`*, tipo:ticket_types!ticket_type_id(nombre)`)
      .single();
    if (e2) return res.status(500).json({ error: e2.message });

    /* Gamificación escopada por organizador (best-effort) */
    const organizadorId = evCtx?.owner_id;
    if (organizadorId) {
      /* Cliente con cuenta: acumula puntos de fidelidad con este organizador */
      if (updated.user_id) {
        otorgarPuntos({
          userId: updated.user_id, organizadorId, audiencia: 'cliente',
          eventoId, accion: 'asistencia',
        }).then(async () => {
          /* Badge "fiel": 5+ asistencias al mismo organizador */
          const { count } = await supabase
            .from('points_log').select('id', { count: 'exact', head: true })
            .eq('user_id', updated.user_id).eq('organizador_id', organizadorId)
            .eq('audiencia', 'cliente').eq('accion', 'asistencia');
          if ((count || 0) >= 5) otorgarBadge(updated.user_id, 'fiel');
        });
      }
      /* Empleado que operó el check-in (si no es el propio owner) */
      if (req.user.id !== organizadorId) {
        otorgarPuntos({
          userId: req.user.id, organizadorId, audiencia: 'empleado',
          eventoId, accion: 'checkin_operado',
        });
      }
    }

    if (organizadorId) {
      dispatch(organizadorId, 'checkin.realizado', {
        ticket_id: updated.id, evento_id: eventoId, codigo: updated.codigo,
        nombre: updated.guest_nombre, email: updated.guest_email,
        checked_in_at: updated.checked_in_at,
      });
    }

    res.json({ ok: true, ticket: updated, advertencia, sound: 'ok' });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

module.exports = router;
