const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { verifyTicketQR, signTicketQR } = require('../lib/qr.js');
const { otorgarPuntos, otorgarBadge, reglasPuntosDeEvento } = require('../lib/gamificacion.js');
const { dispatch } = require('../lib/webhooks.js');
const { assertPermiso } = require('../lib/acceso.js');
const { resolverTicket } = require('../lib/ticketLookup.js');
const { notificar } = require('../lib/notificar.js');
const { correrAutomatizaciones } = require('../lib/automatizaciones.js');
const { ofrecerCupoAlSiguiente } = require('../lib/waitlistOferta.js');
const { COLUMNAS_CAMPO, validarFormulario, normalizarRespuestas } = require('../lib/formularioCampos.js');

/* Notificar sin romper la petición si el helper falla. */
function avisar(payload) {
  try { const p = notificar(payload); if (p?.catch) p.catch(() => {}); } catch { /* noop */ }
}

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
      /* `qr_token` viaja porque la escarapela impresa tiene que llevar el
         MISMO QR que la boleta digital. Antes no venía, así que el diseñador
         de credenciales imprimía una URL a /mi-ticket — y el escáner de
         control de ingreso manda lo que lee como token firmado, así que la
         escarapela impresa NO pasaba el control. */
      .select(`
        id, codigo, qr_token, estado, precio_pagado, pagado_at, checked_in_at, zona_usada, acceso, created_at,
        guest_email, guest_nombre, respuestas,
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

    /* Campos del formulario personalizado (id + etiqueta), para que el
       frontend pueda "traducir" las claves de `respuestas` (que se guardan
       por id de campo) a su texto real en vez de mostrar el UUID crudo. */
    const { data: camposForm } = await supabase
      .from('event_form_fields')
      .select('id, etiqueta, tipo, orden')
      .eq('evento_id', eventoId)
      .order('orden', { ascending: true });

    res.json({
      clientes: data || [],
      total: count ?? 0,
      stats,
      campos_formulario: camposForm || [],
    });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* Estados en los que la boleta ocupa un sitio. Anular o reembolsar saca a la
   persona del aforo; volver a emitirla la mete otra vez. */
const ESTADOS_QUE_OCUPAN = new Set(['emitido', 'pagado', 'usado']);

/* PATCH /eventos/:eventoId/clientes/:ticketId — cambiar estado (anular, marcar pagado, etc)

   Anular desde el panel no bajaba ningún contador: `vendidos` y
   `aforo_vendido` seguían igual, así que el evento se quedaba "agotado" con
   sitios vacíos y la lista de espera no se enteraba de nada. El reembolso por
   la pasarela sí lo hacía; este camino no. Ahora los dos hacen lo mismo. */
router.patch('/:eventoId/clientes/:ticketId', async (req, res) => {
  const { eventoId, ticketId } = req.params;
  const ESTADOS = ['emitido', 'pagado', 'usado', 'reembolsado', 'invalido'];
  const { estado } = req.body;
  if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido.' });

  try {
    await assertOwner(eventoId, req.user.id);

    const { data: antes } = await supabase
      .from('tickets').select('estado, ticket_type_id')
      .eq('id', ticketId).eq('evento_id', eventoId).maybeSingle();
    if (!antes) return res.status(404).json({ error: 'Boleta no encontrada.' });

    const { data, error } = await supabase
      .from('tickets').update({ estado })
      .eq('id', ticketId).eq('evento_id', eventoId)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });

    const ocupabaAntes  = ESTADOS_QUE_OCUPAN.has(antes.estado);
    const ocupaDespues  = ESTADOS_QUE_OCUPAN.has(estado);
    const delta = ocupabaAntes === ocupaDespues ? 0 : (ocupaDespues ? +1 : -1);

    if (delta !== 0) {
      await ajustarAforo(eventoId, antes.ticket_type_id, delta);
      /* Sólo al liberar: si acabamos de meter a alguien, no hay nada que
         ofrecer. Se hace en segundo plano —la respuesta del panel no tiene
         por qué esperar a que salga un correo. */
      if (delta < 0) {
        ofrecerCupoAlSiguiente({ eventoId, ticketTypeId: antes.ticket_type_id })
          .catch(() => {});
      }
    }

    res.json({ ticket: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* Mueve los dos contadores a la vez, sin bajar de cero. Son columnas
   denormalizadas: si se desincronizan, el evento miente sobre su aforo. */
async function ajustarAforo(eventoId, ticketTypeId, delta) {
  if (ticketTypeId) {
    const { data: tt } = await supabase
      .from('ticket_types').select('vendidos').eq('id', ticketTypeId).maybeSingle();
    if (tt) {
      await supabase.from('ticket_types')
        .update({ vendidos: Math.max(0, (tt.vendidos || 0) + delta) })
        .eq('id', ticketTypeId);
    }
  }
  const { data: ev } = await supabase
    .from('eventos').select('aforo_vendido').eq('id', eventoId).maybeSingle();
  if (ev) {
    await supabase.from('eventos')
      .update({ aforo_vendido: Math.max(0, (ev.aforo_vendido || 0) + delta) })
      .eq('id', eventoId);
  }
}

/* POST /eventos/:eventoId/clientes/importar — import masivo desde CSV.
   Body: { ticket_type_id, marcar_pagado, rows: [{ nombre, email, telefono? }] }
   Crea N tickets en estado 'pagado' (si marcar_pagado=true) o 'emitido'.
   Genera codigo + qr_token para cada uno. Reporta éxitos y errores fila por fila. */
router.post('/:eventoId/clientes/importar', async (req, res) => {
  const { eventoId } = req.params;
  const { ticket_type_id, marcar_pagado, rows } = req.body;

  if (!ticket_type_id) return res.status(400).json({ error: 'Selecciona el tipo de boleta para los importados.' });
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'No hay filas para importar.' });
  /* El tope sube de 1.000 a 5.000: con 7.000 asistentes, partir el archivo en
     siete trozos a mano es una invitacion a importar dos veces el mismo. El
     panel manda por lotes de todas formas. */
  if (rows.length > 5000) return res.status(400).json({ error: 'Maximo 5000 filas por envio. El panel las manda por lotes.' });

  try {
    const evImp = await assertOwner(eventoId, req.user.id);

    const { data: tipo, error: et } = await supabase
      .from('ticket_types').select('*').eq('id', ticket_type_id).eq('evento_id', eventoId).maybeSingle();
    if (et) return res.status(500).json({ error: et.message });
    if (!tipo) return res.status(404).json({ error: 'Tipo de boleta no encontrado.' });

    /* Campos del formulario del evento: lo importado se valida con el MISMO
       motor que una compra publica, para que un Excel no meta por la puerta de
       atras datos que el formulario habria rechazado. */
    const { data: campos } = await supabase
      .from('event_form_fields').select(COLUMNAS_CAMPO)
      .eq('evento_id', eventoId).is('session_id', null)
      .order('orden', { ascending: true });
    const camposForm = campos || [];

    /* Correos ya emitidos, para no duplicar. Se consulta por trozos porque un
       `in` con 5.000 valores no pasa. */
    const emails = rows.map(r => (r.email || '').toLowerCase().trim()).filter(Boolean);
    const dup = new Set();
    for (let i = 0; i < emails.length; i += 300) {
      const { data: ex } = await supabase
        .from('tickets').select('guest_email')
        .eq('evento_id', eventoId).in('guest_email', emails.slice(i, i + 300));
      (ex || []).forEach(x => x.guest_email && dup.add(x.guest_email));
    }

    const estado = marcar_pagado ? 'pagado' : 'emitido';
    const precio_efectivo = marcar_pagado ? Number(tipo.precio) : null;
    const ahora = marcar_pagado ? new Date().toISOString() : null;

    const errores = [];
    const aInsertar = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const fila = r.__fila || i + 1;
      const email = (r.email || '').toLowerCase().trim();
      const nombre = (r.nombre || '').trim();

      if (!nombre) { errores.push({ fila, motivo: 'Sin nombre.', row: r }); continue; }

      /* El correo pasa a ser OPCIONAL, y es el cambio que importa: cuando el
         correo del evento no funciona, la lista que hay que cargar es justo la
         de la gente a la que se le va a entregar la boleta impresa o por
         WhatsApp. Exigirlo dejaba fuera exactamente ese caso. */
      if (email && !email.includes('@')) { errores.push({ fila, motivo: 'Correo invalido.', row: r }); continue; }
      if (email && dup.has(email))       { errores.push({ fila, motivo: 'Ya existe una boleta con ese correo.', row: r }); continue; }

      let respuestas = null;
      if (r.respuestas && typeof r.respuestas === 'object') {
        const fallo = validarFormulario(camposForm, r.respuestas, tipo.id);
        if (fallo) { errores.push({ fila, motivo: fallo, row: r }); continue; }
        const limpias = normalizarRespuestas(camposForm, r.respuestas);
        respuestas = Object.keys(limpias).length ? limpias : null;
      }

      if (email) dup.add(email);
      aInsertar.push({
        fila,
        row: {
          evento_id: eventoId,
          ticket_type_id: tipo.id,
          guest_email: email || null,
          guest_nombre: nombre,
          codigo: generarCodigo(),
          estado,
          precio_pagado: precio_efectivo,
          pagado_at: ahora,
          respuestas,
        },
      });
    }

    /* Insercion por lotes. Antes era un INSERT por fila: 7.000 asistentes eran
       7.000 viajes de ida y vuelta, varios minutos con el panel colgado. */
    const ok = [];
    const LOTE = 200;
    for (let i = 0; i < aInsertar.length; i += LOTE) {
      const trozo = aInsertar.slice(i, i + LOTE);
      const { data: creados, error: ei } = await supabase
        .from('tickets').insert(trozo.map(t => t.row)).select('id, codigo, guest_email');

      if (ei) {
        /* Si el lote entero falla, se reintenta fila a fila: asi no se pierden
           200 por culpa de una, y se puede decir CUAL fallo. */
        for (const t of trozo) {
          const { data: uno, error: e1 } = await supabase
            .from('tickets').insert(t.row).select('id, codigo, guest_email').single();
          if (e1) errores.push({ fila: t.fila, motivo: e1.message, row: t.row });
          else ok.push({ fila: t.fila, id: uno.id, codigo: uno.codigo, email: uno.guest_email });
        }
        continue;
      }
      (creados || []).forEach((c, j) => ok.push({
        fila: trozo[j] ? trozo[j].fila : null, id: c.id, codigo: c.codigo, email: c.guest_email,
      }));
    }

    /* El QR firmado de cada boleta. Es lo que hace que la impresa valga en la
       puerta, asi que sin esto la importacion no sirve para repartir. */
    for (const t of ok) {
      const qr_token = signTicketQR({ ticket_id: t.id, evento_id: eventoId, codigo: t.codigo });
      await supabase.from('tickets').update({ qr_token }).eq('id', t.id);
    }

    if (ok.length > 0) {
      await supabase.from('ticket_types').update({ vendidos: (tipo.vendidos || 0) + ok.length }).eq('id', tipo.id);
      if (marcar_pagado) {
        const { data: ev } = await supabase.from('eventos').select('aforo_vendido').eq('id', eventoId).single();
        if (ev) await supabase.from('eventos').update({ aforo_vendido: (ev.aforo_vendido || 0) + ok.length }).eq('id', eventoId);
      }

      const organizadorId = evImp && evImp.owner_id;
      if (organizadorId && req.user.id !== organizadorId) {
        const reglas = await reglasPuntosDeEvento(eventoId);
        if (reglas.activo && reglas.registro_operado > 0) {
          otorgarPuntos({
            userId: req.user.id, organizadorId, audiencia: 'empleado',
            eventoId, accion: 'registro_operado',
            puntos: reglas.registro_operado * ok.length,
          });
        }
      }
    }

    /* La importación NO manda correos, y es deliberado: son miles de filas de
       una vez, y esta vía existe precisamente para cuando el correo no está
       disponible. Pero «creados: 47» se lee como «47 personas ya tienen su
       boleta», y no es verdad: nadie ha sido avisado. Decirlo aquí evita que
       alguien dé por hecha una entrega que no ocurrió. */
    res.json({
      creados: ok.length,
      errores,
      ok,
      sin_correo: ok.filter(t => !t.email).length,
      nota_correo: ok.length
        ? 'Las boletas quedaron creadas, pero NO se envió ningún correo: la importación no notifica. Reparte los códigos desde «Reparto sin correo» (imprimir o WhatsApp).'
        : null,
    });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/checkin — validar QR o código y marcar 'usado'.
   Body: { qr_token } o { codigo }
   Owner siempre puede. Miembros del equipo necesitan permiso 'checkin'. */
router.post('/:eventoId/checkin', async (req, res) => {
  const { eventoId } = req.params;
  const { qr_token, codigo, acceso_id, at } = req.body;
  if (!qr_token && !codigo) return res.status(400).json({ error: 'qr_token o codigo requerido.' });
  /* `at` (opcional): hora real del escaneo cuando viene de la cola OFFLINE.
     Se valida que sea una fecha razonable (no futura, no antiquísima). */
  let checkinAt = new Date().toISOString();
  if (typeof at === 'string') {
    const t = new Date(at).getTime();
    if (Number.isFinite(t) && t <= Date.now() + 60000 && t > Date.now() - 30 * 24 * 3600 * 1000) checkinAt = new Date(t).toISOString();
  }

  try {
    const evCtx = await assertCheckinAccess(eventoId, req.user.id);

    /* Puerta/acceso (opcional): config en page_json.accesos. Valida qué tipos
       de boleta admite y registra por dónde entró la persona. */
    let puerta = null;
    if (acceso_id) {
      const { data: evCfg } = await supabase.from('eventos').select('page_json').eq('id', eventoId).maybeSingle();
      const accesos = Array.isArray(evCfg?.page_json?.accesos) ? evCfg.page_json.accesos : [];
      puerta = accesos.find(a => a.id === acceso_id) || null;
    }

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
    let advertencia = ticket.estado === 'emitido' ? 'Boleta emitida sin pago confirmado.' : null;

    /* Puerta restringida a ciertos tipos: si la boleta no aplica, se advierte
       (no se bloquea, para que el staff decida). Ej. "Entrada VIP" con una
       boleta General. */
    if (puerta && Array.isArray(puerta.tipos) && puerta.tipos.length
        && !puerta.tipos.includes(ticket.ticket_type_id)) {
      advertencia = `Esta boleta (${ticket.tipo?.nombre || 'sin tipo'}) no corresponde a ${puerta.nombre}.`;
    }

    const { data: updated, error: e2 } = await supabase
      .from('tickets')
      .update({ estado: 'usado', checked_in_at: checkinAt, acceso: puerta?.nombre || null })
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

    /* Automatizaciones "cuando alguien hace check-in" (fire-and-forget). */
    correrAutomatizaciones(eventoId, 'checkin', {
      userId: updated.user_id, nombre: updated.guest_nombre || 'Asistente', acceso: puerta?.nombre || '',
    });

    res.json({ ok: true, ticket: updated, advertencia, sound: 'ok' });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/reingreso — registrar SALIDA o REINGRESO de una
   boleta sin invalidarla. El check-in normal marca la primera entrada; esto
   lleva el vaivén (entrada/salida) y deja saber quién está dentro.
   body: { qr_token | codigo, tipo?: 'entrada'|'salida', acceso_id?, zona_id? }
   Con `zona_id`, el vaivén se lleva POR ZONA (para el aforo por zonas).
   Sin `tipo`, alterna según el último estado (global o de esa zona). */
router.post('/:eventoId/reingreso', async (req, res) => {
  const { eventoId } = req.params;
  const { qr_token, codigo, tipo, acceso_id, zona_id } = req.body || {};
  try {
    const ev = await assertCheckinAccess(eventoId, req.user.id);
    const ticket = await resolverTicket(eventoId, { qr_token, codigo });
    if (!ticket) return res.status(404).json({ error: 'Boleta no encontrada.' });

    let accesoNombre = null, zonaNombre = null, zonaMax = null;
    if (acceso_id || zona_id) {
      const { data: evCfg } = await supabase.from('eventos').select('page_json').eq('id', eventoId).maybeSingle();
      const accesos = Array.isArray(evCfg?.page_json?.accesos) ? evCfg.page_json.accesos : [];
      const zonas = Array.isArray(evCfg?.page_json?.zonas) ? evCfg.page_json.zonas : [];
      accesoNombre = accesos.find(a => a.id === acceso_id)?.nombre || null;
      const zonaObj = zonas.find(z => z.id === zona_id);
      zonaNombre = zonaObj?.nombre || null;
      zonaMax = Number(zonaObj?.aforo_max) || null;
    }

    /* El estado se evalúa acotado a la zona si se indicó (una persona puede
       estar DENTRO del recinto pero FUERA de una zona concreta). */
    let q = supabase.from('ticket_movimientos').select('tipo').eq('ticket_id', ticket.id);
    q = zonaNombre ? q.eq('zona', zonaNombre) : q.is('zona', null);
    const { data: ult } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
    const dentroAhora = ult?.tipo ? ult.tipo === 'entrada' : (zonaNombre ? false : ticket.estado === 'usado');
    const nuevo = (tipo === 'entrada' || tipo === 'salida') ? tipo : (dentroAhora ? 'salida' : 'entrada');

    const { data: mov, error } = await supabase.from('ticket_movimientos').insert({
      ticket_id: ticket.id, evento_id: eventoId, tipo: nuevo,
      acceso: accesoNombre, zona: zonaNombre, operador_id: req.user.id,
    }).select('id, tipo, acceso, zona, created_at').single();
    if (error) return res.status(500).json({ error: error.message });

    /* Alerta automática: si la zona llegó a su aforo, avisar (una sola vez). */
    if (nuevo === 'entrada' && zonaNombre && zonaMax) {
      const { data: movsZona } = await supabase.from('ticket_movimientos')
        .select('tipo').eq('evento_id', eventoId).eq('zona', zonaNombre);
      const ocupacion = (movsZona || []).reduce((s, m) => s + (m.tipo === 'entrada' ? 1 : -1), 0);
      if (ocupacion >= zonaMax) {
        const { data: yaAlerta } = await supabase.from('evento_alertas')
          .select('id').eq('evento_id', eventoId).eq('tipo', 'aforo').eq('zona', zonaNombre).eq('resuelta', false).maybeSingle();
        if (!yaAlerta) {
          await supabase.from('evento_alertas').insert({
            evento_id: eventoId, tipo: 'aforo', nivel: 'critico', zona: zonaNombre,
            mensaje: `La zona "${zonaNombre}" llegó a su aforo (${ocupacion}/${zonaMax}).`,
          });
          if (ev?.owner_id) avisar({ userId: ev.owner_id, tipo: 'alerta', titulo: `Aforo lleno: ${zonaNombre}`, cuerpo: `${ocupacion}/${zonaMax} personas.`, link: `/eventos/${eventoId}?s=asistentes&t=accesos`, eventoId });
          correrAutomatizaciones(eventoId, 'aforo_lleno', { zona: zonaNombre });
        }
      }
    }

    res.status(201).json({
      ok: true, movimiento: mov, dentro: nuevo === 'entrada', zona: zonaNombre,
      ticket: { codigo: ticket.codigo, nombre: ticket.guest_nombre || 'Asistente', tipo: ticket.tipo?.nombre || 'General' },
    });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* GET /eventos/:eventoId/zonas/aforo — ocupación en vivo por zona
   (entradas - salidas de cada zona configurada en page_json.zonas). */
router.get('/:eventoId/zonas/aforo', async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertCheckinAccess(eventoId, req.user.id);
    const { data: evCfg } = await supabase.from('eventos').select('page_json').eq('id', eventoId).maybeSingle();
    const zonas = Array.isArray(evCfg?.page_json?.zonas) ? evCfg.page_json.zonas : [];
    const { data: movs } = await supabase.from('ticket_movimientos')
      .select('zona, tipo').eq('evento_id', eventoId).not('zona', 'is', null);
    const neto = {};
    for (const m of movs || []) neto[m.zona] = (neto[m.zona] || 0) + (m.tipo === 'entrada' ? 1 : -1);
    const resultado = zonas.map(z => ({
      id: z.id, nombre: z.nombre, aforo_max: z.aforo_max || null,
      dentro: Math.max(0, neto[z.nombre] || 0),
    }));
    res.json({ zonas: resultado });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ───────────── Alertas en vivo del evento ───────────── */

/* GET /eventos/:eventoId/alertas?activas=1 */
router.get('/:eventoId/alertas', async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertCheckinAccess(eventoId, req.user.id);
    let q = supabase.from('evento_alertas')
      .select('id, tipo, nivel, mensaje, zona, resuelta, created_at, autor:profiles!created_by(nombre)')
      .eq('evento_id', eventoId);
    if (req.query.activas) q = q.eq('resuelta', false);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(80);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ alertas: data || [] });
  } catch (e) { res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message }); }
});

/* POST /eventos/:eventoId/alertas { tipo, nivel, mensaje, zona } — el staff reporta */
router.post('/:eventoId/alertas', async (req, res) => {
  const { eventoId } = req.params;
  const mensaje = String(req.body?.mensaje || '').trim();
  if (!mensaje) return res.status(400).json({ error: 'Escribe qué está pasando.' });
  try {
    const ev = await assertCheckinAccess(eventoId, req.user.id);
    const nivel = ['info', 'warning', 'critico'].includes(req.body?.nivel) ? req.body.nivel : 'warning';
    const tipo = ['aforo', 'cola', 'incidente', 'general'].includes(req.body?.tipo) ? req.body.tipo : 'general';
    const { data, error } = await supabase.from('evento_alertas').insert({
      evento_id: eventoId, tipo, nivel, mensaje, zona: req.body?.zona || null, created_by: req.user.id,
    }).select('id, tipo, nivel, mensaje, zona, resuelta, created_at').single();
    if (error) return res.status(500).json({ error: error.message });
    if (ev?.owner_id && ev.owner_id !== req.user.id) {
      avisar({ userId: ev.owner_id, tipo: 'alerta', titulo: `Alerta: ${tipo}`, cuerpo: mensaje, link: `/eventos/${eventoId}?s=asistentes&t=accesos`, eventoId });
    }
    res.status(201).json({ alerta: data });
  } catch (e) { res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message }); }
});

/* PATCH /eventos/:eventoId/alertas/:id/resolver */
router.patch('/:eventoId/alertas/:id/resolver', async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await assertCheckinAccess(eventoId, req.user.id);
    const { data, error } = await supabase.from('evento_alertas')
      .update({ resuelta: true }).eq('id', id).eq('evento_id', eventoId).select('id').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Alerta no encontrada.' });
    res.json({ ok: true });
  } catch (e) { res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message }); }
});

module.exports = router;
