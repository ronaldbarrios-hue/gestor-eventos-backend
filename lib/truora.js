/* Truora — verificación de identidad (KYC facial) para el módulo de vacantes.
   Plataforma-nivel: una sola API key (env TRUORA_API_KEY). Inerte si no está.
   Flujo: se crea una "validation" → Truora devuelve una URL donde la persona
   hace la prueba de vida; el resultado llega por webhook (/webhooks/truora).

   NOTA: los nombres exactos de campos/endpoints de Truora se confirman contra
   su documentación al integrar con la cuenta real; el parseo es defensivo. */
const BASE = process.env.TRUORA_API_BASE || 'https://api.validations.truora.com/v1';

async function crearValidacion({ apiKey, type = 'face-recognition', accountId, redirectUrl }) {
  const body = new URLSearchParams();
  body.set('type', type);
  if (accountId) body.set('account_id', String(accountId));
  if (redirectUrl) body.set('redirect_url', redirectUrl);
  const r = await fetch(`${BASE}/validations`, {
    method: 'POST',
    headers: { 'Truora-API-Key': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Truora ${r.status}: ${txt.slice(0, 300)}`);
  let data = {}; try { data = JSON.parse(txt); } catch { /* respuesta no-JSON */ }
  const val = data.validation || data;
  return {
    validationId: val.validation_id || data.validation_id || null,
    url: val.instructions_url || data.instructions_url || val.web?.instructions_url || data.url || null,
    raw: data,
  };
}

async function consultarValidacion({ apiKey, validationId }) {
  const r = await fetch(`${BASE}/validations/${validationId}`, { headers: { 'Truora-API-Key': apiKey } });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Truora ${r.status}: ${txt.slice(0, 300)}`);
  try { return JSON.parse(txt); } catch { return {}; }
}

/* Normaliza el resultado a nuestro estado interno. */
function estadoDesde(resultado) {
  const s = String(resultado || '').toLowerCase();
  if (['success', 'valid', 'approved', 'passed'].includes(s)) return 'verificado';
  if (['failure', 'invalid', 'declined', 'rejected', 'not_valid'].includes(s)) return 'rechazado';
  return 'pendiente';
}

module.exports = { crearValidacion, consultarValidacion, estadoDesde };
