/* GESTEK — helper para crear notificaciones in-app.
   Best-effort: nunca lanza, no bloquea el flujo principal si falla. */

const supabase = require('./supabase.js');

/**
 * notificar({ userId, tipo, titulo, cuerpo, link, eventoId })
 * Crea una notificación para un usuario. No await obligatorio en el caller.
 */
async function notificar({ userId, tipo = 'info', titulo, cuerpo = null, link = null, eventoId = null }) {
  if (!userId || !titulo) return;
  try {
    await supabase.from('notificaciones').insert({
      user_id  : userId,
      tipo,
      titulo,
      cuerpo,
      link,
      evento_id: eventoId,
    });
  } catch (e) {
    console.warn('[notificar] no se pudo crear notificación:', e.message);
  }
}

/** Notifica a varios usuarios de una vez (dedupe de ids). */
async function notificarVarios(userIds, payload) {
  const unicos = [...new Set((userIds || []).filter(Boolean))];
  if (unicos.length === 0) return;
  try {
    await supabase.from('notificaciones').insert(
      unicos.map(uid => ({
        user_id  : uid,
        tipo     : payload.tipo || 'info',
        titulo   : payload.titulo,
        cuerpo   : payload.cuerpo || null,
        link     : payload.link || null,
        evento_id: payload.eventoId || null,
      })),
    );
  } catch (e) {
    console.warn('[notificarVarios] error:', e.message);
  }
}

module.exports = { notificar, notificarVarios };
