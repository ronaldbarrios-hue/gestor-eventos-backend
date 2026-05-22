/* GESTEK — Cliente ligero de Mercado Pago.
   Usamos la API REST directa con fetch (Node 18+) para evitar dependencias extra.
   Cada organizador conecta SU cuenta MP, así que las credenciales se pasan por argumento. */

const MP_BASE = 'https://api.mercadopago.com';

async function mpFetch(accessToken, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${MP_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type' : 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || `MP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.detail = data;
    throw err;
  }
  return data;
}

/* Crea una preferencia de pago. Retorna { id, init_point, sandbox_init_point } */
async function createPreference(accessToken, {
  items,
  payer,
  externalReference,
  notificationUrl,
  successUrl,
  failureUrl,
  pendingUrl,
}) {
  /* MP exige que auto_return apunte a una back_url.success pública y HTTPS.
     En dev (localhost) lo omitimos para que MP no rechace la preferencia. */
  const isPublic = /^https:\/\//.test(successUrl || '') && !/localhost|127\.0\.0\.1/.test(successUrl);

  const body = {
    items,
    payer,
    external_reference: externalReference,
    notification_url  : notificationUrl,
    back_urls         : { success: successUrl, failure: failureUrl, pending: pendingUrl },
    statement_descriptor: 'GESTEK',
  };
  if (isPublic) body.auto_return = 'approved';

  return mpFetch(accessToken, '/checkout/preferences', { method: 'POST', body });
}

async function getPayment(accessToken, paymentId) {
  return mpFetch(accessToken, `/v1/payments/${paymentId}`);
}

/* Test de conexión: consulta /users/me con el access token del organizador */
async function getUserInfo(accessToken) {
  return mpFetch(accessToken, '/users/me');
}

module.exports = { createPreference, getPayment, getUserInfo };
