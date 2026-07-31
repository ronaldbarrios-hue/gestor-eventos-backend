/* Confirma una boleta como PAGADA y dispara los efectos: marca el ticket,
   suma aforo/vendidos, notifica el webhook del organizador y envía el correo
   con el QR. Extraído para reutilizarlo desde cualquier pasarela (Wompi, MP…)
   sin duplicar la lógica. Idempotente: si ya está pagada, no hace nada. */
const supabase = require('./supabase.js');
const { dispatch } = require('./webhooks.js');
const { sendMail, plantillaTicket } = require('./email.js');

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
    const link = `${(process.env.FRONTEND_URL || 'https://gestor-eventos-frontend.vercel.app').split(',')[0]}/mi-ticket/${tFull.codigo}`;
    sendMail({
      to: tFull.guest_email,
      subject: `Tu entrada para "${evWh?.titulo || 'el evento'}" está confirmada`,
      html: plantillaTicket({
        eventoTitulo: evWh?.titulo, eventoCoverUrl: evWh?.cover_url, eventoFecha: evWh?.fecha_inicio,
        eventoLugar: evWh?.location_nombre, nombre: tFull.guest_nombre, codigo: tFull.codigo,
        qrToken: tFull.qr_token, tipoNombre, linkTicket: link, gratis: false,
      }),
    }).then(r => console.log('[confirmarTicket] email:', r?.ok ?? r)).catch(() => {});
  }
  return true;
}

module.exports = { confirmarTicketPagado };
