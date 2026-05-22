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

function verifyTicketQR(token) {
  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    return { ok: true, ticket_id: payload.tid, evento_id: payload.eid, codigo: payload.c };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { signTicketQR, verifyTicketQR };
