/* Saldo canjeable de una BOLETA.

   La escarapela lleva un solo QR: sirve para entrar y para canjear. Los puntos
   NO son globales — si lo fueran, alguien redimiría en este evento lo que ganó
   en otro. El organizador elige el alcance en page_json.puntos.alcance:

     'evento'      → solo cuenta lo ganado con esta boleta, en este evento.
     'organizador' → acumula entre todos los eventos de esa empresa. Como los
                     invitados no tienen cuenta, la identidad se resuelve por
                     user_id si existe y, si no, por guest_email.

   saldo = puntos ganados (ticket_interacciones) − puntos ya canjeados (canjes) */

const supabase = require('./supabase.js');
const { reglasPuntosDeEvento } = require('./gamificacion.js');

/* Boletas que "son" la misma persona dentro del alcance pedido. */
async function ticketsDelAlcance(ticket, alcance, organizadorId) {
  if (alcance !== 'organizador') return [ticket.id];

  /* Eventos de ese organizador */
  const { data: evs } = await supabase
    .from('eventos').select('id').eq('owner_id', organizadorId).is('deleted_at', null);
  const eventoIds = (evs || []).map(e => e.id);
  if (!eventoIds.length) return [ticket.id];

  let q = supabase.from('tickets').select('id').in('evento_id', eventoIds);
  if (ticket.user_id) q = q.eq('user_id', ticket.user_id);
  else if (ticket.guest_email) q = q.eq('guest_email', ticket.guest_email);
  else return [ticket.id];

  const { data } = await q;
  const ids = (data || []).map(t => t.id);
  return ids.length ? ids : [ticket.id];
}

/**
 * saldoDeTicket(ticket, { organizadorId, eventoId, expositorId })
 * → { ganados, canjeados, saldo, alcance, tickets }
 * `ticket` necesita al menos { id, user_id, guest_email }.
 *
 * CARTERAS SEPARADAS: cada emisor tiene su bolsillo.
 *  - sin expositorId → cartera del ORGANIZADOR (expositor_id IS NULL). El
 *    alcance ('evento'|'organizador') solo aplica a esta cartera.
 *  - con expositorId → cartera de ESE expositor; siempre por-evento (un
 *    expositor no cruza eventos), solo cuenta lo que él otorgó/canjeó.
 */
async function saldoDeTicket(ticket, { organizadorId, eventoId, expositorId = null }) {
  let ids;
  if (expositorId) {
    ids = [ticket.id];                         // el expositor es por-evento
  } else {
    const reglas = await reglasPuntosDeEvento(eventoId);
    const alcance = reglas.alcance || 'evento';
    ids = await ticketsDelAlcance(ticket, alcance, organizadorId);
    var alcanceUsado = alcance;
  }

  let qi = supabase.from('ticket_interacciones').select('puntos').in('ticket_id', ids);
  qi = expositorId ? qi.eq('expositor_id', expositorId) : qi.is('expositor_id', null);
  const { data: inter } = await qi;
  const ganados = (inter || []).reduce((s, r) => s + (r.puntos || 0), 0);

  let qc = supabase.from('canjes').select('costo_puntos, estado').in('ticket_id', ids);
  qc = expositorId ? qc.eq('expositor_id', expositorId) : qc.is('expositor_id', null);
  const { data: canjes } = await qc;
  const canjeados = (canjes || [])
    .filter(c => c.estado !== 'anulado')
    .reduce((s, c) => s + (c.costo_puntos || 0), 0);

  return {
    ganados, canjeados, saldo: ganados - canjeados,
    alcance: expositorId ? 'expositor' : alcanceUsado, tickets: ids,
  };
}

/* Recompensas canjeables en un evento: las del ORGANIZADOR (evento + empresa),
   excluyendo las de expositores (expositor_id IS NULL). Una atada a OTRO
   evento no aparece. */
async function recompensasDisponibles(organizadorId, eventoId) {
  const { data } = await supabase
    .from('recompensas')
    .select('id, titulo, descripcion, costo_puntos, stock, canjeados, activo, evento_id, audiencia')
    .eq('organizador_id', organizadorId)
    .eq('activo', true)
    .is('expositor_id', null)
    .or(`evento_id.is.null,evento_id.eq.${eventoId}`)
    .order('costo_puntos', { ascending: true });

  return (data || [])
    .filter(r => (r.audiencia || 'cliente') === 'cliente')
    .map(r => ({ ...r, agotada: r.stock != null && r.canjeados >= r.stock }));
}

/* Recompensas propias de UN expositor. */
async function recompensasDeExpositor(expositorId) {
  const { data } = await supabase
    .from('recompensas')
    .select('id, titulo, descripcion, costo_puntos, stock, canjeados, activo, expositor_id')
    .eq('expositor_id', expositorId)
    .eq('activo', true)
    .order('costo_puntos', { ascending: true });
  return (data || []).map(r => ({ ...r, agotada: r.stock != null && r.canjeados >= r.stock }));
}

module.exports = { saldoDeTicket, recompensasDisponibles, recompensasDeExpositor };
