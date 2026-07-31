/* Wompi (pasarela colombiana, Bancolombia) — helpers de firma.
   Cubre Nequi, Bre-B/PSE, Bancolombia y tarjetas en una sola integración.
   Web Checkout por redirección: se firma un hash de integridad; el webhook
   (Events) trae un checksum que se verifica con el secreto de eventos. */
const crypto = require('crypto');

/* Firma de integridad del checkout:
   SHA256(reference + amountInCents + currency + integritySecret). */
function firmaIntegridad({ reference, amountInCents, currency, integritySecret }) {
  return crypto.createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${integritySecret}`)
    .digest('hex');
}

/* URL del Web Checkout de Wompi (test o prod según la llave pública). */
function checkoutUrl({ publicKey, currency, amountInCents, reference, redirectUrl, integritySecret }) {
  const sig = firmaIntegridad({ reference, amountInCents, currency, integritySecret });
  const p = new URLSearchParams({
    'public-key': publicKey,
    currency,
    'amount-in-cents': String(amountInCents),
    reference,
    'redirect-url': redirectUrl,
    'signature:integrity': sig,
  });
  return `https://checkout.wompi.co/p/?${p.toString()}`;
}

/* Verifica el checksum del webhook de Events: concatena los valores de
   signature.properties (resueltos sobre body.data, en orden) + timestamp +
   secreto de eventos, y compara el SHA256. */
function verificarEvento(body, eventsSecret) {
  try {
    if (!eventsSecret) return false;
    const props = body?.signature?.properties || [];
    const checksum = body?.signature?.checksum;
    const timestamp = body?.timestamp;
    if (!Array.isArray(props) || !props.length || !checksum || timestamp == null) return false;
    let concat = '';
    for (const path of props) {
      const val = String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), body.data);
      concat += (val == null ? '' : String(val));
    }
    concat += String(timestamp) + eventsSecret;
    const calc = crypto.createHash('sha256').update(concat).digest('hex');
    return calc.toLowerCase() === String(checksum).toLowerCase();
  } catch { return false; }
}

module.exports = { firmaIntegridad, checkoutUrl, verificarEvento };
