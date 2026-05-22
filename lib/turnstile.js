/* GESTEK — Verificación de Cloudflare Turnstile (captcha).
   Graceful: si TURNSTILE_SECRET_KEY no está configurada, NO se exige captcha
   (modo dev / opcional). Cuando se configura, se vuelve obligatorio. */

const SECRET = process.env.TURNSTILE_SECRET_KEY || null;

const turnstileHabilitado = () => Boolean(SECRET);

/**
 * verifyTurnstile(token, ip) → { ok, skipped?, error? }
 * Nunca lanza.
 */
async function verifyTurnstile(token, ip) {
  if (!SECRET) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: 'captcha_requerido' };
  try {
    const body = new URLSearchParams({ secret: SECRET, response: token });
    if (ip) body.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await r.json();
    return data.success ? { ok: true } : { ok: false, error: 'captcha_invalido' };
  } catch (e) {
    /* Si Cloudflare no responde, no bloqueamos al usuario (fail-open controlado) */
    console.warn('[turnstile] error verificando, se permite:', e.message);
    return { ok: true, skipped: 'verify_error' };
  }
}

module.exports = { verifyTurnstile, turnstileHabilitado };
