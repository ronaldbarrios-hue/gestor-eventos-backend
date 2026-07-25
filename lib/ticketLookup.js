/* Helpers compartidos para resolver una boleta (escarapela) por su QR firmado
   o su código corto, y generar códigos de canje. Los usan el escáner de staff
   (routes/interacciones.js) y el panel del expositor (routes/expositor.js). */

const supabase = require('./supabase.js');
const { verifyTicketQR } = require('./qr.js');

/* Resuelve el ticket de un asistente por qr_token firmado o por código corto,
   siempre acotado al evento indicado. */
async function resolverTicket(eventoId, { qr_token, codigo }) {
  const SEL = 'id, evento_id, codigo, guest_nombre, user_id, estado, ticket_type_id, tipo:ticket_types!ticket_type_id(nombre)';
  if (qr_token) {
    const r = verifyTicketQR(qr_token);
    if (!r.ok) throw new Error('QR inválido.');
    if (r.evento_id !== eventoId) throw new Error('Este QR es de otro evento.');
    const { data } = await supabase.from('tickets').select(SEL).eq('id', r.ticket_id).maybeSingle();
    return data;
  }
  const { data } = await supabase.from('tickets').select(SEL)
    .eq('codigo', String(codigo || '').toUpperCase().trim()).eq('evento_id', eventoId).maybeSingle();
  return data;
}

function codigoCanje() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 8; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

module.exports = { resolverTicket, codigoCanje };
