/* GESTEK — control de acceso a un evento por permisos de rol.

   assertPermiso(eventoId, userId, perms[], fields?)
     - Owner del evento: pasa siempre.
     - Miembro activo cuyo rol (event_roles.permissions) o custom_permissions
       incluye AL MENOS UNO de `perms`: pasa.
     - Miembro con `*` (co-dueño): pasa siempre — la misma regla que
       core/permisos/puede(). Borrar y transferir el evento NO pasan por aqui.
     - Si no: lanza Error('No autorizado.').
     - Evento inexistente: lanza Error('Evento no encontrado.').

   Devuelve el row del evento (con `fields`) — compatible con los
   assertOwner que cada ruta usaba (mismas strings de error). */

const supabase = require('./supabase.js');

async function assertPermiso(eventoId, userId, perms = [], fields = 'id, owner_id') {
  const sel = fields.includes('owner_id') ? fields : `owner_id, ${fields}`;
  const { data: ev, error } = await supabase
    .from('eventos').select(sel).eq('id', eventoId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!ev) throw new Error('Evento no encontrado.');
  if (String(ev.owner_id) === String(userId)) return ev;

  const { data: m } = await supabase
    .from('event_members')
    .select('custom_permissions, rol_detail:event_roles!rol_id(permissions)')
    .eq('evento_id', eventoId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (!m) throw new Error('No autorizado.');

  const tiene = new Set([
    ...(m.rol_detail?.permissions || []),
    ...(m.custom_permissions || []),
  ]);

  /* `*` — el co-dueño.
   *
   * ── Dos guardias que no se ponian de acuerdo ────────────────────────────
   *
   * `core/permisos/puede()` trata `*` como «puede todo» y lo dice en su
   * comentario. Esta funcion —que es la que usan las 58 rutas de verdad— no lo
   * conocia: un miembro con `*` pasaba un guardia y lo paraba el otro, segun
   * cual corriera. Dos reglas distintas sobre la misma cadena.
   *
   * ── Por que hace falta ─────────────────────────────────────────────────
   *
   * En FESTECH el evento lo llevan varias organizaciones y todas mandan igual.
   * El rol mas alto, «Administrador», enumera 22 permisos y aun asi no llega a
   * cinco pantallas, porque el panel las reserva a quien figura como dueño. La
   * salida hasta hoy era compartir la cuenta del dueño.
   *
   * ── Lo que `*` NO da ───────────────────────────────────────────────────
   *
   * Borrar el evento y transferirlo comparan `owner_id` a mano, con su propio
   * comentario diciendo por que («un miembro del equipo, por mucho permiso que
   * tenga, no lo hace»). Eso sigue igual: esto no pasa por aqui. */
  const ok = tiene.has('*') || (perms || []).some(p => tiene.has(p));
  if (!ok) throw new Error('No autorizado.');
  return ev;
}

module.exports = { assertPermiso };
