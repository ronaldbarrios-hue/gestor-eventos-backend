/* GESTEK — Webhooks salientes. dispatch(ownerId, tipo, payload):
   busca webhooks activos del owner suscritos a `tipo`, firma el body con
   HMAC-SHA256 (header x-gestek-signature) y hace POST con 1 reintento.
   Registra cada entrega en webhook_deliveries. Best-effort: nunca lanza. */

const crypto = require('crypto');
const supabase = require('./supabase.js');

function firmar(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function entregar(webhook, tipo, payload) {
  const body = JSON.stringify({ tipo, data: payload, ts: Date.now() });
  const sig = firmar(webhook.secret, body);

  const { data: del } = await supabase.from('webhook_deliveries').insert({
    webhook_id: webhook.id, evento_tipo: tipo, payload, status: 'pending',
  }).select('id').single();

  let ok = false, code = null, intentos = 0;
  for (let intento = 1; intento <= 2 && !ok; intento++) {
    intentos = intento;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'GESTEK-Webhooks/1.0',
          'x-gestek-event': tipo,
          'x-gestek-signature': `sha256=${sig}`,
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      code = resp.status;
      ok = resp.ok;
    } catch (e) {
      code = null;
    }
    if (!ok && intento === 1) await new Promise(r => setTimeout(r, 1500));
  }

  if (del?.id) {
    await supabase.from('webhook_deliveries').update({
      status: ok ? 'ok' : 'failed', response_code: code, intentos,
    }).eq('id', del.id);
  }
}

async function dispatch(ownerId, tipo, payload) {
  if (!ownerId || !tipo) return;
  try {
    const { data: hooks } = await supabase
      .from('webhooks').select('*')
      .eq('owner_id', ownerId).eq('activo', true)
      .contains('eventos', [tipo]);
    for (const w of hooks || []) {
      /* no await en serie bloqueante: disparamos en paralelo best-effort */
      entregar(w, tipo, payload).catch(() => {});
    }
  } catch (e) {
    console.warn('[webhooks] dispatch error:', e.message);
  }
}

module.exports = { dispatch, firmar };
