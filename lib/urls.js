/* GESTEK — Validación de URLs de imagen provistas por el usuario.
   Bloquea esquemas peligrosos (javascript:, data: ejecutables) y solo permite
   http/https. Evita XSS via avatar_url / logo / cover pegados a mano. */

function esUrlImagenSegura(url) {
  if (!url) return true;                 // vacío = sin avatar, OK
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (u.length > 2000) return false;
  /* data:image/... lo permitimos solo si es imagen base64 (uploaders inline) */
  if (/^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(u)) return true;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

module.exports = { esUrlImagenSegura };
