const express = require('express');
const { exige, sesion } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { auditar } = require('../lib/auditar.js');
const { assertPermiso } = require('../lib/acceso.js');
const { ofrecerCupoAlSiguiente } = require('../lib/waitlistOferta.js');
const { boletasSinEquipo, filasDeEquipo, avisoDeBoletasSueltas } = require('../lib/equiposDesdeBoletas.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* Owner o miembro con permiso 'gestionar_tickets'. */
const PERMS_TICKETS = ['gestionar_tickets'];

function assertOwner(eventoId, userId) {
  return assertPermiso(eventoId, userId, PERMS_TICKETS, 'id, owner_id, currency');
}

const CAMPOS_EDITABLES = [
  'nombre', 'descripcion', 'precio', 'currency',
  'cupo', 'early_bird_precio', 'early_bird_hasta', 'venta_hasta',
  'orden', 'activo', 'es_expositor',
  /* `zonas_acceso` NO está aquí, y su ausencia es una decisión.
   *
   * Era un interruptor muerto de tres caras: se podía escribir por la API,
   * viajaba en la página pública del evento, y **no lo comprobaba nadie**.
   * Quien lo pusiera —por MCP, o desde una pantalla futura— se quedaría
   * creyendo que su boleta VIP abre la zona VIP, y en la puerta no cambiaría
   * nada. Una API que acepta un ajuste y lo ignora es peor que una que dice
   * que no.
   *
   * Quién manda de verdad: la PUERTA. `zonas.reglas.tipos` dice qué tipos de
   * boleta admite cada puerta, y eso sí se comprueba al escanear
   * (`routes/clientes.js`, «Puerta restringida a ciertos tipos»). Es una sola
   * regla y en un solo sitio; tenerla también del lado de la boleta eran dos
   * fuentes para lo mismo, que es como se acaban contradiciendo.
   *
   * Medido antes de quitarlo: cero tipos de boleta en producción lo tenían
   * puesto. No se pierde nada de nadie. La columna se queda —quitarla es
   * contract y no toca—, sólo deja de ofrecerse. */
  /* 0093: qué crea esta boleta al pagarse. `es_expositor` sigue en la lista
     porque el panel viejo, mientras no se despliegue el nuevo, es quien la
     escribe —y un trigger mantiene las dos de acuerdo. */
  'crea', 'crea_torneo_id',
];

const CREA_VALIDO = ['nada', 'stand', 'equipo'];

function sanitize(body, defaults = {}) {
  const out = { ...defaults };
  for (const k of CAMPOS_EDITABLES) {
    if (k in body) {
      let v = body[k];
      if (v === '' && (k.includes('precio') || k.includes('hasta') || k === 'cupo')) v = null;
      if (k === 'es_expositor') v = Boolean(v);
      if (k === 'crea_torneo_id' && v === '') v = null;
      out[k] = v;
    }
  }

  /* Un tipo que crea equipos sin decir en qué torneo es un dato que no
     significa nada, y la base lo rechaza con una restricción. Se comprueba
     también aquí para contestar por qué, en vez de devolver el texto de un
     `check constraint` que no le dice nada a nadie. */
  if ('crea' in out) {
    if (!CREA_VALIDO.includes(out.crea)) throw new Error('Ese tipo de boleta no puede crear eso.');
    if (out.crea !== 'equipo') out.crea_torneo_id = null;
  }
  if (out.crea === 'equipo' && !out.crea_torneo_id) {
    throw new Error('Elige a qué torneo entra el equipo.');
  }
  return out;
}

/* GET /eventos/:eventoId/tickets */
router.get('/:eventoId/tickets', exige(PERMS_TICKETS), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const { data, error } = await supabase
      .from('ticket_types')
      .select('*')
      .eq('evento_id', eventoId)
      .order('orden', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ tickets: data || [] });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/tickets */
router.post('/:eventoId/tickets', exige(PERMS_TICKETS), async (req, res) => {
  const { eventoId } = req.params;
  if (!req.body?.nombre?.trim()) return res.status(400).json({ error: 'Nombre del ticket requerido.' });

  try {
    const evento = await assertOwner(eventoId, req.user.id);

    /* orden = max + 1 */
    const { data: maxRow } = await supabase
      .from('ticket_types').select('orden').eq('evento_id', eventoId)
      .order('orden', { ascending: false }).limit(1).maybeSingle();
    const nextOrden = (maxRow?.orden || 0) + 1;

    const payload = sanitize(req.body, {
      evento_id: eventoId,
      currency : evento.currency || 'COP',
      orden    : nextOrden,
      activo   : true,
      precio   : 0,
    });

    const { data, error } = await supabase
      .from('ticket_types').insert(payload).select().single();
    if (error) return res.status(500).json({ error: error.message });
    auditar(req, eventoId, 'ticket.crear', { entidad: 'ticket', entidadId: data.id, detalle: { nombre: data.nombre, precio: data.precio } });
    res.status(201).json({ ticket: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* PATCH /eventos/:eventoId/tickets/:ticketId */
router.patch('/:eventoId/tickets/:ticketId', exige(PERMS_TICKETS), async (req, res) => {
  const { eventoId, ticketId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const updates = sanitize(req.body);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios.' });
    const { data, error } = await supabase
      .from('ticket_types').update(updates)
      .eq('id', ticketId).eq('evento_id', eventoId)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    auditar(req, eventoId, 'ticket.editar', { entidad: 'ticket', entidadId: ticketId, detalle: { campos: Object.keys(updates) } });

    /* Subir el cupo o reactivar un tipo agotado también libera sitio, y hasta
       ahora era la única forma de que alguien de la lista de espera se quedara
       esperando delante de una boleta que ya se podía comprar. En segundo
       plano: el panel no tiene por qué esperar a que salga un correo. */
    if ('cupo' in updates || updates.activo === true || 'venta_hasta' in updates) {
      ofrecerCupoAlSiguiente({ eventoId, ticketTypeId: ticketId }).catch(() => {});
    }

    res.json({ ticket: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE /eventos/:eventoId/tickets/:ticketId */
router.delete('/:eventoId/tickets/:ticketId', exige(PERMS_TICKETS), async (req, res) => {
  const { eventoId, ticketId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    /* Si ya hay boletas vendidas de este tipo, marcarlo como inactivo en vez de borrar */
    const { data: t } = await supabase
      .from('ticket_types').select('vendidos').eq('id', ticketId).maybeSingle();
    if (t && t.vendidos > 0) {
      const { error } = await supabase
        .from('ticket_types').update({ activo: false })
        .eq('id', ticketId).eq('evento_id', eventoId);
      if (error) return res.status(500).json({ error: error.message });
      auditar(req, eventoId, 'ticket.borrar', { entidad: 'ticket', entidadId: ticketId, detalle: { archivado: true } });
      return res.json({ ok: true, archivado: true });
    }
    const { error } = await supabase
      .from('ticket_types').delete()
      .eq('id', ticketId).eq('evento_id', eventoId);
    if (error) return res.status(500).json({ error: error.message });
    auditar(req, eventoId, 'ticket.borrar', { entidad: 'ticket', entidadId: ticketId });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ═══════════ Las boletas que se vendieron antes de tener torneo ═══════════
 *
 * Quien mete a un equipo en el torneo es el disparador `trg_equipo_desde_boleta`
 * de la base, y su definición es la clave:
 *
 *     AFTER INSERT OR UPDATE **OF estado** ON tickets
 *
 * Sólo corre cuando la boleta nace o cambia de estado. Así que este camino
 * —que es el normal cuando el evento se arma de a poco— deja gente fuera:
 *
 *   1. Todavía no hay torneo, así que el tipo se crea con «Nada más» —es lo
 *      único que el formulario deja guardar— y se empieza a vender.
 *   2. Días después se crea el torneo y se cambia el tipo a «Un equipo».
 *   3. Las boletas ya pagadas no entran: su estado ya no va a cambiar, el
 *      disparador no vuelve a correr, y no hay ningún error que ver.
 *
 * Se descubre el día de la competencia, contando sillas.
 */

/* GET — cuántas boletas de este tipo se quedarían fuera. Se pregunta ANTES de
   guardar el cambio, para poder avisar en vez de dejar el hueco hecho. */
router.get('/:eventoId/tickets/:ticketId/boletas-sin-equipo', exige(PERMS_TICKETS), async (req, res) => {
  const { eventoId, ticketId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const { sueltas, error } = await boletasQueFaltan(eventoId, ticketId);
    if (error) return res.status(500).json({ error });
    res.json({ cuantas: sueltas.length, aviso: avisoDeBoletasSueltas(sueltas.length) });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST — meterlas al torneo.
 *
 * Se insertan los equipos directamente en vez de tocar `estado` para que el
 * disparador corra solo: `estado` es el dato del que cuelgan el aforo, el cobro
 * y la entrada, y moverlo para provocar un efecto secundario es la clase de
 * atajo que un día marca cien boletas como pagadas. */
router.post('/:eventoId/tickets/:ticketId/crear-equipos', exige(PERMS_TICKETS), async (req, res) => {
  const { eventoId, ticketId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);

    const { tipo, sueltas, error } = await boletasQueFaltan(eventoId, ticketId);
    if (error) return res.status(500).json({ error });
    if (!tipo) return res.status(404).json({ error: 'Ese tipo de boleta no es de este evento.' });
    if (tipo.crea !== 'equipo' || !tipo.crea_torneo_id) {
      return res.status(400).json({ error: 'Este tipo de boleta no crea equipos. Elige «Un equipo» y su torneo primero.' });
    }
    if (!sueltas.length) return res.json({ creados: 0 });

    /* `ticket_id` es único en `torneo_equipos`, así que si alguien pulsa dos
       veces —o el disparador se adelanta— la segunda no duplica nada. Aquí no
       hay `on conflict do nothing` como en el disparador, así que se mira el
       23505 y se cuenta como «ya estaba», que es la verdad. */
    const { data, error: eIns } = await supabase
      .from('torneo_equipos')
      .insert(filasDeEquipo(sueltas, tipo.crea_torneo_id))
      .select('id');
    if (eIns && eIns.code !== '23505') return res.status(500).json({ error: eIns.message });

    const creados = data?.length || 0;
    auditar(req, eventoId, 'ticket.equipos-al-torneo', {
      entidad: 'ticket', entidadId: ticketId,
      detalle: { torneo: tipo.crea_torneo_id, creados },
    });
    res.json({ creados });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* El tipo, y sus boletas vendidas que todavía no tienen equipo. */
async function boletasQueFaltan(eventoId, ticketId) {
  const { data: tipo, error: eTipo } = await supabase
    .from('ticket_types').select('id, crea, crea_torneo_id')
    .eq('id', ticketId).eq('evento_id', eventoId).maybeSingle();
  if (eTipo) return { error: eTipo.message, sueltas: [] };
  if (!tipo) return { tipo: null, sueltas: [] };

  const { data: tickets, error: eT } = await supabase
    .from('tickets').select('id, estado, guest_nombre, guest_email, user_id')
    .eq('evento_id', eventoId).eq('ticket_type_id', ticketId);
  if (eT) return { error: eT.message, sueltas: [] };

  const ids = (tickets || []).map(t => t.id);
  let conEquipo = new Set();
  if (ids.length) {
    const { data: ya, error: eE } = await supabase
      .from('torneo_equipos').select('ticket_id').in('ticket_id', ids);
    /* Si no se pueden leer los equipos que YA existen, no se sigue: insertar a
       ciegas duplicaría los que ya estaban. */
    if (eE) return { error: eE.message, sueltas: [] };
    conEquipo = new Set((ya || []).map(e => e.ticket_id));
  }

  return { tipo, sueltas: boletasSinEquipo(tickets || [], conEquipo) };
}

module.exports = router;
