/* GESTEK — Lista de espera (admin endpoints, auth requerida).
   Montado en /eventos en index.js.

   GET    /:eventoId/waitlist                     — lista completa
   PATCH  /:eventoId/waitlist/:waitlistId         — cambiar estado
   POST   /:eventoId/waitlist/:waitlistId/notify  — notificar manualmente
   DELETE /:eventoId/waitlist/:waitlistId         — quitar de la lista
*/

'use strict';

const express  = require('express');
const { exige } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { ofrecerCupoAlSiguiente, enviarPushWaitlist, HORAS_OFERTA } = require('../lib/waitlistOferta.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* 'expired' se suma en la 0061: se le ofreció el cupo y se le pasó el plazo.
   No es lo mismo que 'cancelled', que es haberse dado de baja. */
const ESTADOS_VALIDOS = ['active', 'contacted', 'purchased', 'cancelled', 'expired'];

/* ── Helpers ─────────────────────────────────────────────── */

/* ── Quién puede tocar la fila ────────────────────────────────────────────
 *
 * Era el dueño y nadie más. La lista de espera es trabajo de logística —mirar
 * quién espera un cupo y ofrecérselo cuando alguien cancela— y dejarla en el
 * dueño obliga a lo que pasó capacitando: dar permisos muy altos a quien sólo
 * tenía que atender la fila.
 *
 * `gestionar_clientes` y no un permiso nuevo: la fila es la antesala de la
 * lista de inscritos, y quien administra inscritos ya puede hacer con una
 * boleta bastante más de lo que se hace aquí. Inventar un permiso por ruta
 * acaba en un panel de sesenta casillas donde no se encuentra ninguna.
 *
 * Leer se abre además a `ver_clientes`: ver quién espera no mueve nada.
 *
 * El dueño sigue pasando siempre —`exige` le concede `*`—, así que nadie
 * pierde nada de lo que tenía. */
const PERMS_VER_FILA   = ['ver_clientes', 'gestionar_clientes'];
const PERMS_MOVER_FILA = ['gestionar_clientes'];

/* ── GET /:eventoId/waitlist ─────────────────────────────── */

router.get('/:eventoId/waitlist', exige(PERMS_VER_FILA), async (req, res) => {

  const { q, estado, ticket_type_id } = req.query;

  let query = supabase
    .from('event_waitlist')
    .select('*, tipo:ticket_types!ticket_type_id(id, nombre)')
    .eq('evento_id', req.params.eventoId)
    .order('ticket_type_id', { ascending: true })
    .order('posicion', { ascending: true });

  if (estado)         query = query.eq('estado', estado);
  if (ticket_type_id) query = query.eq('ticket_type_id', ticket_type_id);
  if (q)              query = query.or(`guest_email.ilike.%${q}%,guest_nombre.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const lista = data || [];
  const ahora = Date.now();
  /* Una oferta "viva" es la única fila que de verdad tiene el cupo guardado.
     Sin distinguirla, 'contacted' mezclaba a quien tiene el enlace en la mano
     con quien lo tuvo hace tres semanas. */
  for (const e of lista) {
    e.oferta_viva = e.estado === 'contacted'
      && Boolean(e.oferta_token)
      && Boolean(e.oferta_expira)
      && new Date(e.oferta_expira).getTime() > ahora;
    /* El token nunca sale del servidor: quien lo tenga puede tomar el cupo. */
    delete e.oferta_token;
  }

  const stats = {
    total    : lista.length,
    active   : lista.filter(e => e.estado === 'active').length,
    contacted: lista.filter(e => e.estado === 'contacted').length,
    purchased: lista.filter(e => e.estado === 'purchased').length,
    cancelled: lista.filter(e => e.estado === 'cancelled').length,
    expired  : lista.filter(e => e.estado === 'expired').length,
    ofertas_vivas: lista.filter(e => e.oferta_viva).length,
  };

  res.json({ waitlist: lista, stats, horas_oferta: HORAS_OFERTA });
});

/* ── PATCH /:eventoId/waitlist/:waitlistId ───────────────── */

router.patch('/:eventoId/waitlist/:waitlistId', exige(PERMS_MOVER_FILA), async (req, res) => {
  const { estado } = req.body;
  if (!ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ error: `estado inválido. Usa: ${ESTADOS_VALIDOS.join(', ')}.` });
  }

  const updates = { estado };
  if (estado === 'purchased') updates.purchased_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('event_waitlist')
    .update(updates)
    .eq('id', req.params.waitlistId)
    .eq('evento_id', req.params.eventoId)
    .select('*, tipo:ticket_types!ticket_type_id(id, nombre)')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Entrada no encontrada.' });
  res.json({ entry: data });
});

/* ── POST /:eventoId/waitlist/:waitlistId/notify ─────────── */

/* Avisar a mano a alguien de la fila. Antes marcaba 'contacted' y mandaba un
   push sin enlace, así que la persona sabía que había sitio pero no tenía
   forma de tomarlo antes que nadie. Ahora hace lo mismo que el disparador
   automático: correo `cupo_liberado` con enlace que caduca y el cupo guardado
   mientras tanto. */
router.post('/:eventoId/waitlist/:waitlistId/notify', exige(PERMS_MOVER_FILA), async (req, res) => {

  const { data: entry, error: eEntry } = await supabase
    .from('event_waitlist')
    .select('*')
    .eq('id', req.params.waitlistId)
    .eq('evento_id', req.params.eventoId)
    .maybeSingle();

  if (eEntry) return res.status(500).json({ error: eEntry.message });
  if (!entry) return res.status(404).json({ error: 'Entrada no encontrada.' });
  if (!['active', 'contacted', 'expired'].includes(entry.estado)) {
    return res.status(400).json({ error: 'Esta persona ya compró o se dio de baja.' });
  }

  /* Se ofrece "al siguiente de la fila", no a esta persona en concreto: el
     orden de la lista es la promesa que se le hizo a todos los demás. Si la
     que el organizador tocó no es la primera, se le dice. */
  const r = await ofrecerCupoAlSiguiente({
    eventoId: req.params.eventoId,
    ticketTypeId: entry.ticket_type_id,
  });

  if (!r.ok) {
    const explicacion = {
      sin_cupo   : 'No hay cupo libre en este tipo de boleta ahora mismo.',
      sin_aforo  : 'El evento está al aforo máximo.',
      fila_vacia : 'No queda nadie esperando en este tipo de boleta.',
      venta_cerrada: 'La venta de este tipo de boleta ya cerró.',
      tipo_no_disponible: 'Este tipo de boleta no está activo.',
      evento_no_publicado: 'El evento no está publicado.',
    }[r.motivo];
    return res.status(400).json({ error: explicacion || 'No se pudo enviar la oferta.' });
  }

  res.json({
    ok: true,
    ofrecido_a: r.email,
    era_quien_pediste: String(r.waitlistId) === String(entry.id),
    expira: r.expira,
    horas: HORAS_OFERTA,
    email_ok: r.envio?.ok === true,
    email_motivo: r.envio?.ok ? null : r.envio?.motivo || null,
  });
});

/* ── DELETE /:eventoId/waitlist/:waitlistId ──────────────── */

router.delete('/:eventoId/waitlist/:waitlistId', exige(PERMS_MOVER_FILA), async (req, res) => {

  const { error } = await supabase
    .from('event_waitlist')
    .delete()
    .eq('id', req.params.waitlistId)
    .eq('evento_id', req.params.eventoId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
module.exports.enviarPushWaitlist = enviarPushWaitlist;
