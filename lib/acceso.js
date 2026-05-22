/* GESTEK — control de acceso a un evento por permisos de rol.

   assertPermiso(eventoId, userId, perms[], fields?)
     - Owner del evento: pasa siempre.
     - Miembro activo cuyo rol (event_roles.permissions) o custom_permissions
       incluye AL MENOS UNO de `perms`: pasa.
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
  const ok = (perms || []).some(p => tiene.has(p));
  if (!ok) throw new Error('No autorizado.');
  return ev;
}

module.exports = { assertPermiso };
