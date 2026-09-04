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

   Sigue siendo best-effort —una notificacion no debe tumbar una compra— pero
   ahora un fallo se AVISA. Un error silencioso durante meses es peor que un
   error ruidoso durante un minuto.

   ── Y `link` volvio, porque la correccion anterior se quedo a medias ──────

   Aqui ponia: «el frontend no lee `link` en ninguna parte, asi que el destino
   se arma del `evento_id`». Eso ya no es verdad. `TopBar.jsx` hace
   `if (n.link) navigate(n.link)`, o sea que la campana ensena los avisos y al
   pulsar uno no pasa nada, nunca.

   Con la migracion 0102 la columna existe y `link` se guarda. Catorce archivos
   ya lo pasaban —el aforo de una zona, una alerta de acceso, una tarea
   asignada, una postulacion aceptada— y todos saben a donde tenia que ir la
   persona. */

const supabase = require('./supabase.js');

/* Un destino valido es una ruta DE ESTA APLICACION.
 *
 * Con precision, porque es facil exagerarlo: el panel hace `navigate(n.link)`
 * con react-router, y ahi una URL absoluta NO redirige fuera — se convierte en
 * la ruta `/https://otro.com`, que no existe. Asi que esto no es un agujero de
 * seguridad hoy.
 *
 * Se comprueba igual por dos motivos que si son reales: un aviso que lleva a
 * una pantalla en blanco es un aviso roto, y el dia que alguien pinte el enlace
 * con un `<a href>` en vez de `navigate` —que es lo natural— la validacion
 * tiene que estar ya puesta. Escribirla despues es escribirla cuando duele.
 *
 * `//otro.com` se rechaza aparte: empieza por `/` y como href el navegador lo
 * lee como `https://otro.com`. Es el que se cuela cuando uno comprueba solo la
 * primera barra. */
function destinoValido(link) {
  if (typeof link !== 'string') return null;
  const l = link.trim();
  if (!l.startsWith('/') || l.startsWith('//')) return null;
  return l.slice(0, 500);
}

/* Las columnas que la tabla tiene de verdad. Si alguien anade una clave que no
   esta aqui, se queda fuera en vez de reventar el INSERT entero. */
function fila({ userId, tipo = 'info', titulo, cuerpo = null, eventoId = null, link = null }) {
  return {
    user_id  : userId,
    tipo,
    titulo,
    cuerpo,
    evento_id: eventoId,
    link     : destinoValido(link),
  };
}

/* Un fallo aqui no interrumpe a quien llama, pero se dice. */
function avisar(donde, error) {
  if (error) console.warn(`[${donde}] no se pudo crear la notificacion:`, error.message);
}

/* El INSERT, con reintento sin `link` si la columna todavia no esta.
 *
 * ── Por que esto y no confiar en el orden del despliegue ─────────────────
 *
 * Este archivo y la migracion 0102 salen a la vez, pero el codigo y la base se
 * despliegan por separado: si el codigo llega primero, el INSERT falla por una
 * columna que no existe y **se dejan de crear TODAS las notificaciones**. Que
 * es exactamente el fallo que este archivo lleva escrito en la cabecera y que
 * tardo meses en verse.
 *
 * Asi que se mira el error y se reintenta sin la columna, igual que hace
 * `leerZonas` con `tipo`. Perder el destino de un aviso es molesto; perder el
 * aviso entero, otra vez, seria no haber aprendido nada.
 *
 * El reintento es solo para ESTA ventana. Cuando la 0102 lleve tiempo puesta,
 * este `if` sobra — y su propio log dira que ya nadie entra por ahi. */
async function insertar(donde, filas) {
  const { error } = await supabase.from('notificaciones').insert(filas);
  if (!error) return;

  const faltaColumna = /link/i.test(error.message) && /column|does not exist|schema cache/i.test(error.message);
  if (!faltaColumna) { avisar(donde, error); return; }

  console.warn(`[${donde}] la tabla no acepta \`link\` (¿falta la 0102?): el aviso se crea sin destino.`);
  const sinLink = filas.map(({ link, ...resto }) => resto);
  const { error: e2 } = await supabase.from('notificaciones').insert(sinLink);
  avisar(donde, e2);
}

/**
 * notificar({ userId, tipo, titulo, cuerpo, link, eventoId })
 * Crea una notificación para un usuario. No await obligatorio en el caller.
 * `link` es a dónde lleva al pulsarla: una ruta interna que empieza por «/».
 * Cualquier otra cosa se guarda como null en vez de rechazar el aviso entero —
 * perder el destino es molesto, perder el aviso es peor.
 */
async function notificar(payload) {
  if (!payload?.userId || !payload?.titulo) return;
  try {
    await insertar('notificar', [fila(payload)]);
  } catch (e) {
    console.warn('[notificar] no se pudo crear notificación:', e.message);
  }
}

/** Notifica a varios usuarios de una vez (dedupe de ids). */
async function notificarVarios(userIds, payload) {
  const unicos = [...new Set((userIds || []).filter(Boolean))];
  if (unicos.length === 0 || !payload?.titulo) return;
  try {
    await insertar('notificarVarios',
      unicos.map(uid => fila({ ...payload, userId: uid, eventoId: payload.eventoId })));
  } catch (e) {
    console.warn('[notificarVarios] error:', e.message);
  }
}

module.exports = { notificar, notificarVarios, destinoValido };
