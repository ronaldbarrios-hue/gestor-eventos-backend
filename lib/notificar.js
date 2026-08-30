/* GESTEK — helper para crear notificaciones in-app.
   Best-effort: nunca lanza, no bloquea el flujo principal si falla.

   ── Por que esta tabla estaba vacia ─────────────────────────────────────────

   Este archivo insertaba una columna `link` que `notificaciones` NO tiene.
   Medido sobre produccion el 30 de agosto de 2026: 0 filas en toda la historia
   de la tabla. La campana nunca ha mostrado nada, en ningun evento.

   Y no se veia por dos razones sumadas:

     1. supabase-js NO lanza cuando el INSERT falla: devuelve `{ error }`. El
        try/catch de aqui no cazaba nada porque no habia nada que cazar, y el
        `error` no se miraba. El fallo se iba por el desague en silencio.
     2. «Best-effort» tapaba la sospecha: si una notificacion no aparece, se
        asume que algo menor fallo, no que NINGUNA ha aparecido jamas.

   La columna que sobra es la del INSERT, no la de la tabla: el frontend no lee
   `link` en ninguna parte —ni el widget de la campana ni la pagina de
   notificaciones—, asi que el destino se arma del `evento_id`. Los que llaman
   pueden seguir pasando `link`; se ignora, y no hay que tocar 19 sitios.

   Sigue siendo best-effort —una notificacion no debe tumbar una compra— pero
   ahora un fallo se AVISA. Un error silencioso durante meses es peor que un
   error ruidoso durante un minuto. */

const supabase = require('./supabase.js');

/* Las columnas que la tabla tiene de verdad. Si alguien anade una clave que no
   esta aqui, se queda fuera en vez de reventar el INSERT entero. */
function fila({ userId, tipo = 'info', titulo, cuerpo = null, eventoId = null }) {
  return {
    user_id  : userId,
    tipo,
    titulo,
    cuerpo,
    evento_id: eventoId,
  };
}

/* Un fallo aqui no interrumpe a quien llama, pero se dice. */
function avisar(donde, error) {
  if (error) console.warn(`[${donde}] no se pudo crear la notificacion:`, error.message);
}

/**
 * notificar({ userId, tipo, titulo, cuerpo, link, eventoId })
 * Crea una notificación para un usuario. No await obligatorio en el caller.
 * `link` se acepta por compatibilidad y se ignora: la tabla no lo guarda.
 */
async function notificar(payload) {
  if (!payload?.userId || !payload?.titulo) return;
  try {
    const { error } = await supabase.from('notificaciones').insert(fila(payload));
    avisar('notificar', error);
  } catch (e) {
    console.warn('[notificar] no se pudo crear notificación:', e.message);
  }
}

/** Notifica a varios usuarios de una vez (dedupe de ids). */
async function notificarVarios(userIds, payload) {
  const unicos = [...new Set((userIds || []).filter(Boolean))];
  if (unicos.length === 0 || !payload?.titulo) return;
  try {
    const { error } = await supabase.from('notificaciones').insert(
      unicos.map(uid => fila({ ...payload, userId: uid, eventoId: payload.eventoId })),
    );
    avisar('notificarVarios', error);
  } catch (e) {
    console.warn('[notificarVarios] error:', e.message);
  }
}

module.exports = { notificar, notificarVarios };
