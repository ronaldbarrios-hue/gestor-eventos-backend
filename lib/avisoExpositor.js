/* Avisar al expositor de que su stand existe y que le toca configurarlo.

   El flujo de autoservicio ya estaba completo y le faltaba el primer eslabón:

   · El trigger de la 0036 crea la ficha en `networking_expositores` en cuanto la
     boleta de stand pasa a 'pagado', con estado_ficha = 'borrador'.
   · El expositor edita ESA ficha en /expositor/:codigo con el código de su
     boleta: nombre, logo, contacto, redes, galería, por qué da puntos y qué
     premios ofrece. Y la cierra con `marcar_completa`.
   · El panel del organizador ya la ve, con su estado y el enlace al portal.

   Lo que no pasaba: NADIE se lo decía. La empresa compraba su stand, recibía el
   correo genérico de boleta con un QR, y ahí terminaba. El resultado es que las
   fichas se quedaban en borrador y el organizador acababa rellenándolas a mano —
   justo lo contrario de que cada quien haga su registro.

   Va aparte del correo de boleta y no en lugar de él: la boleta sirve para
   entrar al recinto y el QR hace falta igual. Este es el segundo correo, el que
   dice qué hacer ahora.

   Nunca lanza. Un fallo aquí no puede deshacer una compra ya confirmada. */

const supabase = require('./supabase.js');
const { enviarEmailEvento } = require('./emailPlantillas.js');

function frontend() {
  return String(process.env.FRONTEND_URL || 'https://gestor-eventos-frontend.vercel.app')
    .split(',')[0].replace(/\/$/, '');
}

/* Se llama después de confirmar una boleta. Si su tipo no es de expositor, no
   hace nada y no cuesta nada: una lectura corta. */
async function avisarExpositorSiAplica(ticketId) {
  try {
    const { data: ticket } = await supabase
      .from('tickets')
      .select(`id, codigo, evento_id, estado, guest_nombre, guest_email,
               usuario:profiles!user_id(nombre, email),
               tipo:ticket_types!ticket_type_id(nombre, es_expositor)`)
      .eq('id', ticketId).maybeSingle();

    if (!ticket?.tipo?.es_expositor) return { ok: false, motivo: 'no_es_stand' };
    if (ticket.estado !== 'pagado') return { ok: false, motivo: 'no_confirmada' };

    const destino = ticket.usuario?.email || ticket.guest_email;
    if (!destino) return { ok: false, motivo: 'sin_destinatario' };

    /* La ficha la crea un trigger en la misma transacción del cambio de estado,
       así que a estas alturas ya existe. Se comprueba de todos modos: si por lo
       que sea no está, mandar a alguien a un portal que va a dar error es peor
       que no mandarlo. */
    const { data: ficha } = await supabase
      .from('networking_expositores')
      .select('id, nombre, estado_ficha')
      .eq('ticket_id', ticket.id).maybeSingle();
    if (!ficha) return { ok: false, motivo: 'ficha_no_creada' };

    return await enviarEmailEvento({
      evento: ticket.evento_id,
      tipo: 'stand',
      to: destino,
      ctx: {
        /* El nombre de la ficha nace del comprador y suele ser el de la empresa;
           si el trigger no tuvo nada, cae al genérico y el propio expositor lo
           corrige en su portal. */
        nombre: ticket.usuario?.nombre || ticket.guest_nombre || ficha.nombre || '',
        codigo: ticket.codigo,
        tipo_boleta: ticket.tipo?.nombre || '',
        enlace: `${frontend()}/expositor/${ticket.codigo}`,
      },
    });
  } catch (e) {
    console.warn('[avisoExpositor] no se pudo avisar:', e.message);
    return { ok: false, motivo: e.message };
  }
}

module.exports = { avisarExpositorSiAplica };
