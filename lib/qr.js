/* Helpers para QR de boletas: firmar y verificar JWTs.
   El payload incluye ticket_id, evento_id y código corto.
   Firmamos con QR_JWT_SECRET (env). El JWT se imprime como QR. */

const jwt = require('jsonwebtoken');

const SECRET = process.env.QR_JWT_SECRET || 'gestek_qr_change_me_in_production';

function signTicketQR({ ticket_id, evento_id, codigo }) {
  return jwt.sign(
    { tid: ticket_id, eid: evento_id, c: codigo, v: 1 },
    SECRET,
    { algorithm: 'HS256' }
    /* No expira — la boleta vale mientras el evento esté activo */
  );
}

/* El QR de UN puesto dentro de una boleta de varias personas (0118).
 *
 * Lleva `tid` y `eid` como el de la boleta, así que todo lo que ya lee QRs lo
 * sigue entendiendo: quien no sepa de puestos ve la boleta correcta y funciona
 * como antes. Lo que añade es `pid`, y con eso la puerta puede marcar entrado a
 * uno de los cuatro de la mesa en vez de a la mesa entera.
 *
 * Y es lo que hace posible la reventa: firmar de nuevo con el mismo `pid`
 * produce un token distinto, y el anterior deja de servir por construcción. Eso
 * es lo que separa una transferencia de verdad de un cambio de nombre. */
function signPuestoQR({ ticket_id, evento_id, codigo, puesto_id, orden }) {
  return jwt.sign(
    { tid: ticket_id, eid: evento_id, c: codigo, pid: puesto_id, o: orden, v: 1,
      /* Dos firmas del mismo puesto en el mismo segundo serían el mismo token,
         y entonces rotar no invalidaría nada. `jti` garantiza que cambia. */
      jti: `${puesto_id}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}` },
    SECRET,
    { algorithm: 'HS256' }
  );
}

function verifyTicketQR(token) {
  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    return { ok: true, ticket_id: payload.tid, evento_id: payload.eid, codigo: payload.c,
             /* `null` en una boleta normal: sólo los QR de puesto lo traen. */
             puesto_id: payload.pid || null, orden: payload.o || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { signTicketQR, signPuestoQR, verifyTicketQR };
