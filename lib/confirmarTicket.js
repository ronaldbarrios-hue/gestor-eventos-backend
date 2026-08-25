/* Confirma una boleta como PAGADA y dispara los efectos: marca el ticket,
   suma aforo/vendidos, notifica el webhook del organizador y envía el correo
   con el QR. Extraído para reutilizarlo desde cualquier pasarela (Wompi, MP…)
   sin duplicar la lógica. Idempotente: si ya está pagada, no hace nada. */
const supabase = require('./supabase.js');
const { enlaceBoleta } = require('./enlacePublico.js');
const { dispatch } = require('./webhooks.js');
const { enviarEmailEvento } = require('./emailPlantillas.js');
const { avisarExpositorSiAplica } = require('./avisoExpositor.js');

async function confirmarTicketPagado(ticketId, monto, via) {
  const { data: ticket } = await supabase
    .from('tickets').select('id, evento_id, estado, ticket_type_id').eq('id', ticketId).maybeSingle();
  if (!ticket || ticket.estado === 'pagado') return false;

  await supabase.from('tickets').update({
    estado: 'pagado', precio_pagado: monto, pagado_at: new Date().toISOString(),
  }).eq('id', ticketId);

  const { data: evWh } = await supabase.from('eventos')
    .select('owner_id, titulo, slug, cover_url, fecha_inicio, location_nombre, aforo_vendido')
    .eq('id', ticket.evento_id).maybeSingle();
  const { data: tFull } = await supabase.from('tickets')
    .select('codigo, guest_nombre, guest_email, ticket_type_id, qr_token').eq('id', ticketId).maybeSingle();

  let tipoNombre = null;
  if (tFull?.ticket_type_id) {
    const { data: tt } = await supabase.from('ticket_types').select('nombre, vendidos').eq('id', tFull.ticket_type_id).maybeSingle();
    tipoNombre = tt?.nombre || null;
    if (tt) await supabase.from('ticket_types').update({ vendidos: (tt.vendidos || 0) + 1 }).eq('id', tFull.ticket_type_id);
  }

  if (evWh?.owner_id) {
    dispatch(evWh.owner_id, 'ticket.pagado', {
      ticket_id: ticketId, evento_id: ticket.evento_id,
      codigo: tFull?.codigo, nombre: tFull?.guest_nombre, email: tFull?.guest_email, monto, via,
    });
    await supabase.from('eventos').update({ aforo_vendido: (evWh.aforo_vendido || 0) + 1 }).eq('id', ticket.evento_id);
  }

  if (tFull?.guest_email) {
    const link = await enlaceBoleta(ticket.evento_id, tFull.codigo);
    enviarEmailEvento({
      evento: ticket.evento_id,
      tipo: 'ticket',
      to: tFull.guest_email,
      ctx: {
        nombre     : tFull.guest_nombre,
        tipo_boleta: tipoNombre,
        codigo     : tFull.codigo,
        qr_token   : tFull.qr_token,
        enlace     : link,
      },
    }).then(r => console.log('[confirmarTicket] email:', r?.ok ?? r)).catch(() => {});
  }

  /* Si era una boleta de stand, además del QR se le dice que tiene un portal y
     que le toca configurarlo. Sin esto la ficha se queda en borrador y el
     organizador acaba rellenándola a mano. */
  avisarExpositorSiAplica(ticketId)
    .then(r => { if (r?.ok) console.log('[confirmarTicket] aviso de stand enviado'); })
    .catch(() => {});

  return true;
}

module.exports = { confirmarTicketPagado };
